import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiUrl } from "../lib/supabase.js";

function fmt(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function RiskPill({ band }) {
  if (!band) return <span className="muted">—</span>;
  const labels = { fresh: "Fresh", low: "Low", medium: "Medium", high: "High", very_high: "Very High" };
  return <span className={`pill ${band}`}>{labels[band] || band}</span>;
}

export function WorkerDashboardPage() {
  const navigate = useNavigate();
  const workerId = sessionStorage.getItem("workerId") || "";
  const token = sessionStorage.getItem("workerToken") || "";
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) { navigate("/worker-login", { replace: true }); return; }
    fetch(apiUrl("/api/auth/worker/me"), {
      headers: { "Authorization": `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setProfile(d);
        else setErr(d.error || "Failed to load profile.");
      })
      .catch(() => setErr("Network error — is the API running?"))
      .finally(() => setLoading(false));
  }, [token, navigate]);

  function logout() {
    sessionStorage.removeItem("workerToken");
    sessionStorage.removeItem("workerId");
    navigate("/worker-login", { replace: true });
  }

  if (loading) {
    return (
      <div className="shell" style={{ textAlign: "center", paddingTop: 80 }}>
        <p className="muted">Loading dashboard…</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="shell" style={{ textAlign: "center", paddingTop: 80 }}>
        <p className="warn">{err}</p>
        <button className="btn primary" onClick={logout} style={{ marginTop: 16 }}>
          ← Back to login
        </button>
      </div>
    );
  }

  const w = profile?.worker;
  const scans = profile?.recent_scans || [];
  const onShift = profile?.on_shift;
  const activeWristband = profile?.active_wristband;

  return (
    <div className="shell worker-dash">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(1.3rem, 4vw, 1.8rem)" }}>
            Welcome, {w?.name || workerId}
          </h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {w?.worker_id} · {w?.department || "—"} · Shift {w?.shift || "—"}
          </p>
        </div>
        <button className="btn ghost" onClick={logout}>
          🔓 Log out
        </button>
      </div>

      {/* Status cards */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-label">Shift status</div>
          <div className="dash-card-value">
            {onShift ? (
              <span className="ok" style={{ fontWeight: 700 }}>● On shift</span>
            ) : (
              <span className="muted" style={{ fontWeight: 700 }}>○ Off shift</span>
            )}
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-label">Wristband</div>
          <div className="dash-card-value" style={{ fontFamily: "monospace", fontSize: 13 }}>
            {activeWristband || <span className="muted">None bound</span>}
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-label">Recent scans</div>
          <div className="dash-card-value">{scans.length}</div>
        </div>
      </div>

      {/* Primary CTA */}
      <Link to="/kiosk" id="start-kiosk-btn" className="dash-cta">
        <span style={{ fontSize: "1.6rem" }}>📸</span>
        <div>
          <strong style={{ fontSize: 16 }}>Start Kiosk Session</strong>
          <small style={{ display: "block", fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            Scan wristband badge at this station
          </small>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 20, opacity: 0.6 }}>→</span>
      </Link>

      {/* Recent scan history */}
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Recent scan history</h3>
        {scans.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No scans recorded yet. Start a kiosk session to scan your wristband.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Wristband</th>
                <th>Dose (ppm·h)</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontSize: 12 }}>{fmt(s.timestamp)}</td>
                  <td className="muted" style={{ fontFamily: "monospace", fontSize: 12 }}>{s.wristband_qr}</td>
                  <td>{s.dose_ppm_h ?? "—"}</td>
                  <td><RiskPill band={s.risk_band} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
