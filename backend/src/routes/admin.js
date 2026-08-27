import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";

export const adminRouter = Router();

adminRouter.get("/overview", async (_req, res) => {
  const { data: scans, error } = await supabaseAdmin
    .from("scans")
    .select("*, workers(worker_code, full_name, department), wristbands(qr_code, status), shifts(status, started_at, ended_at, kiosk_id)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const { data: shifts } = await supabaseAdmin
    .from("shifts")
    .select("*, workers(worker_code, full_name, department), wristbands(qr_code, status)")
    .eq("status", "active")
    .order("started_at", { ascending: false });

  const workerIds = [...new Set((shifts || []).map((s) => s.worker_id).filter(Boolean))];
  let sensors = [];
  if (workerIds.length) {
    const { data } = await supabaseAdmin
      .from("sensor_readings")
      .select("*")
      .in("worker_id", workerIds)
      .order("created_at", { ascending: false })
      .limit(200);
    sensors = data || [];
  }

  const latestSensorByWorker = {};
  for (const row of sensors) {
    if (!latestSensorByWorker[row.worker_id]) latestSensorByWorker[row.worker_id] = row;
  }

  res.json({
    ok: true,
    scans: scans || [],
    active_shifts: (shifts || []).map((s) => ({
      ...s,
      live_sensor: latestSensorByWorker[s.worker_id] || null,
    })),
  });
});

/** Demo ingest for the optional MQ-136 pack — not the primary PS solution. */
adminRouter.post("/sensor-demo", async (req, res) => {
  const { worker_code, device_id, h2s_ppm, temperature_c, humidity_pct } = req.body || {};
  const { data: worker } = await supabaseAdmin.from("workers").select("id").eq("worker_code", worker_code).maybeSingle();
  if (!worker) return res.status(404).json({ ok: false, error: "Worker not found" });
  const { data, error } = await supabaseAdmin
    .from("sensor_readings")
    .insert({
      worker_id: worker.id,
      device_id: device_id || "PACK-DEMO-01",
      h2s_ppm,
      temperature_c,
      humidity_pct,
    })
    .select("*")
    .single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, reading: data });
});
