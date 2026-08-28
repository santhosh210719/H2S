import { USED_MSG } from "../lib/doseStub.js";

function nowIso() {
  return new Date().toISOString();
}
function uid() {
  return crypto.randomUUID();
}

// Empty store — populated only through admin onboarding (POST /api/admin/workers)
// and real kiosk operations. No hardcoded demo data.
const db = {
  workers:  [],   // { worker_id, name, department, shift, pin_hash, active, created_at }
  wristbands: [], // { wristband_qr, batch_id, status }
  bindings: [],
  scans:    [],
  ambient:  [],
};

function worker(id) {
  return db.workers.find((w) => w.worker_id === id && w.active !== false);
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

  // ── Worker management ────────────────────────────────────────────────────────

  async createWorker({ worker_id, name, department, shift, pin_hash }) {
    if (db.workers.find((w) => w.worker_id === worker_id)) {
      return { ok: false, status: 409, error: "Worker ID already exists." };
    }
    const w = { worker_id, name, department, shift, pin_hash, active: true, created_at: nowIso() };
    db.workers.push(w);
    const { pin_hash: _ph, ...safe } = w;
    return { ok: true, worker: safe };
  },

  async verifyWorkerPin(worker_id, pin) {
    const { default: bcrypt } = await import("bcrypt");
    const w = db.workers.find((w) => w.worker_id === worker_id);
    if (!w || !w.active) return false;        // don't reveal whether id exists
    return bcrypt.compare(String(pin), w.pin_hash);
  },

  async deactivateWorker(worker_id) {
    const w = db.workers.find((w) => w.worker_id === worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    w.active = false;
    return { ok: true };
  },

  // ── Wristband management ─────────────────────────────────────────────────────

  async registerWristband({ wristband_qr, batch_id }) {
    if (band(wristband_qr)) return { ok: false, status: 409, error: "Wristband already registered." };
    const wb = { wristband_qr, batch_id: batch_id || "BATCH-UNSET", status: "available", created_at: nowIso() };
    db.wristbands.push(wb);
    return { ok: true, wristband: wb };
  },

  async listWristbands() {
    return [...db.wristbands].reverse();
  },

  // ── Shift operations ─────────────────────────────────────────────────────────

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
      id: uid(),
      wristband_qr,
      worker_id,
      shift_start: nowIso(),
      shift_end: null,
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
    };
    db.bindings.push(binding);
    const { pin_hash: _ph, ...safeWorker } = w;
    return { ok: true, binding, worker: safeWorker, wristband: wb };
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
    const w = worker(binding.worker_id);
    const { pin_hash: _ph, ...safeWorker } = w || {};
    return { ok: true, wristband: wb, binding, worker: safeWorker };
  },

  async insertScan({ wristband_qr, imageBuffer, mime, filename, image_url, quality_status, dose_ppm_h, confidence, risk_band, kiosk_id }) {
    const looked = await this.lookupBand(wristband_qr);
    if (!looked.ok) return looked;

    const isPass = !quality_status || quality_status === "pass";
    const row = {
      id: uid(),
      wristband_qr,
      worker_id: looked.worker.worker_id,
      timestamp: nowIso(),
      image_url: image_url || (imageBuffer ? `[memory:${filename || "scan.jpg"}]` : null),
      quality_status: isPass ? "pass" : quality_status,
      kiosk_location: kiosk_id || "KIOSK-MUSTER-01",
      dose_ppm_h: isPass ? (dose_ppm_h ?? null) : null,
      confidence: isPass ? (confidence ?? null) : null,
      risk_band: isPass ? (risk_band ?? null) : null,
    };
    db.scans.unshift(row);

    if (!isPass) {
      return {
        ok: false,
        status: 422,
        code: "QUALITY_FAIL",
        error: `Image unclear — please re-scan (${quality_status})`,
        quality_status,
        scan: row,
      };
    }
    return { ok: true, scan: row, worker: looked.worker };
  },

  async insertAmbientReading({ worker_id: wid, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent }) {
    const row = {
      id: uid(),
      worker_id: wid || null,
      kiosk_location: kiosk_location || "KIOSK-MUSTER-01",
      ambient_h2s_ppm: Number(ambient_h2s_ppm || 0),
      temperature_c: Number(temperature_c || 28),
      humidity_percent: Number(humidity_percent || 65),
      timestamp: nowIso(),
    };
    db.ambient.push(row);
    if (db.ambient.length > 500) db.ambient.shift();
    return row;
  },

  async getLatestAmbient(limit = 30) {
    const sorted = [...db.ambient].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const recent = sorted.slice(-limit);
    const latest = recent.length ? recent[recent.length - 1] : null;
    return { ok: true, latest, recent };
  },

  async listWorkers() {
    return db.workers
      .filter((w) => w.active !== false)
      .map((w) => {
        const { pin_hash: _ph, ...safe } = w;
        const workerBindings = db.bindings.filter((b) => b.worker_id === w.worker_id);
        const workerQrs = workerBindings.map((b) => b.wristband_qr);
        const latest = db.scans.find((s) => {
          if (s.worker_id === w.worker_id) return true;
          if (workerQrs.includes(s.wristband_qr)) return true;
          return false;
        });
        return { ...safe, latest_scan: latest || null, active_binding: openBindingByWorker(w.worker_id) || null };
      });
  },

  /** Returns ALL workers (active + inactive) without pin_hash — for admin management. */
  async listAllWorkers() {
    return db.workers.map((w) => {
      const { pin_hash: _ph, ...safe } = w;
      return safe;
    });
  },

  async updateWorkerPin(worker_id, pin_hash) {
    const w = db.workers.find((wk) => wk.worker_id === worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    w.pin_hash = pin_hash;
    return { ok: true };
  },

  async activateWorker(worker_id) {
    const w = db.workers.find((wk) => wk.worker_id === worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    w.active = true;
    return { ok: true };
  },

  /** Worker self-lookup: returns profile + current shift + recent scans. */
  async getWorkerProfile(worker_id) {
    const w = db.workers.find((wk) => wk.worker_id === worker_id && wk.active !== false);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    const { pin_hash: _ph, ...safe } = w;
    const activeBinding = openBindingByWorker(worker_id);
    const qrs = db.bindings.filter((b) => b.worker_id === worker_id).map((b) => b.wristband_qr);
    const scans = db.scans
      .filter((s) => s.worker_id === worker_id || qrs.includes(s.wristband_qr))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);
    return {
      ok: true,
      worker: safe,
      on_shift: !!activeBinding,
      active_wristband: activeBinding?.wristband_qr || null,
      recent_scans: scans,
    };
  },

  async workerHistory(worker_id) {
    const w = db.workers.find((wk) => wk.worker_id === worker_id);
    if (!w) return { ok: false, status: 404, error: "Worker not found." };
    const { pin_hash: _ph, ...safeWorker } = w;
    const qrs = db.bindings.filter((b) => b.worker_id === worker_id).map((b) => b.wristband_qr);
    const scans = db.scans
      .filter((s) => s.worker_id === worker_id || qrs.includes(s.wristband_qr))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { ok: true, worker: safeWorker, scans, bindings: db.bindings.filter((b) => b.worker_id === worker_id) };
  },
};
