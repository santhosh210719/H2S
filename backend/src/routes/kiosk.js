import { Router } from "express";
import multer from "multer";
import { store } from "../store/index.js";
import { analyzeBadgeImage } from "../lib/mlClient.js";
import { workerAuthMiddleware } from "../lib/auth.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const kioskRouter = Router();

// All kiosk routes require a valid worker session token
kioskRouter.use(workerAuthMiddleware);

function fail(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

/**
 * POST /api/kiosk/bind
 * Body: { worker_id, wristband_qr, kiosk_location? }
 * Validates wristband status — 'used' is permanently rejected.
 */
kioskRouter.post("/bind", async (req, res) => {
  const { worker_id, wristband_qr, kiosk_location, kiosk_id } = req.body || {};
  if (!worker_id || !wristband_qr) {
    return fail(res, 400, "MISSING_QR", "Scan worker ID QR then wristband QR.");
  }
  const result = await store.bindWristband({
    worker_id: String(worker_id).trim(),
    wristband_qr: String(wristband_qr).trim(),
    kiosk_location: kiosk_location || kiosk_id || "KIOSK-MUSTER-01",
  });
  if (!result.ok) return fail(res, result.status || 409, "BIND_REJECTED", result.error);
  return res.json(result);
});

/**
 * POST /api/kiosk/close
 * Body: { wristband_qr }
 * Sets shift_end and permanently marks wristband 'used' — no future bind possible.
 */
kioskRouter.post("/close", async (req, res) => {
  const { wristband_qr, kiosk_location, kiosk_id } = req.body || {};
  if (!wristband_qr) {
    return fail(res, 400, "MISSING_QR", "Scan the wristband QR to close the shift.");
  }
  const result = await store.closeShift({
    wristband_qr: String(wristband_qr).trim(),
    kiosk_location: kiosk_location || kiosk_id || "KIOSK-MUSTER-01",
  });
  if (!result.ok) return fail(res, result.status || 409, "CLOSE_REJECTED", result.error);
  return res.json(result);
});

/**
 * POST /api/kiosk/lookup
 * Body: { wristband_qr }
 * Returns the worker bound to this wristband (must be 'bound' + active shift).
 */
kioskRouter.post("/lookup", async (req, res) => {
  const { wristband_qr } = req.body || {};
  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Wristband QR required.");
  const result = await store.lookupBand(String(wristband_qr).trim());
  if (!result.ok) return fail(res, result.status || 404, "LOOKUP_FAILED", result.error);
  return res.json(result);
});

/**
 * POST /api/kiosk/scan
 * Multipart: image (file) + wristband_qr (field) + kiosk_id (field, optional)
 *
 * Real Phase 2 pipeline:
 *   1. Validate wristband QR → must be 'bound' with active shift
 *   2. Run quality gate (Python OpenCV → Node Sharp fallback)
 *      blur < 80 || glare > 12% → 422 QUALITY_FAIL → logs row with null dose
 *   3. Extract color features (Python → Node fallback)
 *   4. Run XGBoost dose model (Python → heuristic fallback)
 *   5. Persist real dose_ppm_h, confidence, risk_band to scan_logs
 *   6. Upload image to Supabase Storage
 */
kioskRouter.post("/scan", upload.single("image"), async (req, res) => {
  const wristband_qr = String(req.body?.wristband_qr || "").trim();
  const kiosk_id = req.body?.kiosk_id || "KIOSK-MUSTER-01";

  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Scan the wristband QR first.");
  if (!req.file?.buffer) return fail(res, 400, "MISSING_IMAGE", "Capture a wristband photo.");

  // ── Step 1: validate wristband (one-time-use enforcement) ──
  const lookup = await store.lookupBand(wristband_qr);
  if (!lookup.ok) {
    return fail(res, lookup.status || 404, "LOOKUP_FAILED", lookup.error);
  }

  // ── Step 2–4: run real quality gate + feature extraction + dose model ──
  let analysis;
  try {
    analysis = await analyzeBadgeImage(req.file.buffer, req.file.originalname || "scan.jpg");
  } catch (err) {
    console.error("[scan] analyzeBadgeImage error:", err.message);
    return fail(res, 500, "PIPELINE_ERROR", "Image analysis failed — please try again.");
  }

  // ── Step 5: persist to scan_logs (real or fallback dose values) ──
  const isPass = analysis.quality.pass;
  const result = await store.insertScan({
    wristband_qr,
    imageBuffer: req.file.buffer,
    mime: req.file.mimetype || "image/jpeg",
    filename: req.file.originalname || "scan.jpg",
    quality_status: isPass ? "pass" : (analysis.quality.fail_reason?.includes("glare") ? "glare" : "blur"),
    dose_ppm_h: analysis.dose?.dose_ppm_h ?? null,
    confidence: analysis.dose?.confidence ?? null,
    risk_band: analysis.risk_band ?? null,
    kiosk_id,
  });

  // ── Quality fail — scan was logged, return 422 to trigger Screen E ──
  if (!isPass) {
    return res.status(422).json({
      ok: false,
      code: "QUALITY_FAIL",
      error: analysis.quality.fail_reason || "Image unclear — please re-scan",
      quality: analysis.quality,
      prompt: "Re-scan",
    });
  }

  if (!result.ok) {
    return fail(res, result.status || 500, result.code || "SCAN_ERROR", result.error);
  }

  return res.json({
    ok: true,
    scan: result.scan,
    worker: result.worker || lookup.worker,
    dose: {
      dose_ppm_h: result.scan?.dose_ppm_h ?? null,
      confidence: result.scan?.confidence ?? null,
      engine: analysis.dose?.engine ?? "unknown",
    },
    risk_band: result.scan?.risk_band ?? null,
    quality: analysis.quality,
    features: analysis.features,
  });
});
