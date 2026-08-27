import { Router } from "express";
import multer from "multer";
import { supabaseAdmin, STORAGE_BUCKET } from "../lib/supabase.js";
import { analyzeBadgeImage } from "../lib/mlClient.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const kioskRouter = Router();

function fail(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

kioskRouter.post("/bind", async (req, res) => {
  const { worker_code, wristband_qr, kiosk_id } = req.body || {};
  if (!worker_code || !wristband_qr) {
    return fail(res, 400, "MISSING_QR", "Scan worker ID QR then wristband QR.");
  }
  const { data, error } = await supabaseAdmin.rpc("bind_shift", {
    p_worker_code: String(worker_code).trim(),
    p_wristband_qr: String(wristband_qr).trim(),
    p_kiosk_id: kiosk_id || "KIOSK-MUSTER-01",
  });
  if (error) return fail(res, 500, "BIND_RPC", error.message);
  if (!data?.ok) return fail(res, 409, data?.code || "BIND_REJECTED", data?.error || "Bind failed");
  return res.json(data);
});

kioskRouter.post("/close", async (req, res) => {
  const { wristband_qr, kiosk_id } = req.body || {};
  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Scan the wristband QR to close the shift.");
  const { data, error } = await supabaseAdmin.rpc("close_shift_by_wristband", {
    p_wristband_qr: String(wristband_qr).trim(),
    p_kiosk_id: kiosk_id || "KIOSK-MUSTER-01",
  });
  if (error) return fail(res, 500, "CLOSE_RPC", error.message);
  if (!data?.ok) return fail(res, 409, data?.code || "CLOSE_REJECTED", data?.error || "Close failed");
  return res.json(data);
});

kioskRouter.post("/lookup", async (req, res) => {
  const { wristband_qr } = req.body || {};
  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Wristband QR required.");
  const qr = String(wristband_qr).trim();

  const { data: band, error: bandErr } = await supabaseAdmin
    .from("wristbands")
    .select("*")
    .eq("qr_code", qr)
    .maybeSingle();
  if (bandErr) return fail(res, 500, "LOOKUP", bandErr.message);
  if (!band) return fail(res, 404, "WRISTBAND_NOT_FOUND", "Wristband QR not recognised.");
  if (band.status === "used") {
    return fail(res, 409, "WRISTBAND_USED", "This wristband has already been used — please use a new one.");
  }
  if (band.status !== "bound") {
    return fail(res, 409, "NOT_BOUND", "Wristband is not bound. Start the shift first (worker ID + wristband QR).");
  }

  const { data: shift, error: shiftErr } = await supabaseAdmin
    .from("shifts")
    .select("*, workers(*)")
    .eq("wristband_id", band.id)
    .eq("status", "active")
    .maybeSingle();
  if (shiftErr) return fail(res, 500, "LOOKUP", shiftErr.message);
  if (!shift) return fail(res, 409, "NO_ACTIVE_SHIFT", "No active shift for this wristband.");

  return res.json({
    ok: true,
    wristband: { id: band.id, qr_code: band.qr_code, status: band.status },
    shift: { id: shift.id, kiosk_id: shift.kiosk_id, started_at: shift.started_at },
    worker: shift.workers,
  });
});

kioskRouter.post("/scan", upload.single("image"), async (req, res) => {
  const wristband_qr = String(req.body?.wristband_qr || "").trim();
  const kiosk_id = req.body?.kiosk_id || "KIOSK-MUSTER-01";
  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Scan the wristband QR first.");
  if (!req.file?.buffer) return fail(res, 400, "MISSING_IMAGE", "Capture a wristband photo.");

  const { data: band } = await supabaseAdmin.from("wristbands").select("*").eq("qr_code", wristband_qr).maybeSingle();
  if (!band) return fail(res, 404, "WRISTBAND_NOT_FOUND", "Wristband QR not recognised.");
  if (band.status === "used") {
    return fail(res, 409, "WRISTBAND_USED", "This wristband has already been used — please use a new one.");
  }

  const { data: shift } = await supabaseAdmin
    .from("shifts")
    .select("*, workers(*)")
    .eq("wristband_id", band.id)
    .eq("status", "active")
    .maybeSingle();
  if (!shift) {
    return fail(res, 409, "NO_ACTIVE_SHIFT", "Bind worker ID + wristband QR at shift start before scanning.");
  }

  const analysis = await analyzeBadgeImage(req.file.buffer, req.file.originalname || "scan.jpg");

  if (!analysis.quality.pass) {
    return res.status(422).json({
      ok: false,
      code: "QUALITY_FAIL",
      error: analysis.quality.fail_reason || "Re-scan required.",
      quality: analysis.quality,
      prompt: "Re-scan",
    });
  }

  const objectPath = `${shift.id}/${Date.now()}-${(req.file.originalname || "scan.jpg").replace(/[^\w.-]/g, "_")}`;
  let image_path = null;
  const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(objectPath, req.file.buffer, {
    contentType: req.file.mimetype || "image/jpeg",
    upsert: false,
  });
  if (!upErr) image_path = objectPath;

  const row = {
    shift_id: shift.id,
    worker_id: shift.worker_id,
    wristband_id: band.id,
    kiosk_id,
    image_path,
    quality_pass: true,
    quality_fail_reason: null,
    blur_score: analysis.quality.blur_score,
    glare_ratio: analysis.quality.glare_ratio,
    dose_ppm_h: analysis.dose.dose_ppm_h,
    confidence: analysis.dose.confidence,
    risk_band: analysis.risk_band,
    color_features: analysis.features,
  };

  const { data: scan, error: insErr } = await supabaseAdmin.from("scans").insert(row).select("*").single();
  if (insErr) return fail(res, 500, "SCAN_INSERT", insErr.message);

  return res.json({
    ok: true,
    scan,
    worker: shift.workers,
    wristband: { qr_code: band.qr_code },
    quality: analysis.quality,
    dose: analysis.dose,
    risk_band: analysis.risk_band,
  });
});
