import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../lib/supabase.js";

export function WorkerLoginPage() {
  const [workerId, setWorkerId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    const id = workerId.trim().toUpperCase();
    const pinStr = pin.trim();
    if (!id || !pinStr) { setErr("Worker ID and PIN are required."); return; }
    if (!/^\d{4,6}$/.test(pinStr)) { setErr("PIN must be 4–6 digits."); return; }

    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/auth/worker/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: id, pin: pinStr }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error || "Login failed.");
        return;
      }
      // Store token in sessionStorage — scoped to this tab/session only
      sessionStorage.setItem("workerToken", data.token);
      sessionStorage.setItem("workerId", data.worker_id);
      navigate("/worker-dashboard", { replace: true });
    } catch {
      setErr("Network error — is the API server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">H₂S-DOSAI</div>
        <p className="login-tagline">Kiosk Station Login</p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          Enter your Worker ID and PIN to begin your shift scan session.
          Contact your safety officer if you have not been set up yet.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <input
            id="worker-id-login"
            type="text"
            placeholder="Worker ID (e.g. WKR-0001)"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="username"
            autoFocus
            required
          />
          <input
            id="worker-pin-login"
            type="password"
            placeholder="4–6 digit PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="current-password"
            required
          />
          <button
            id="worker-login-btn"
            className="btn primary"
            type="submit"
            disabled={busy}
          >
            {busy ? "Verifying…" : "Start kiosk session →"}
          </button>
          {err && (
            <p className="warn" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {err}
            </p>
          )}
        </form>

        <p style={{ marginTop: 32, fontSize: 12, textAlign: "center" }} className="muted">
          Admin?{" "}
          <a href="/admin-login" style={{ color: "var(--accent)" }}>
            Admin dashboard login →
          </a>
        </p>
      </div>
    </div>
  );
}
