import { useEffect, useState } from "react";
import { supabase, apiUrl } from "../lib/supabase.js";

function bandClass(b) {
  return `pill ${b || ""}`;
}

export function AdminPage() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [scans, setScans] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [notice, setNotice] = useState("Waiting for kiosk scans…");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadOverview() {
    const res = await fetch(apiUrl("/api/admin/overview"));
    const data = await res.json();
    if (data.ok) {
      setScans(data.scans || []);
      setShifts(data.active_shifts || []);
    }
  }

  useEffect(() => {
    if (!session) return undefined;
    loadOverview();
    if (!supabase) return undefined;
    const channel = supabase
      .channel("scans-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scans" }, (payload) => {
        setNotice(`Live: new scan ${payload.new.id}`);
        loadOverview();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => loadOverview())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_readings" }, () => loadOverview())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  async function login(e) {
    e.preventDefault();
    setAuthErr("");
    if (!supabase) {
      setAuthErr("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthErr(error.message);
  }

  async function logout() {
    await supabase?.auth.signOut();
  }

  if (!session) {
    return (
      <div className="shell" style={{ maxWidth: 420 }}>
        <h1>Safety desk login</h1>
        <p className="muted">Supabase Auth — kiosk stations stay unauthenticated and talk to the API only.</p>
        <form className="card grid" onSubmit={login}>
          <input type="email" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn primary" type="submit">Sign in</button>
          {authErr && <p className="warn">{authErr}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Live exposure desk</h1>
          <p className="muted">{notice} · {session.user.email}</p>
        </div>
        <button className="btn ghost" onClick={logout}>Sign out</button>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Active shifts (passive badge is primary)</h3>
        <p className="muted">
          Live sensor columns are the optional MQ-136 / DHT-11 pack — supplementary only, not a replacement for the badge.
        </p>
        <table>
          <thead>
            <tr>
              <th>Worker</th>
              <th>Wristband</th>
              <th>Latest badge dose</th>
              <th>Risk</th>
              <th>Live H2S (pack)</th>
              <th>T / RH (pack)</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const latest = scans.find((c) => c.shift_id === s.id);
              const pack = s.live_sensor;
              return (
                <tr key={s.id}>
                  <td>
                    {s.workers?.full_name}
                    <div className="muted">{s.workers?.worker_code}</div>
                  </td>
                  <td>{s.wristbands?.qr_code}</td>
                  <td>{latest?.dose_ppm_h ?? "—"} ppm·h</td>
                  <td>
                    {latest?.risk_band ? <span className={bandClass(latest.risk_band)}>{latest.risk_band}</span> : "—"}
                  </td>
                  <td>{pack ? `${pack.h2s_ppm} ppm` : "— no pack"}</td>
                  <td>{pack ? `${pack.temperature_c}°C / ${pack.humidity_pct}%` : "—"}</td>
                </tr>
              );
            })}
            {!shifts.length && (
              <tr>
                <td colSpan={6} className="muted">No active shifts</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Scan log</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Worker</th>
              <th>Band</th>
              <th>Dose</th>
              <th>Conf</th>
              <th>Blur / glare</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.created_at).toLocaleString()}</td>
                <td>{c.workers?.full_name}</td>
                <td>{c.wristbands?.qr_code}</td>
                <td>
                  {c.dose_ppm_h} <span className={bandClass(c.risk_band)}>{c.risk_band}</span>
                </td>
                <td>{c.confidence}</td>
                <td>
                  {c.blur_score} / {c.glare_ratio}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
