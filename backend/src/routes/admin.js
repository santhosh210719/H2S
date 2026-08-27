import { Router } from "express";
import { store } from "../store/index.js";

export const adminRouter = Router();

/**
 * GET /api/admin/overview
 * Returns active shifts (with live_ambient_readings join) + recent scan_logs.
 * The admin frontend uses this for realtime updates.
 */
adminRouter.get("/overview", async (_req, res) => {
  try {
    const workers = await store.listWorkers();
    return res.json({
      ok: true,
      workers,
      // active_shifts: filter workers with an active binding
      active_shifts: workers.filter((w) => w.active_binding),
      // scans: flatten all latest_scans for the scan log table
      scans: workers
        .filter((w) => w.latest_scan)
        .map((w) => ({ ...w.latest_scan, worker: { worker_id: w.worker_id, name: w.name } })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/admin/workers/:id/history
 * Returns all scan_logs for a specific worker's shift bindings.
 */
adminRouter.get("/workers/:id/history", async (req, res) => {
  try {
    const result = await store.workerHistory(req.params.id);
    if (!result.ok) return res.status(result.status || 404).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/admin/sensor-demo
 * Demo ingest for the optional MQ-136 / DHT-11 pack (Phase 3 supplementary sensor).
 * Not the primary PS solution — passive badge is.
 */
adminRouter.post("/sensor-demo", async (req, res) => {
  const { worker_id, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent } = req.body || {};
  if (!worker_id) return res.status(400).json({ ok: false, error: "worker_id required" });
  try {
    const result = await store.insertAmbientReading({
      worker_id,
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
      ambient_h2s_ppm: ambient_h2s_ppm ?? 0,
      temperature_c: temperature_c ?? 28,
      humidity_percent: humidity_percent ?? 65,
    });
    return res.json({ ok: true, reading: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
