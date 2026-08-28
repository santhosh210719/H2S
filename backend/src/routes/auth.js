/**
 * routes/auth.js — Worker PIN login endpoint.
 *
 * POST /api/auth/worker/login
 *   Body: { worker_id, pin }
 *   Returns: { ok: true, token, worker_id, expires_in }
 *
 * Rate limiting: 5 failed attempts per worker_id locks the account for 15 minutes.
 * The error message is deliberately generic to avoid leaking whether a worker_id exists.
 */
import { Router } from "express";
import { store } from "../store/index.js";
import { signWorkerToken, workerAuthMiddleware } from "../lib/auth.js";

export const authRouter = Router();

// In-memory fail counter: Map<worker_id, { count: number, lockedUntil: number }>
const failMap = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getFailRecord(worker_id) {
  const rec = failMap.get(worker_id) || { count: 0, lockedUntil: 0 };
  failMap.set(worker_id, rec);
  return rec;
}

function recordFail(worker_id) {
  const rec = getFailRecord(worker_id);
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0; // reset so counter is fresh after lockout expires
  }
}

function clearFail(worker_id) {
  failMap.delete(worker_id);
}

function isLocked(worker_id) {
  const rec = failMap.get(worker_id);
  if (!rec) return false;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) {
    failMap.delete(worker_id); // lockout expired
  }
  return false;
}

/**
 * POST /api/auth/worker/login
 */
authRouter.post("/worker/login", async (req, res) => {
  const { worker_id, pin } = req.body || {};

  if (!worker_id || !pin) {
    return res.status(400).json({ ok: false, error: "Worker ID and PIN are required." });
  }

  const id = String(worker_id).trim().toUpperCase();
  const pinStr = String(pin).trim();

  if (!/^\d{4,6}$/.test(pinStr)) {
    return res.status(400).json({ ok: false, error: "PIN must be 4–6 digits." });
  }

  // Lockout check (same generic message — no info leak)
  if (isLocked(id)) {
    return res.status(429).json({
      ok: false,
      code: "LOCKED",
      error: "Too many failed attempts. Please wait 15 minutes or contact your safety officer.",
    });
  }

  // Verify PIN via store (works for both memory and Supabase)
  let valid = false;
  try {
    valid = await store.verifyWorkerPin(id, pinStr);
  } catch (err) {
    console.error("[auth] verifyWorkerPin error:", err.message);
    return res.status(500).json({ ok: false, error: "Authentication service error." });
  }

  if (!valid) {
    recordFail(id);
    const rec = getFailRecord(id);
    const remaining = Math.max(0, MAX_ATTEMPTS - rec.count);
    return res.status(401).json({
      ok: false,
      code: "INVALID_CREDENTIALS",
      error: "Incorrect Worker ID or PIN.",
      attempts_remaining: remaining,
    });
  }

  // Success — clear fail counter, issue token
  clearFail(id);
  const token = signWorkerToken(id);

  return res.json({
    ok: true,
    token,
    worker_id: id,
    expires_in: process.env.JWT_EXPIRY || "12h",
  });
});

/**
 * GET /api/auth/worker/me
 * Returns the logged-in worker's profile, shift status, and recent scans.
 * Worker ID is derived from the verified JWT — a worker can only see their own data.
 */
authRouter.get("/worker/me", workerAuthMiddleware, async (req, res) => {
  try {
    const result = await store.getWorkerProfile(req.worker.worker_id);
    if (!result.ok) return res.status(result.status || 404).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
