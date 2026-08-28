import { supabaseAdmin, STORAGE_BUCKET } from "../lib/supabase.js";
import { USED_MSG } from "../lib/doseStub.js";
import { comparePin } from "../lib/auth.js";

export const supabaseStore = {
  mode: "supabase",

  // ── Worker management ──────────────────────────────────────────────────────

  async createWorker({ worker_id, name, department, shift, pin_hash }) {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .insert({ worker_id, name, department, shift, pin_hash, active: true })
      .select("worker_id, name, department, shift, active, created_at")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, status: 409, error: "Worker ID already exists." };
      return { ok: false, status: 500, error: error.message };
    }
    return { ok: true, worker: data };
  },

  async verifyWorkerPin(worker_id, pin) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("pin_hash, active")
      .eq("worker_id", worker_id)
      .maybeSingle();
    if (!w || !w.active) return false;   // don't leak whether worker_id exists
    return comparePin(pin, w.pin_hash);
  },

  async deactivateWorker(worker_id) {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ active: false })
      .eq("worker_id", worker_id);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true };
  },

  async registerWristband({ wristband_qr, batch_id }) {
    const { data, error } = await supabaseAdmin
      .from("wristbands")
      .insert({ wristband_qr, batch_id: batch_id || "BATCH-UNSET", status: "available" })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, status: 409, error: "Wristband already registered." };
      return { ok: false, status: 500, error: error.message };
    }
    return { ok: true, wristband: data };
  },

  async listWristbands() {
    const { data, error } = await supabaseAdmin
      .from("wristbands")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

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
    if (error) {
      console.error("[supabaseStore] insertScan DB error:", error.message);
      return { ok: false, status: 500, error: error.message };
    }
    console.log(`[supabaseStore] Scan logged successfully: id=${scan.id}, qr=${wristband_qr}, dose=${dose_ppm_h}, risk=${risk_band}`);

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
    const { data: workers, error } = await supabaseAdmin
      .from("workers")
      .select("worker_id, name, department, shift, active, created_at")
      .eq("active", true)
      .order("worker_id");
    if (error) throw error;
    const { data: bindings } = await supabaseAdmin.from("shift_bindings").select("*");
    const { data: scans } = await supabaseAdmin.from("scan_logs").select("*").order("timestamp", { ascending: false }).limit(200);
    return (workers || []).map((w) => {
      const workerBindings = (bindings || []).filter((b) => b.worker_id === w.worker_id);
      const workerQrs = workerBindings.map((b) => b.wristband_qr);
      const active = workerBindings.find((b) => !b.shift_end) || null;
      const latest = (scans || []).find((s) => workerQrs.includes(s.wristband_qr)) || null;
      return { ...w, latest_scan: latest, active_binding: active };
    });
  },

  /** All workers (active + inactive) for admin management table. */
  async listAllWorkers() {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("worker_id, name, department, shift, active, created_at")
      .order("worker_id");
    if (error) throw error;
    return data || [];
  },

  async updateWorkerPin(worker_id, pin_hash) {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ pin_hash })
      .eq("worker_id", worker_id);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true };
  },

  async activateWorker(worker_id) {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ active: true })
      .eq("worker_id", worker_id);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true };
  },

  /** Worker self-lookup: profile + current shift + recent scans. */
  async getWorkerProfile(worker_id) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("worker_id, name, department, shift, active, created_at")
      .eq("worker_id", worker_id)
      .eq("active", true)
      .maybeSingle();
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    const { data: openBinding } = await supabaseAdmin
      .from("shift_bindings")
      .select("*")
      .eq("worker_id", worker_id)
      .is("shift_end", null)
      .maybeSingle();
    const { data: bindings } = await supabaseAdmin
      .from("shift_bindings")
      .select("wristband_qr")
      .eq("worker_id", worker_id);
    const qrs = (bindings || []).map((b) => b.wristband_qr);
    let scans = [];
    if (qrs.length) {
      const { data: scanData } = await supabaseAdmin
        .from("scan_logs")
        .select("*")
        .in("wristband_qr", qrs)
        .order("timestamp", { ascending: false })
        .limit(10);
      scans = scanData || [];
    }
    return {
      ok: true,
      worker: w,
      on_shift: !!openBinding,
      active_wristband: openBinding?.wristband_qr || null,
      recent_scans: scans,
    };
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
      .insert({ worker_id: worker_id || null, kiosk_location: kiosk_location || "KIOSK-MUSTER-01", ambient_h2s_ppm: Number(ambient_h2s_ppm), temperature_c: Number(temperature_c), humidity_percent: Number(humidity_percent) })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async getLatestAmbient(limit = 30) {
    const { data, error } = await supabaseAdmin
      .from("live_ambient_readings")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message, recent: [], latest: null };
    const recent = (data || []).reverse();
    const latest = recent.length ? recent[recent.length - 1] : null;
    return { ok: true, latest, recent };
  },
};
