/**
 * auth.js — Worker PIN hashing, JWT signing/verifying, and Express middleware.
 *
 * Environment variables required:
 *   JWT_SECRET   — random string used to sign worker session tokens (required)
 *   JWT_EXPIRY   — e.g. "12h" (default: "12h")
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn("[auth] JWT_SECRET not set in .env — using insecure fallback. Set JWT_SECRET before production use.");
  return "h2s-dosai-dev-secret-CHANGE-ME";
})();
const JWT_EXPIRY = process.env.JWT_EXPIRY || "12h";

/** Hash a plain-text PIN. Returns a bcrypt hash string. */
export async function hashPin(pin) {
  return bcrypt.hash(String(pin), SALT_ROUNDS);
}

/** Verify a plain-text PIN against a stored bcrypt hash. */
export async function comparePin(pin, hash) {
  return bcrypt.compare(String(pin), hash);
}

/** Sign a short-lived JWT scoped to the given worker_id. */
export function signWorkerToken(worker_id) {
  return jwt.sign(
    { sub: worker_id, role: "worker" },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY, issuer: "h2s-dosai" }
  );
}

/** Verify and decode a worker JWT. Throws on invalid/expired token. */
export function verifyWorkerToken(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: "h2s-dosai" });
}

/**
 * Express middleware: require a valid worker Bearer token.
 * Attaches req.worker = { worker_id } on success.
 * Rejects with 401 if missing, malformed, or expired.
 */
export function workerAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Worker session required. Please log in at /worker-login." });
  }
  try {
    const payload = verifyWorkerToken(header.slice(7));
    req.worker = { worker_id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ ok: false, code: "TOKEN_EXPIRED", error: "Session expired. Please log in again." });
  }
}
