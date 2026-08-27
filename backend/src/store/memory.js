import { USED_MSG, mockDose } from "../lib/doseStub.js";

function nowIso() {
  return new Date().toISOString();
}
function uid() {
  return crypto.randomUUID();
}

function seed() {
  return {
    workers: [
      { worker_id: "WKR-1001", name: "Arun Kumar", department: "CDU", shift: "A", created_at: nowIso() },
      { worker_id: "WKR-1002", name: "Priya Nair", department: "SRU", shift: "A", created_at: nowIso() },
      { worker_id: "WKR-1003", name: "Rahul Shetty", department: "Utilities", shift: "B", created_at: nowIso() },
    ],
    wristbands: [
      { wristband_qr: "WB-2026-000481", batch_id: "BATCH-26-01", status: "available" },
      { wristband_qr: "WB-2026-000482", batch_id: "BATCH-26-01", status: "available" },
      { wristband_qr: "WB-2026-000483", batch_id: "BATCH-26-01", status: "available" },
      { wristband_qr: "WB-2026-000484", batch_id: "BATCH-26-01", status: "available" },
      { wristband_qr: "WB-2026-000499", batch_id: "BATCH-25-12", status: "used" },
    ],
    bindings: [],
    scans: [
      {
        id: "seed-scan-1",
        wristband_qr: "WB-2026-000499",
        worker_id: "WKR-1003",
        timestamp: new Date(Date.now() - 3 * 3600_000).toISOString(),
        image_url: null,
        quality_status: "pass",
        dose_ppm_h: 6.4,
        confidence: 0.79,
        risk_band: "high",
      },
      {
        id: "seed-scan-2",
        wristband_qr: "WB-2026-000499",
        worker_id: "WKR-1003",
        timestamp: new Date(Date.now() - 6 * 3600_000).toISOString(),
        image_url: null,
        quality_status: "pass",
        dose_ppm_h: 2.1,
        confidence: 0.83,
        risk_band: "medium",
      },
      {
        id: "seed-scan-3",
        wristband_qr: "WB-2026-000481",
        worker_id: "WKR-1001",
        timestamp: new Date(Date.now() - 1 * 3600_000).toISOString(),
        image_url: null,
        quality_status: "pass",
        dose_ppm_h: 0.5,
        confidence: 0.91,
        risk_band: "low",
      },
    ],
    ambient: [],
  };
}

const db = seed();

function worker(id) {
  return db.workers.find((w) => w.worker_id === id);
}
function band(qr) {
  return db.wristbands.find((w) => w.wristband_qr === qr);
}
function openBindingByBand(qr) {
  return db.bindings.find((b) => b.wristband_qr === qr && !b.shift_end);
}
function openBindingByWorker(id) {
  return db.bindings.find((b) => b.worker_id === id && !b.shift_end);
}

export const memoryStore = {
  mode: "memory",

  async bindWristband({ worker_id, wristband_qr, kiosk_location }) {
    const w = worker(worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker ID not recognised." };
    const wb = band(wristband_qr);
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };
    if (wb.status === "bound" || openBindingByBand(wristband_qr)) {
      return { ok: false, status: 409, error: "This wristband is already bound to an active shift." };
    }
    if (openBindingByWorker(worker_id)) {
      return { ok: false, status: 409, error: "This worker already has an active shift." };
    }
    wb.status = "bound";
    const binding = {
      id: crypto.randomUUID(),
      wristband_qr,
      worker_id,
      shift_start: nowIso(),
      shift_end: null,
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
    };
    db.bindings.push(binding);
    return { ok: true, binding, worker: w, wristband: wb };
  },

  async closeShift({ wristband_qr }) {
    const wb = band(wristband_qr);
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };
    const binding = openBindingByBand(wristband_qr);
    if (!binding) return { ok: false, status: 409, error: "No active shift for this wristband." };
    binding.shift_end = nowIso();
    wb.status = "used";
    return { ok: true, message: "Shift closed. Wristband QR is permanently marked used.", wristband: wb };
  },

  async lookupBand(wristband_qr) {
    const wb = band(wristband_qr);
    if (!wb) return { ok: false, status: 404, error: "Wristband QR not recognised." };
    if (wb.status === "used") return { ok: false, status: 409, error: USED_MSG };
    const binding = openBindingByBand(wristband_qr);
    if (!binding) return { ok: false, status: 409, error: "Bind worker ID + wristband QR first." };
    return { ok: true, wristband: wb, binding, worker: worker(binding.worker_id) };
  },

  async insertScan({ wristband_qr, imageBuffer, mime, filename, image_url, quality_status, kiosk_id }) {
    const looked = await this.lookupBand(wristband_qr);
    if (!looked.ok) return looked;
    if (quality_status && quality_status !== "pass") {
      return {
        ok: false,
        status: 422,
        code: "QUALITY_FAIL",
        error: "Image unclear — please re-scan",
        quality_status,
      };
    }
    const dummy = mockDose(wristband_qr);
    const row = {
      id: uid(),
      wristband_qr,
      worker_id: looked.worker.worker_id,
      timestamp: nowIso(),
      image_url: image_url || (imageBuffer ? `[memory:${filename || "scan.jpg"}]` : null),
      quality_status: "pass",
      kiosk_location: kiosk_id || "KIOSK-MUSTER-01",
      ...dummy,
    };
    db.scans.unshift(row);
    return { ok: true, scan: row, worker: looked.worker, dummy: true };
  },

  async insertAmbientReading({ worker_id: wid, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent }) {
    const row = {
      id: uid(),
      worker_id: wid,
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
      ambient_h2s_ppm,
      temperature_c,
      humidity_percent,
      timestamp: nowIso(),
    };
    db.ambient.push(row);
    return row;
  },

  async listWorkers() {
    return db.workers.map((w) => {
      const binding = db.bindings.filter((b) => b.worker_id === w.worker_id).at(-1);
      const latest = db.scans.find((s) => {
        if (s.worker_id === w.worker_id) return true;
        if (binding && s.wristband_qr === binding.wristband_qr) return true;
        return false;
      });
      return { ...w, latest_scan: latest || null, active_binding: openBindingByWorker(w.worker_id) || null };
    });
  },

  async workerHistory(worker_id) {
    const w = worker(worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    const qrs = db.bindings.filter((b) => b.worker_id === worker_id).map((b) => b.wristband_qr);
    const scans = db.scans
      .filter((s) => s.worker_id === worker_id || qrs.includes(s.wristband_qr))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { ok: true, worker: w, scans, bindings: db.bindings.filter((b) => b.worker_id === worker_id) };
  },
};
