import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { supabase, apiUrl } from "../lib/supabase.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
function bandClass(b) {
  return `pill ${b || ""}`;
}

function fmt(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RiskPill({ band }) {
  if (!band) return <span className="muted">—</span>;
  const labels = { fresh: "Fresh", low: "Low", medium: "Medium", high: "High", very_high: "Very High" };
  return <span className={bandClass(band)}>{labels[band] || band}</span>;
}

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(e) {
    e.preventDefault();
    setErr("");
    if (!supabase) {
      // Demo mode without Supabase — bypass login
      onLogin({ user: { email: "demo@mrpl.co.in" } });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">H₂S-DOSAI</div>
        <p className="login-tagline">Safety Desk — Admin Login</p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
          Supabase Auth · kiosk stations are unauthenticated and talk only to the API.
          {!supabase && " (Demo mode — no Supabase keys set, click Sign in to bypass.)"}
        </p>
        <form className="login-form" onSubmit={login}>
          <input
            id="admin-email"
            type="email"
            placeholder="Admin email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={!!supabase}
            autoFocus
          />
          <input
            id="admin-password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!!supabase}
          />
          <button id="admin-login-btn" className="btn primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
          {err && <p className="warn" style={{ margin: "8px 0 0" }}>{err}</p>}
        </form>
      </div>
    </div>
  );
}

// ── Worker History View ───────────────────────────────────────────────────────
function WorkerHistory({ worker, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/workers/${worker.worker_id}/history`))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d);
        else setErr(d.error || "Failed to load history");
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [worker.worker_id]);

  const chartData = (data?.scans || []).map((s, i) => ({
    t: fmt(s.timestamp),
    dose: s.dose_ppm_h,
    idx: i,
  }));

  return (
    <div className="history-view">
      <div className="history-nav">
        <button className="btn ghost" onClick={onBack}>
          ← Back to dashboard
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {worker.name} · {worker.worker_id} · {worker.department}
        </span>
      </div>

      <h2 style={{ marginTop: 16 }}>Exposure History</h2>

      {loading && <p className="muted">Loading…</p>}
      {err && <p className="warn">{err}</p>}

      {!loading && data && (
        <>
          {/* Line chart */}
          <div className="card chart-card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 12 }}>Cumulative dose over time (ppm·h)</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="t" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} unit=" ppm·h" />
                  <Tooltip
                    contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 13 }}
                    formatter={(v) => [`${v} ppm·h`, "Dose"]}
                  />
                  <ReferenceLine y={1} stroke="#e6d3b0" strokeDasharray="4 2" label={{ value: "Low", fill: "#e6d3b0", fontSize: 11 }} />
                  <ReferenceLine y={5} stroke="#c9a227" strokeDasharray="4 2" label={{ value: "Medium", fill: "#c9a227", fontSize: 11 }} />
                  <ReferenceLine y={20} stroke="#6b7a32" strokeDasharray="4 2" label={{ value: "High", fill: "#6b7a32", fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="dose"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "var(--accent)" }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="muted">No scan data yet for this worker.</p>
            )}
          </div>

          {/* Scan log table */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Scan log</h3>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Wristband QR</th>
                  <th>Dose (ppm·h)</th>
                  <th>Risk</th>
                  <th>Confidence</th>
                  <th>Quality</th>
                </tr>
              </thead>
              <tbody>
                {data.scans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">No scans recorded</td>
                  </tr>
                )}
                {[...data.scans].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{fmt(s.timestamp)}</td>
                    <td className="muted" style={{ fontFamily: "monospace" }}>{s.wristband_qr}</td>
                    <td>{s.dose_ppm_h ?? "—"}</td>
                    <td><RiskPill band={s.risk_band} /></td>
                    <td>{s.confidence != null ? `${(s.confidence * 100).toFixed(0)}%` : "—"}</td>
                    <td>
                      <span className={s.quality_status === "pass" ? "ok" : "warn"}>
                        {s.quality_status || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Shift bindings */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Shift bindings</h3>
            <table>
              <thead>
                <tr>
                  <th>Wristband QR</th>
                  <th>Shift start</th>
                  <th>Shift end</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {data.bindings.length === 0 && (
                  <tr><td colSpan={4} className="muted">No bindings yet</td></tr>
                )}
                {data.bindings.map((b) => (
                  <tr key={b.id}>
                    <td className="muted" style={{ fontFamily: "monospace" }}>{b.wristband_qr}</td>
                    <td>{fmt(b.shift_start)}</td>
                    <td>{b.shift_end ? fmt(b.shift_end) : <span className="ok">Active</span>}</td>
                    <td>{b.kiosk_location || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Admin Dashboard ──────────────────────────────────────────────────────
function Dashboard({ session, onLogout }) {
  const [workers, setWorkers] = useState([]);
  const [notice, setNotice] = useState("Loading…");
  const [selectedWorker, setSelectedWorker] = useState(null);

  async function loadWorkers() {
    try {
      const res = await fetch(apiUrl("/api/workers"));
      const data = await res.json();
      if (data.ok) {
        setWorkers(data.workers || []);
        setNotice(`Last updated ${new Date().toLocaleTimeString("en-IN")}`);
      } else {
        setNotice("Failed to load workers: " + (data.error || "unknown error"));
      }
    } catch (e) {
      setNotice("API error: " + e.message);
    }
  }

  useEffect(() => {
    loadWorkers();

    if (!supabase) return;

    const channel = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scan_logs" }, (payload) => {
        setNotice(`Live: new scan ${payload.new.id?.slice(0, 8)}`);
        loadWorkers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_bindings" }, () => loadWorkers())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_ambient_readings" }, () =>
        loadWorkers()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  if (selectedWorker) {
    return (
      <div className="shell">
        <div className="topbar-inner">
          <span className="muted">{session?.user?.email}</span>
          <button className="btn ghost" onClick={onLogout}>Sign out</button>
        </div>
        <WorkerHistory worker={selectedWorker} onBack={() => setSelectedWorker(null)} />
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 style={{ margin: 0 }}>Live Exposure Desk</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{notice}</p>
        </div>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>{session?.user?.email}</span>
          <button id="admin-logout-btn" className="btn ghost" onClick={onLogout}>
            Sign out
          </button>
          <button className="btn" onClick={loadWorkers}>↻ Refresh</button>
        </div>
      </div>

      {/* Workers table */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h3>Workers — Latest Exposure Reading</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Passive badge is the primary measurement. Click any row for full history.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Worker</th>
              <th>Department</th>
              <th>Shift</th>
              <th>Active Band</th>
              <th>Latest Dose</th>
              <th>Risk Band</th>
              <th>Confidence</th>
              <th>Scan Time</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No workers found. Run migrations + seed data.</td>
              </tr>
            )}
            {workers.map((w) => {
              const s = w.latest_scan;
              return (
                <tr
                  key={w.worker_id}
                  className="clickable-row"
                  onClick={() => setSelectedWorker(w)}
                  title="Click for full history"
                >
                  <td>
                    <strong>{w.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{w.worker_id}</div>
                  </td>
                  <td>{w.department || "—"}</td>
                  <td>{w.shift || "—"}</td>
                  <td>
                    {w.active_binding ? (
                      <span className="muted" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {w.active_binding.wristband_qr}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{s ? `${s.dose_ppm_h} ppm·h` : <span className="muted">—</span>}</td>
                  <td>{s ? <RiskPill band={s.risk_band} /> : <span className="muted">—</span>}</td>
                  <td>
                    {s?.confidence != null
                      ? `${(s.confidence * 100).toFixed(0)}%`
                      : <span className="muted">—</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmt(s?.timestamp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Environmental / Ambient panel — Phase 3 placeholder */}
      <div className="card ambient-placeholder" style={{ marginTop: 16 }}>
        <div className="ambient-header">
          <h3>🌫 Environmental / Ambient Sensor Pack</h3>
          <span className="pill fresh" style={{ fontSize: 12 }}>Phase 3 — Placeholder</span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Real-time MQ-136 (H₂S gas sensor) + DHT-11 (temperature + humidity) readings from the kiosk sensor
          pack will appear here. This is a <strong>supplementary live layer only</strong> — the passive colorimetric
          badge remains the primary PS-answering measurement.
        </p>
        <div className="ambient-grid">
          <div className="ambient-tile">
            <div className="ambient-label">Live H₂S (ambient)</div>
            <div className="ambient-value">— ppm</div>
            <div className="ambient-sub">MQ-136 · KIOSK-MUSTER-01</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Temperature</div>
            <div className="ambient-value">— °C</div>
            <div className="ambient-sub">DHT-11</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Humidity</div>
            <div className="ambient-value">— %</div>
            <div className="ambient-sub">DHT-11</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Last reading</div>
            <div className="ambient-value" style={{ fontSize: 16 }}>No data</div>
            <div className="ambient-sub">Sensor pack not connected</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root Admin Page ───────────────────────────────────────────────────────────
export function AdminPage() {
  const [session, setSession] = useState(undefined); // undefined = checking

  useEffect(() => {
    if (!supabase) {
      setSession(null); // no supabase — show login (demo bypass)
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase?.auth.signOut();
    setSession(null);
  }

  if (session === undefined) {
    return (
      <div className="shell" style={{ textAlign: "center", paddingTop: 80 }}>
        <p className="muted">Checking authentication…</p>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={(s) => setSession(s)} />;
  }

  return <Dashboard session={session} onLogout={logout} />;
}
