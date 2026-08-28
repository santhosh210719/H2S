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

  // Should never render without supabase — parent guards this
  if (!supabase) return null;

  async function login(e) {
    e.preventDefault();
    setErr("");
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
          Supabase Auth · enter your admin email and password.
        </p>
        <form className="login-form" onSubmit={login}>
          <input
            id="admin-email"
            type="email"
            placeholder="Admin email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            id="admin-password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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

// ── Worker History View + TWA & CSV Export ─────────────────────────────────────
function WorkerHistory({ worker, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/workers/${worker.worker_id}/history`), { cache: "no-store" })
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

  // Calculate 8-hour Time-Weighted Average (TWA)
  const latestScan = data?.scans?.length ? data.scans[data.scans.length - 1] : null;
  const latestDose = latestScan?.dose_ppm_h || 0;
  const twa8hr = Number((latestDose / 8.0).toFixed(2));
  const twaStatus = twa8hr > 15 ? "exceeded" : twa8hr > 10 ? "warning" : "normal";

  // CSV Report Generator
  function downloadCsv() {
    if (!data) return;
    const headers = ["Scan ID,Timestamp,Worker ID,Worker Name,Wristband QR,Dose (ppm·h),Risk Band,Confidence,Quality Status\n"];
    const rows = (data.scans || []).map((s) => [
      s.id,
      `"${s.timestamp}"`,
      worker.worker_id,
      `"${worker.name}"`,
      s.wristband_qr,
      s.dose_ppm_h ?? "",
      s.risk_band ?? "",
      s.confidence != null ? (s.confidence * 100).toFixed(1) + "%" : "",
      s.quality_status || "",
    ].join(","));

    const csvContent = "data:text/csv;charset=utf-8," + headers.concat(rows).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `shift_report_${worker.worker_id}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="history-view">
      <div className="history-nav" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <button className="btn ghost" onClick={onBack}>
            ← Back to dashboard
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            {worker.name} · {worker.worker_id} · {worker.department}
          </span>
        </div>
        <button id="export-csv-btn" className="btn primary" onClick={downloadCsv} disabled={!data}>
          📥 Export Shift Report (CSV)
        </button>
      </div>

      <div className="row" style={{ marginTop: 16, alignItems: "center", justifyContent: "space-between" }}>
        <h2>Exposure History & TWA Metrics</h2>
        {/* TWA Metric Badge */}
        <div className="card" style={{ padding: "8px 16px", display: "flex", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)" }}>8-Hr TWA Exposure</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{twa8hr} <small style={{ fontSize: "0.65em" }}>ppm</small></div>
          </div>
          <div>
            {twaStatus === "exceeded" && <span className="pill very_high">OSHA STEL EXCEEDED (&gt;15 ppm)</span>}
            {twaStatus === "warning" && <span className="pill high">WARNING (&gt;10 ppm)</span>}
            {twaStatus === "normal" && <span className="pill fresh">NORMAL (&lt;10 ppm)</span>}
          </div>
        </div>
      </div>

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

// ── Manage Workers Panel (inside admin dashboard) ─────────────────────────────
function ManageWorkers({ session }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState("WKR-0001");
  const [revealedPin, setRevealedPin] = useState(null); // { worker_id, pin }
  const [resetReveal, setResetReveal] = useState(null); // { worker_id, new_pin }

  // Form fields
  const [fId, setFId] = useState("");
  const [fName, setFName] = useState("");
  const [fDept, setFDept] = useState("");
  const [fShift, setFShift] = useState("");
  const [fPin, setFPin] = useState("");
  const [fPinConfirm, setFPinConfirm] = useState("");

  async function authHeaders() {
    let token = "";
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || session?.access_token || "";
    } else {
      token = session?.access_token || "local-admin-dev-token";
    }
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
  }

  async function loadWorkers() {
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl("/api/admin/workers"), { headers, cache: "no-store" });
      const data = await res.json();
      if (data.ok) setWorkers(data.workers || []);
      else setErr(data.error || "Failed to load workers.");
    } catch {
      setErr("API error loading workers.");
    }
  }

  async function loadNextId() {
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl("/api/admin/workers/next-id"), { headers, cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setNextId(data.next_id);
        if (!fId) setFId(data.next_id);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    Promise.all([loadWorkers(), loadNextId()])
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setFormErr("");
    setRevealedPin(null);

    if (fPin !== fPinConfirm) {
      setFormErr("PINs do not match.");
      return;
    }
    if (!/^\d{4,6}$/.test(fPin)) {
      setFormErr("PIN must be 4–6 digits.");
      return;
    }

    setBusy(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl("/api/admin/workers"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          worker_id: fId.trim().toUpperCase(),
          name: fName.trim(),
          department: fDept.trim(),
          shift: fShift.trim(),
          pin: fPin,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormErr(data.error || "Failed to create worker.");
        return;
      }
      // Show PIN once
      setRevealedPin({ worker_id: data.worker?.worker_id || fId, pin: fPin });
      // Reset form
      setFId(""); setFName(""); setFDept(""); setFShift("");
      setFPin(""); setFPinConfirm("");
      await loadWorkers();
      await loadNextId();
    } catch {
      setFormErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(wid, currentlyActive) {
    const endpoint = currentlyActive
      ? `/api/admin/workers/${wid}/deactivate`
      : `/api/admin/workers/${wid}/activate`;
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl(endpoint), {
        method: "PATCH",
        headers,
      });
      const data = await res.json();
      if (data.ok) await loadWorkers();
      else setErr(data.error || "Failed to update worker.");
    } catch {
      setErr("Network error.");
    }
  }

  async function resetPin(wid) {
    setResetReveal(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl(`/api/admin/workers/${wid}/reset-pin`), {
        method: "PATCH",
        headers,
      });
      const data = await res.json();
      if (data.ok) {
        setResetReveal({ worker_id: wid, new_pin: data.new_pin });
      } else {
        setErr(data.error || "Failed to reset PIN.");
      }
    } catch {
      setErr("Network error.");
    }
  }

  if (loading) return <p className="muted">Loading workers…</p>;

  return (
    <div>
      {err && <div className="banner warn" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Add Worker Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Add new worker</h3>
        <form className="add-worker-form" onSubmit={handleAdd}>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Worker ID</label>
            <input
              value={fId}
              onChange={(e) => setFId(e.target.value.toUpperCase())}
              placeholder={nextId}
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Full name</label>
            <input
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="e.g. Arun Kumar"
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Department</label>
            <input
              value={fDept}
              onChange={(e) => setFDept(e.target.value)}
              placeholder="e.g. CDU, VDU, SRU"
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Shift</label>
            <input
              value={fShift}
              onChange={(e) => setFShift(e.target.value)}
              placeholder="e.g. A, B, C, General"
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>PIN (4–6 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              value={fPin}
              onChange={(e) => setFPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="e.g. 1234"
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={fPinConfirm}
              onChange={(e) => setFPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Re-enter PIN"
              required
            />
          </div>
          <div className="full-width">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "➕ Add worker"}
            </button>
          </div>
          {formErr && (
            <p className="warn full-width" style={{ margin: 0, fontSize: 13 }}>{formErr}</p>
          )}
        </form>

        {/* One-time PIN reveal after creation */}
        {revealedPin && (
          <div style={{ marginTop: 16, padding: 12, background: "var(--panel-2)", borderRadius: "var(--r-sm)" }}>
            <p style={{ margin: "0 0 8px", fontSize: 13 }}>
              ✅ Worker <strong>{revealedPin.worker_id}</strong> created. Give them this PIN:
            </p>
            <div className="pin-reveal">
              {revealedPin.pin}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
              This PIN will not be shown again. If lost, use "Reset PIN" to generate a new one.
            </p>
          </div>
        )}
      </div>

      {/* Reset PIN reveal */}
      {resetReveal && (
        <div className="banner" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13 }}>
              🔑 New PIN for <strong>{resetReveal.worker_id}</strong>:
            </p>
            <div className="pin-reveal" style={{ marginTop: 8 }}>
              {resetReveal.new_pin}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
              This PIN is shown exactly once. Relay it to the worker now.
            </p>
          </div>
          <button className="btn ghost" onClick={() => setResetReveal(null)}>Dismiss</button>
        </div>
      )}

      {/* Workers table */}
      <div className="card">
        <div className="card-head">
          <h3>All workers</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {workers.length} worker{workers.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Worker ID</th>
              <th>Name</th>
              <th>Dept</th>
              <th>Shift</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No workers yet. Use the form above to add the first worker.
                </td>
              </tr>
            )}
            {workers.map((w) => (
              <tr key={w.worker_id} style={{ opacity: w.active === false ? 0.5 : 1 }}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{w.worker_id}</td>
                <td><strong>{w.name}</strong></td>
                <td>{w.department || "—"}</td>
                <td>{w.shift || "—"}</td>
                <td>
                  {w.active !== false ? (
                    <span className="ok" style={{ fontSize: 12 }}>Active</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>Inactive</span>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{fmt(w.created_at)}</td>
                <td>
                  <div className="worker-actions">
                    <button
                      className="btn ghost"
                      title="Reset PIN"
                      onClick={() => resetPin(w.worker_id)}
                    >
                      🔑
                    </button>
                    <button
                      className={`btn ${w.active !== false ? "danger" : "primary"}`}
                      onClick={() => toggleActive(w.worker_id, w.active !== false)}
                    >
                      {w.active !== false ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Register & Manage Wristbands Panel ────────────────────────────────────────
function ManageWristbands({ session }) {
  const [wristbands, setWristbands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const [fQr, setFQr] = useState("");
  const [fBatch, setFBatch] = useState("");

  async function authHeaders() {
    let token = "";
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || session?.access_token || "";
    } else {
      token = session?.access_token || "local-admin-dev-token";
    }
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
  }

  async function loadWristbands() {
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl("/api/admin/wristbands"), { headers, cache: "no-store" });
      const data = await res.json();
      if (data.ok) setWristbands(data.wristbands || []);
      else setErr(data.error || "Failed to load wristbands.");
    } catch {
      setErr("API error loading wristbands.");
    }
  }

  useEffect(() => {
    loadWristbands().finally(() => setLoading(false));
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setFormErr("");
    setSuccessMsg("");

    const qr = fQr.trim();
    if (!qr) {
      setFormErr("Wristband QR is required.");
      return;
    }

    setBusy(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl("/api/admin/wristbands"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          wristband_qr: qr,
          batch_id: fBatch.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormErr(data.error || "Failed to register wristband.");
        return;
      }
      setSuccessMsg(`✅ Wristband ${data.wristband?.wristband_qr || qr} registered successfully.`);
      setFQr("");
      setFBatch("");
      await loadWristbands();
    } catch {
      setFormErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading wristbands…</p>;

  function statusPill(st) {
    if (st === "available") return <span className="pill fresh">Available</span>;
    if (st === "bound") return <span className="pill medium">Bound</span>;
    if (st === "used") return <span className="pill very_high">Used</span>;
    return <span className="muted">{st || "—"}</span>;
  }

  return (
    <div>
      {err && <div className="banner warn" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Add Wristband Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Register new wristband</h3>
        <form className="add-worker-form" onSubmit={handleAdd}>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Wristband QR Code</label>
            <input
              id="wristband-qr-admin-input"
              value={fQr}
              onChange={(e) => setFQr(e.target.value)}
              placeholder="e.g. WB-2026-000482"
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Batch ID (optional)</label>
            <input
              id="wristband-batch-admin-input"
              value={fBatch}
              onChange={(e) => setFBatch(e.target.value)}
              placeholder="e.g. BATCH-2026-01"
            />
          </div>
          <div className="full-width">
            <button id="register-wristband-btn" className="btn primary" type="submit" disabled={busy}>
              {busy ? "Registering…" : "🏷️ Register wristband"}
            </button>
          </div>
          {formErr && (
            <p className="warn full-width" style={{ margin: 0, fontSize: 13 }}>{formErr}</p>
          )}
          {successMsg && (
            <p className="ok full-width" style={{ margin: 0, fontSize: 13 }}>{successMsg}</p>
          )}
        </form>
      </div>

      {/* Wristbands Table */}
      <div className="card">
        <div className="card-head">
          <h3>Registered wristbands</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {wristbands.length} wristband{wristbands.length !== 1 ? "s" : ""} in inventory
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Wristband QR</th>
              <th>Batch ID</th>
              <th>Status</th>
              <th>Registered Date</th>
            </tr>
          </thead>
          <tbody>
            {wristbands.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No wristbands registered yet. Use the form above to add one.
                </td>
              </tr>
            )}
            {wristbands.map((wb) => (
              <tr key={wb.wristband_qr}>
                <td style={{ fontFamily: "monospace", fontSize: 13 }}>
                  <strong>{wb.wristband_qr}</strong>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{wb.batch_id || "—"}</td>
                <td>{statusPill(wb.status)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{fmt(wb.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Admin Dashboard ──────────────────────────────────────────────────────
function Dashboard({ session, onLogout }) {
  const [workers, setWorkers] = useState([]);
  const [notice, setNotice] = useState("Loading…");
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [tab, setTab] = useState("desk");

  // Live Ambient Telemetry State
  const [ambientReadings, setAmbientReadings] = useState([]);
  const [latestAmbient, setLatestAmbient] = useState(null);
  const [injectingGas, setInjectingGas] = useState(false);

  async function loadWorkers() {
    try {
      const res = await fetch(apiUrl("/api/workers"), { cache: "no-store" });
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

  async function loadAmbient() {
    try {
      const res = await fetch(apiUrl("/api/ambient/latest?limit=30"));
      const data = await res.json();
      if (data.ok) {
        setAmbientReadings(data.recent || []);
        setLatestAmbient(data.latest || null);
      }
    } catch {
      // silent ambient retry
    }
  }

  // Trigger synthetic gas leak spike for live demo presentation
  async function triggerGasSpike() {
    setInjectingGas(true);
    try {
      await fetch(apiUrl("/api/ambient"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kiosk_location: "KIOSK-MUSTER-01",
          ambient_h2s_ppm: 14.8,
          temperature_c: 32.4,
          humidity_percent: 71.0,
        }),
      });
      await loadAmbient();
    } finally {
      setInjectingGas(false);
    }
  }

  useEffect(() => {
    loadWorkers();
    loadAmbient();

    // Ambient polling loop every 2.5 seconds
    const interval = setInterval(loadAmbient, 2500);

    if (!supabase) return () => clearInterval(interval);

    const channel = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scan_logs" }, (payload) => {
        setNotice(`Live: new scan ${payload.new.id?.slice(0, 8)}`);
        loadWorkers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_bindings" }, () => loadWorkers())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_ambient_readings" }, () => {
        loadAmbient();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
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

  const isLeakAlert = latestAmbient && latestAmbient.ambient_h2s_ppm > 10.0;
  const ambientH2s = latestAmbient ? latestAmbient.ambient_h2s_ppm : null;
  const ambientTemp = latestAmbient ? latestAmbient.temperature_c : null;
  const ambientHum = latestAmbient ? latestAmbient.humidity_percent : null;

  const ambientChartData = ambientReadings.map((r) => ({
    t: new Date(r.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    ppm: r.ambient_h2s_ppm,
  }));

  return (
    <div className="shell">
      {/* Gas Leak Emergency Banner */}
      {isLeakAlert && (
        <div className="banner warn" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong style={{ fontSize: 16 }}>🚨 CRITICAL AMBIENT GAS LEAK ALERT — {ambientH2s} ppm H₂S DETECTED</strong>
            <p style={{ margin: "2px 0 0", fontSize: 13 }}>
              Muster Point KIOSK-MUSTER-01 ambient sensor exceeds safety threshold (10 ppm). Evacuate area immediately!
            </p>
          </div>
          <button className="btn danger" onClick={loadAmbient}>Acknowledge</button>
        </div>
      )}

      {/* Header */}
      <div className="admin-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Safety Desk Admin</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{notice}</p>
        </div>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>{session?.user?.email}</span>
          <button id="admin-logout-btn" className="btn ghost" onClick={onLogout}>
            Sign out
          </button>
          <button className="btn" onClick={() => { loadWorkers(); loadAmbient(); }}>↻ Refresh</button>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === "desk" ? "active" : ""}`}
          onClick={() => setTab("desk")}
        >
          📊 Exposure Desk
        </button>
        <button
          id="manage-workers-tab"
          className={`admin-tab ${tab === "manage" ? "active" : ""}`}
          onClick={() => setTab("manage")}
        >
          👷 Manage Workers
        </button>
        <button
          id="manage-wristbands-tab"
          className={`admin-tab ${tab === "wristbands" ? "active" : ""}`}
          onClick={() => setTab("wristbands")}
        >
          🏷️ Wristbands
        </button>
      </div>

      {tab === "manage" && <ManageWorkers session={session} />}
      {tab === "wristbands" && <ManageWristbands session={session} />}
      {tab === "desk" && (
        <>
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
                    <td colSpan={8} className="muted">
                      No workers registered yet. Use the "Manage Workers" tab to add workers.
                    </td>
                  </tr>
                )}
            {workers.map((w) => {
              const s = w.latest_scan;
              const isHigh = s?.risk_band === "high";
              const isVeryHigh = s?.risk_band === "very_high";
              const rowClass = `clickable-row ${isVeryHigh ? "row-very-high" : isHigh ? "row-high" : ""}`;

              return (
                <tr
                  key={w.worker_id}
                  className={rowClass}
                  onClick={() => setSelectedWorker(w)}
                  title="Click for full history"
                >
                  <td>
                    <strong>{w.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {w.worker_id}
                      {isVeryHigh && <span className="escalation-badge danger">⚠ CRITICAL ESCALATION</span>}
                      {isHigh && <span className="escalation-badge warn">⚠ HIGH RISK</span>}
                    </div>
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

      {/* Environmental / Ambient Telemetry Station — Live Phase 3 */}
      <div className="card" style={{ marginTop: 20, borderColor: isLeakAlert ? "var(--danger)" : "var(--line)" }}>
        <div className="ambient-header" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3>🌫 Environmental / Ambient IoT Telemetry Station</h3>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
              Real-time MQ-136 (H₂S gas) + DHT-11 (temp & humidity) telemetry stream · KIOSK-MUSTER-01
            </p>
          </div>
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="pill fresh" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3dba7a", display: "inline-block" }} />
              LIVE TELEMETRY STREAMING
            </span>
            <button
              id="inject-gas-spike-btn"
              className="btn danger"
              onClick={triggerGasSpike}
              disabled={injectingGas}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {injectingGas ? "Injecting…" : "⚠️ Simulate Gas Spike"}
            </button>
          </div>
        </div>

        <div className="ambient-grid" style={{ marginTop: 16 }}>
          <div className="ambient-tile" style={{ borderColor: isLeakAlert ? "var(--danger)" : "var(--line)" }}>
            <div className="ambient-label">Live H₂S (Ambient)</div>
            <div className="ambient-value" style={{ color: isLeakAlert ? "var(--danger)" : "var(--ink)" }}>
              {ambientH2s != null ? `${ambientH2s} ppm` : "— ppm"}
            </div>
            <div className="ambient-sub">MQ-136 · Sensor Array</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Temperature</div>
            <div className="ambient-value">{ambientTemp != null ? `${ambientTemp} °C` : "— °C"}</div>
            <div className="ambient-sub">DHT-11</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Humidity</div>
            <div className="ambient-value">{ambientHum != null ? `${ambientHum} %` : "— %"}</div>
            <div className="ambient-sub">DHT-11</div>
          </div>
          <div className="ambient-tile">
            <div className="ambient-label">Last Reading</div>
            <div className="ambient-value" style={{ fontSize: 15 }}>
              {latestAmbient ? fmt(latestAmbient.timestamp) : "No data"}
            </div>
            <div className="ambient-sub">Telemetry status</div>
          </div>
        </div>

        {/* Ambient H2S Telemetry Graph */}
        {ambientChartData.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <h4 style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Ambient H₂S Gas Level Trend (ppm)</h4>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={ambientChartData} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="t" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} unit=" ppm" domain={[0, "auto"]} />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12 }}
                  formatter={(v) => [`${v} ppm`, "Ambient H₂S"]}
                />
                <ReferenceLine y={10} stroke="var(--danger)" strokeDasharray="3 3" label={{ value: "10 ppm Alarm", fill: "var(--danger)", fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="ppm"
                  stroke={isLeakAlert ? "var(--danger)" : "var(--ok)"}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

// ── Root Admin Page ───────────────────────────────────────────────────────────
export function AdminPage() {
  const [session, setSession] = useState(undefined); // undefined = checking

  useEffect(() => {
    if (!supabase) {
      // Supabase not configured — do not auto-login, show not-configured message
      setSession("not-configured");
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

  if (session === "not-configured") {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-logo">H₂S-DOSAI</div>
          <p className="login-tagline">Admin Dashboard</p>
          <div className="banner warn" style={{ marginTop: 24 }}>
            <strong>Auth not configured</strong><br />
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{" "}
            in your <code>.env</code> file, then restart the dev server.
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
            Admin login requires a configured Supabase project. See{" "}
            <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>{" "}
            to create a free project.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={(s) => setSession(s)} />;
  }

  return <Dashboard session={session} onLogout={logout} />;
}
