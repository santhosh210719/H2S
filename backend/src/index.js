import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

import express from "express";
import cors from "cors";
import multer from "multer";
import { kioskRouter } from "./routes/kiosk.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { store } from "./store/index.js";
import { analyzeBadgeImage } from "./lib/mlClient.js";
import { workerAuthMiddleware } from "./lib/auth.js";

const app = express();
const PORT = Number(process.env.PORT || 4000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "h2s-dosai-api",
    store: store.mode || "unknown",
    kiosk_only: true,
    note: "Scanning is kiosk-station only — not worker phones.",
  });
});

// ─── Sub-routers ─────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/kiosk", kioskRouter);     // worker token enforced inside kioskRouter
app.use("/api/admin", adminRouter);     // admin JWT enforced inside adminRouter

// ─── Spec-required flat routes (Phase 1 checklist) ───────────────────────────
// These mirror the kiosk/admin sub-routes so the spec API paths work too.

/**
 * POST /api/bind-wristband
 * Body: { worker_id, wristband_qr, kiosk_location? }
 */
app.post("/api/bind-wristband", workerAuthMiddleware, async (req, res) => {
  const { worker_id, wristband_qr, kiosk_location } = req.body || {};
  if (!worker_id || !wristband_qr) {
    return res.status(400).json({ ok: false, error: "worker_id and wristband_qr are required." });
  }
  const result = await store.bindWristband({
    worker_id: String(worker_id).trim(),
    wristband_qr: String(wristband_qr).trim(),
    kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
  });
  if (!result.ok) return res.status(result.status || 409).json(result);
  return res.json(result);
});

/**
 * POST /api/scan
 * Spec-required flat route — same real pipeline as /api/kiosk/scan.
 * Multipart: image (file) + wristband_qr (field)
 */
app.post("/api/scan", workerAuthMiddleware, upload.single("image"), async (req, res) => {
  const wristband_qr = String(req.body?.wristband_qr || "").trim();
  if (!wristband_qr) return res.status(400).json({ ok: false, error: "wristband_qr required." });
  if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "image file required." });

  const lookup = await store.lookupBand(wristband_qr);
  if (!lookup.ok) return res.status(lookup.status || 404).json(lookup);

  let analysis;
  try {
    analysis = await analyzeBadgeImage(req.file.buffer, req.file.originalname || "scan.jpg");
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Image analysis failed." });
  }

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
    kiosk_id: req.body?.kiosk_id || "KIOSK-MUSTER-01",
  });

  if (!isPass) {
    return res.status(422).json({ ok: false, code: "QUALITY_FAIL", error: analysis.quality.fail_reason, prompt: "Re-scan" });
  }
  if (!result.ok) return res.status(result.status || 500).json(result);

  return res.json({
    ok: true,
    scan: result.scan,
    worker: result.worker || lookup.worker,
    dose: { dose_ppm_h: result.scan?.dose_ppm_h, confidence: result.scan?.confidence, engine: analysis.dose?.engine },
    risk_band: result.scan?.risk_band,
  });
});

/**
 * POST /api/ambient
 * Ingest IoT telemetry reading from ESP32 / simulator (MQ-136 + DHT-11)
 */
app.post("/api/ambient", async (req, res) => {
  const { kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent, worker_id } = req.body || {};
  try {
    const row = await store.insertAmbientReading({
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
      ambient_h2s_ppm: Number(ambient_h2s_ppm || 0),
      temperature_c: Number(temperature_c || 28),
      humidity_percent: Number(humidity_percent || 65),
      worker_id: worker_id || null,
    });
    return res.json({ ok: true, reading: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ambient/latest
 * Return recent ambient readings for real-time dashboard graphs
 */
app.get("/api/ambient/latest", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const result = await store.getLatestAmbient(limit);
  return res.json(result);
});


/**
 * GET /api/workers
 * Returns all workers with their latest scan_logs entry.
 */
app.get("/api/workers", async (_req, res) => {
  try {
    const workers = await store.listWorkers();
    return res.json({ ok: true, workers });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/workers/:id/history
 * Returns all scan_logs for that worker's shift bindings.
 */
app.get("/api/workers/:id/history", async (req, res) => {
  try {
    const result = await store.workerHistory(req.params.id);
    if (!result.ok) return res.status(result.status || 404).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/close-shift
 * Body: { wristband_qr }
 */
app.post("/api/close-shift", workerAuthMiddleware, async (req, res) => {
  const { wristband_qr } = req.body || {};
  if (!wristband_qr) return res.status(400).json({ ok: false, error: "wristband_qr required." });
  const result = await store.closeShift({ wristband_qr: String(wristband_qr).trim() });
  if (!result.ok) return res.status(result.status || 409).json(result);
  return res.json(result);
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`[h2s] API on http://localhost:${PORT}`);
  console.log(`[h2s] Spec routes: POST /api/bind-wristband, POST /api/scan, GET /api/workers, GET /api/workers/:id/history, POST /api/close-shift`);
});
