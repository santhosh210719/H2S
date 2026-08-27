import { Router } from "express";
import multer from "multer";
import { store } from "../store/index.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const kioskRouter = Router();

function fail(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

/**
 * POST /api/kiosk/bind
 * Body: { worker_id, wristband_qr, kiosk_location? }
 * Creates a shift_binding and marks wristband 'bound'.
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
 * Body: { wristband_qr, kiosk_location? }
 * Closes the shift: sets shift_end and marks wristband 'used'.
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
 * Multipart: image (file) + wristband_qr (field)
 * Runs quality gate → stub dose → inserts scan_log row + uploads image.
 */
kioskRouter.post("/scan", upload.single("image"), async (req, res) => {
  const wristband_qr = String(req.body?.wristband_qr || "").trim();
  const kiosk_id = req.body?.kiosk_id || "KIOSK-MUSTER-01";
  if (!wristband_qr) return fail(res, 400, "MISSING_QR", "Scan the wristband QR first.");
  if (!req.file?.buffer) return fail(res, 400, "MISSING_IMAGE", "Capture a wristband photo.");

  // Phase 1: quality_status stub — always passes unless file is very tiny
  const quality_status = req.file.buffer.length < 500 ? "blur" : "pass";

  const result = await store.insertScan({
    wristband_qr,
    imageBuffer: req.file.buffer,
    mime: req.file.mimetype || "image/jpeg",
    filename: req.file.originalname || "scan.jpg",
    quality_status,
    kiosk_id,
  });

  if (!result.ok) {
    const httpStatus = result.status || 500;
    if (result.code === "QUALITY_FAIL" || httpStatus === 422) {
      return res.status(422).json({
        ok: false,
        code: "QUALITY_FAIL",
        error: result.error || "Image unclear — please re-scan",
        prompt: "Re-scan",
      });
    }
    return fail(res, httpStatus, result.code || "SCAN_ERROR", result.error);
  }

  return res.json({
    ok: true,
    scan: result.scan,
    worker: result.worker,
    dose: {
      dose_ppm_h: result.scan?.dose_ppm_h ?? null,
      confidence: result.scan?.confidence ?? null,
    },
    risk_band: result.scan?.risk_band ?? null,
    quality_status: "pass",
    dummy: result.dummy || false,
  });
});
