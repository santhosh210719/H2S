import { supabaseAdmin, STORAGE_BUCKET } from "../lib/supabase.js";
import { USED_MSG } from "../lib/doseStub.js";

export const supabaseStore = {
  mode: "supabase",

  async bindWristband({ worker_id, wristband_qr, kiosk_location }) {
    const { data: w } = await supabaseAdmin.from("workers").select("*").eq("worker_id", worker_id).maybeSingle();
    if (!w) return { ok: false, status: 404, error: "Worker ID not recognised." };

    const { data: wb } = await supabaseAdmin.from("wristbands").select("*").eq("wristband_qr", wristband_qr).maybeSingle();
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };
    if (wb.status === "bound") {
      return { ok: false, status: 409, error: "This wristband is already bound to an active shift." };
    }

    const { data: openW } = await supabaseAdmin
      .from("shift_bindings")
      .select("id")
      .eq("worker_id", worker_id)
      .is("shift_end", null)
      .maybeSingle();
    if (openW) return { ok: false, status: 409, error: "This worker already has an active shift." };

    const { data: binding, error } = await supabaseAdmin
      .from("shift_bindings")
      .insert({
        worker_id,
        wristband_qr,
        kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
      })
      .select("*")
      .single();
    if (error) return { ok: false, status: 500, error: error.message };

    await supabaseAdmin.from("wristbands").update({ status: "bound" }).eq("wristband_qr", wristband_qr);
    return { ok: true, binding, worker: w, wristband: { ...wb, status: "bound" } };
  },

  async closeShift({ wristband_qr }) {
    const { data: wb } = await supabaseAdmin.from("wristbands").select("*").eq("wristband_qr", wristband_qr).maybeSingle();
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };

    const { data: binding } = await supabaseAdmin
      .from("shift_bindings")
      .select("*")
      .eq("wristband_qr", wristband_qr)
      .is("shift_end", null)
      .maybeSingle();
    if (!binding) return { ok: false, status: 409, error: "No active shift for this wristband." };

    await supabaseAdmin.from("shift_bindings").update({ shift_end: new Date().toISOString() }).eq("id", binding.id);
    await supabaseAdmin.from("wristbands").update({ status: "used" }).eq("wristband_qr", wristband_qr);
    return { ok: true, message: "Shift closed. Wristband QR is permanently marked used." };
  },

  async lookupBand(wristband_qr) {
    const { data: wb } = await supabaseAdmin.from("wristbands").select("*").eq("wristband_qr", wristband_qr).maybeSingle();
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };
    const { data: binding } = await supabaseAdmin
      .from("shift_bindings")
      .select("*")
      .eq("wristband_qr", wristband_qr)
      .is("shift_end", null)
      .maybeSingle();
    if (!binding) return { ok: false, status: 409, error: "Bind worker ID + wristband QR first." };
    const { data: worker } = await supabaseAdmin.from("workers").select("*").eq("worker_id", binding.worker_id).single();
    return { ok: true, wristband: wb, binding, worker };
  },

  /**
   * insertScan — persist a scan result.
   * Pass real dose_ppm_h/confidence/risk_band from the ML pipeline (route layer).
   * quality_status: "pass" | "blur" | "glare"
   * When quality_status != "pass", dose fields are null — scan is still logged for auditing.
   */
  async insertScan({ wristband_qr, imageBuffer, mime, filename, quality_status, dose_ppm_h, confidence, risk_band, kiosk_id }) {
    const looked = await this.lookupBand(wristband_qr);
    if (!looked.ok) return looked;

    // Upload image regardless of quality (useful for audit/debugging)
    let image_url = null;
    if (imageBuffer) {
      const objectPath = `${looked.binding.id}/${Date.now()}-${(filename || "scan.jpg").replace(/[^\w.-]/g, "_")}`;
      const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(objectPath, imageBuffer, {
        contentType: mime || "image/jpeg",
        upsert: false,
      });
      if (!upErr) image_url = objectPath;
    }

    const isPass = !quality_status || quality_status === "pass";
    const row = {
      wristband_qr,
      image_url,
      quality_status: isPass ? "pass" : quality_status,
      dose_ppm_h: isPass ? (dose_ppm_h ?? null) : null,
      confidence: isPass ? (confidence ?? null) : null,
      risk_band: isPass ? (risk_band ?? null) : null,
    };
    const { data: scan, error } = await supabaseAdmin.from("scan_logs").insert(row).select("*").single();
    if (error) return { ok: false, status: 500, error: error.message };

    if (!isPass) {
      return {
        ok: false,
        status: 422,
        code: "QUALITY_FAIL",
        error: `Image unclear — please re-scan (${quality_status})`,
        quality_status,
        scan, // logged row for reference
      };
    }
    return { ok: true, scan: { ...scan, worker_id: looked.worker.worker_id }, worker: looked.worker };
  },

  async listWorkers() {
    const { data: workers, error } = await supabaseAdmin.from("workers").select("*").order("worker_id");
    if (error) throw error;
    const { data: bindings } = await supabaseAdmin.from("shift_bindings").select("*").is("shift_end", null);
    const { data: scans } = await supabaseAdmin.from("scan_logs").select("*").order("timestamp", { ascending: false }).limit(200);
    const openByWorker = Object.fromEntries((bindings || []).map((b) => [b.worker_id, b]));
    return (workers || []).map((w) => {
      const open = openByWorker[w.worker_id];
      const latest = (scans || []).find((s) => s.wristband_qr === open?.wristband_qr) || null;
      return { ...w, latest_scan: latest, active_binding: open || null };
    });
  },

  async workerHistory(worker_id) {
    const { data: w } = await supabaseAdmin.from("workers").select("*").eq("worker_id", worker_id).maybeSingle();
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    const { data: bindings } = await supabaseAdmin.from("shift_bindings").select("*").eq("worker_id", worker_id);
    const qrs = (bindings || []).map((b) => b.wristband_qr);
    let scans = [];
    if (qrs.length) {
      const { data } = await supabaseAdmin
        .from("scan_logs")
        .select("*")
        .in("wristband_qr", qrs)
        .order("timestamp", { ascending: true });
      scans = data || [];
    }
    return { ok: true, worker: w, scans, bindings: bindings || [] };
  },

  async insertAmbientReading({ worker_id, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent }) {
    const { data, error } = await supabaseAdmin
      .from("live_ambient_readings")
      .insert({ worker_id, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
