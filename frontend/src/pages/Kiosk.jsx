import { useCallback, useRef, useState } from "react";
import { CameraCapture, QrScanner, makeSyntheticBadge } from "../lib/camera.jsx";
import { apiUrl } from "../lib/supabase.js";

const KIOSK_ID = "KIOSK-MUSTER-01";

async function postJson(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || "Request failed");
    err.payload = data;
    throw err;
  }
  return data;
}

function RiskPill({ band }) {
  if (!band) return null;
  const labels = { fresh: "Fresh", low: "Low", medium: "Medium", high: "High", very_high: "Very High" };
  return <span className={`pill ${band}`}>{labels[band] || band}</span>;
}

// ── Screen A: Scan Worker ID ──────────────────────────────────────────────────
function ScreenA({ onWorker }) {
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState("");

  function submit(val) {
    const v = String(val).trim();
    if (!v) return;
    setErr("");
    onWorker(v);
  }

  return (
    <div className="kiosk-screen">
      <div className="screen-label">Screen A</div>
      <div className="screen-icon">👷</div>
      <h2>Scan Worker ID</h2>
      <p className="muted">Point the worker's ID badge QR at the kiosk camera, or type the ID below.</p>

      <div className="kiosk-input-group">
        <input
          id="worker-id-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(typed)}
          placeholder="e.g. WKR-1001"
          autoFocus
        />
        <button id="worker-id-submit" className="btn primary" onClick={() => submit(typed)} disabled={!typed.trim()}>
          Confirm →
        </button>
      </div>

      <div className="qr-toggle">
        <button className="btn ghost" onClick={() => setScanning((s) => !s)}>
          {scanning ? "▲ Hide camera" : "▼ Use QR camera"}
        </button>
      </div>
      {scanning && (
        <QrScanner
          active
          demoCodes={["WKR-1001", "WKR-1002", "WKR-1003"]}
          onDecode={(text) => {
            setScanning(false);
            submit(text);
          }}
        />
      )}
      {err && <p className="warn" style={{ marginTop: 12 }}>{err}</p>}

      <div className="seed-hint card" style={{ marginTop: 24 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <strong>Demo IDs:</strong> WKR-1001 (Arun Kumar) · WKR-1002 (Priya Nair) · WKR-1003 (Rahul Shetty)
        </p>
      </div>
    </div>
  );
}

// ── Screen B: Scan Wristband QR ───────────────────────────────────────────────
function ScreenB({ workerCode, onBound, onBack }) {
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function bind(qr) {
    const v = String(qr).trim();
    if (!v) return;
    setBusy(true);
    setErr("");
    try {
      const data = await postJson("/api/kiosk/bind", {
        worker_id: workerCode,
        wristband_qr: v,
        kiosk_id: KIOSK_ID,
      });
      onBound(v, data.worker);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kiosk-screen">
      <div className="screen-label">Screen B</div>
      <div className="screen-icon">🔗</div>
      <h2>Scan Wristband QR</h2>
      <p className="muted">
        Worker: <strong>{workerCode}</strong> · Scan the factory QR on a new wristband.
      </p>

      <div className="kiosk-input-group">
        <input
          id="wristband-qr-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && bind(typed)}
          placeholder="e.g. WB-2026-000482"
        />
        <button
          id="wristband-bind-btn"
          className="btn primary"
          disabled={busy || !typed.trim()}
          onClick={() => bind(typed)}
        >
          {busy ? "Binding…" : "Bind →"}
        </button>
      </div>

      <div className="qr-toggle">
        <button className="btn ghost" onClick={() => setScanning((s) => !s)}>
          {scanning ? "▲ Hide camera" : "▼ Use QR camera"}
        </button>
      </div>
      {scanning && (
        <QrScanner
          active
          demoCodes={["WB-2026-000481", "WB-2026-000482", "WB-2026-000483", "WB-2026-000484"]}
          onDecode={(text) => {
            setScanning(false);
            bind(text);
          }}
        />
      )}
      {err && <p className="warn" style={{ marginTop: 12 }}>{err}</p>}

      <div className="seed-hint card" style={{ marginTop: 24 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <strong>Available bands:</strong> WB-2026-000481 · 000482 · 000483 · 000484
          <br />
          <strong>Rejected demo:</strong> WB-2026-000499 (already used)
        </p>
      </div>

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onBack}>
        ← Back to worker ID
      </button>
    </div>
  );
}

// ── Screen C: Place Wristband — Camera Capture ────────────────────────────────
function ScreenC({ bandQr, workerName, onResult, onQualityFail, onBack }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [relDark, setRelDark] = useState(0.35);

  async function sendPhoto(blob) {
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("image", blob, "badge.jpg");
      fd.append("wristband_qr", bandQr);
      fd.append("kiosk_id", KIOSK_ID);
      const res = await fetch(apiUrl("/api/kiosk/scan"), { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 422 || data.code === "QUALITY_FAIL") {
        onQualityFail(data.error || "Image unclear — please re-scan");
        return;
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || "Scan failed");
      onResult(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendSynthetic() {
    const blob = await makeSyntheticBadge(relDark);
    await sendPhoto(blob);
  }

  return (
    <div className="kiosk-screen">
      <div className="screen-label">Screen C</div>
      <div className="screen-icon">📸</div>
      <h2>Place Wristband to Scan</h2>
      <p className="muted">
        Worker: <strong>{workerName || "—"}</strong> · Band: <strong>{bandQr}</strong>
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        Blur / glare gate runs before dose model. Failed images never reach AI.
      </p>

      {busy && (
        <div className="busy-bar">
          <span>Analysing image…</span>
        </div>
      )}

      <div className="capture-panel">
        <CameraCapture onCapture={sendPhoto} />
      </div>

      <div className="synthetic-panel card" style={{ marginTop: 16 }}>
        <p style={{ margin: "0 0 8px", fontSize: 13 }} className="muted">
          No physical badge? Generate a synthetic 2-zone image for demo:
        </p>
        <label className="slider-label">
          Simulated exposure (darkness) — <strong>{relDark.toFixed(2)}</strong>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={relDark}
            onChange={(e) => setRelDark(Number(e.target.value))}
          />
        </label>
        <button
          id="synthetic-scan-btn"
          className="btn primary"
          disabled={busy}
          onClick={sendSynthetic}
          style={{ marginTop: 8, width: "100%" }}
        >
          Submit synthetic badge
        </button>
      </div>

      {err && <p className="warn" style={{ marginTop: 12 }}>{err}</p>}

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}

// ── Screen D: Dose Result ─────────────────────────────────────────────────────
function ScreenD({ result, workerName, bandQr, onScanAgain, onCloseShift }) {
  const dose = result?.dose?.dose_ppm_h ?? result?.scan?.dose_ppm_h ?? "—";
  const conf = result?.dose?.confidence ?? result?.scan?.confidence ?? "—";
  const band = result?.risk_band ?? result?.scan?.risk_band ?? null;
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeMsg, setCloseMsg] = useState("");

  async function handleClose() {
    setCloseBusy(true);
    try {
      await postJson("/api/kiosk/close", { wristband_qr: bandQr, kiosk_id: KIOSK_ID });
      setCloseMsg("Shift closed — wristband permanently marked used.");
      setTimeout(onCloseShift, 2200);
    } catch (e) {
      setCloseMsg(e.message);
    } finally {
      setCloseBusy(false);
    }
  }

  const bandColors = {
    fresh: "#f4efe6",
    low: "#e6d3b0",
    medium: "#c9a227",
    high: "#6b7a32",
    very_high: "#1a1612",
  };
  const bgColor = band ? bandColors[band] || "var(--panel)" : "var(--panel)";
  const isLight = band === "fresh" || band === "low" || band === "medium";

  return (
    <div className="kiosk-screen">
      <div className="screen-label">Screen D — Result</div>

      <div className="result-card" style={{ background: bgColor, color: isLight ? "#111" : "#eee" }}>
        <div className="result-icon">✅</div>
        <h2 style={{ color: isLight ? "#111" : "#f3f3f3", margin: "8px 0 4px" }}>Scan Complete</h2>
        <p style={{ margin: "0 0 20px", opacity: 0.75, fontSize: 14 }}>
          {workerName || "—"} · {bandQr}
        </p>

        <div className="result-metrics">
          <div className="metric-box" style={{ background: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)" }}>
            <div className="metric-label">Cumulative Dose</div>
            <div className="metric-value">{dose} <small>ppm·h</small></div>
          </div>
          <div className="metric-box" style={{ background: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)" }}>
            <div className="metric-label">Risk Band</div>
            <div className="metric-value">
              <RiskPill band={band} />
            </div>
          </div>
          <div className="metric-box" style={{ background: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)" }}>
            <div className="metric-label">Confidence</div>
            <div className="metric-value">{typeof conf === "number" ? `${(conf * 100).toFixed(0)}%` : conf}</div>
          </div>
        </div>

        {result?.dummy && (
          <p style={{ marginTop: 16, fontSize: 12, opacity: 0.65 }}>
            ⚠ Phase 1 stub — dose is mock data. Real XGBoost model activates in Phase 2.
          </p>
        )}
      </div>

      {closeMsg && (
        <div className="banner" style={{ marginTop: 12 }}>
          {closeMsg}
        </div>
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: "center" }}>
        <button id="scan-again-btn" className="btn" onClick={onScanAgain}>
          📸 Scan again
        </button>
        <button id="close-shift-btn" className="btn danger" disabled={closeBusy} onClick={handleClose}>
          {closeBusy ? "Closing…" : "🔒 Close shift"}
        </button>
      </div>
    </div>
  );
}

// ── Screen E: Quality Gate Failure ────────────────────────────────────────────
function ScreenE({ reason, onRescan, onBack }) {
  return (
    <div className="kiosk-screen">
      <div className="screen-label">Screen E — Quality Gate</div>

      <div className="quality-fail-card">
        <div className="fail-icon">⚠️</div>
        <h2>Image Unclear — Please Re-scan</h2>
        <p className="muted">
          {reason || "The captured image did not pass quality checks."}
        </p>
        <ul className="fail-tips">
          <li>Hold the wristband flat and still on the kiosk surface</li>
          <li>Ensure even lighting — no glare from overhead lights</li>
          <li>Keep the camera 15–20 cm from the badge</li>
        </ul>
        <p style={{ fontSize: 12, marginTop: 8 }} className="muted">
          Failed images never reach the dose model.
        </p>
      </div>

      <div className="row" style={{ marginTop: 20, justifyContent: "center" }}>
        <button id="rescan-btn" className="btn primary" onClick={onRescan}>
          📸 Try again
        </button>
        <button className="btn ghost" onClick={onBack}>
          ← Back to idle
        </button>
      </div>
    </div>
  );
}

// ── Close Shift Flow (independent) ───────────────────────────────────────────
function CloseShiftFlow({ onDone }) {
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function close(qr) {
    const v = String(qr).trim();
    if (!v) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = await postJson("/api/kiosk/close", { wristband_qr: v, kiosk_id: KIOSK_ID });
      setMsg({ ok: true, text: data.message || "Shift closed. Wristband permanently used." });
      setTimeout(onDone, 2500);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kiosk-screen">
      <div className="screen-label">Close Shift</div>
      <div className="screen-icon">🔒</div>
      <h2>Close Shift & Lock Wristband</h2>
      <p className="muted">Scan or type the wristband QR to permanently mark it used.</p>

      <div className="kiosk-input-group">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && close(typed)}
          placeholder="e.g. WB-2026-000481"
        />
        <button className="btn danger" disabled={busy || !typed.trim()} onClick={() => close(typed)}>
          {busy ? "Closing…" : "Lock QR"}
        </button>
      </div>

      <div className="qr-toggle">
        <button className="btn ghost" onClick={() => setScanning((s) => !s)}>
          {scanning ? "▲ Hide camera" : "▼ Use QR camera"}
        </button>
      </div>
      {scanning && <QrScanner active onDecode={(t) => { setScanning(false); close(t); }} />}
      {msg && <div className={`banner ${msg.ok ? "" : "warn"}`} style={{ marginTop: 12 }}>{msg.text}</div>}

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onDone}>
        ← Back to idle
      </button>
    </div>
  );
}

// ── Root Kiosk Page ───────────────────────────────────────────────────────────
export function KioskPage() {
  // mode: idle | start-a | start-b | scan-c | result-d | quality-e | close
  const [mode, setMode] = useState("idle");
  const [workerCode, setWorkerCode] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [bandQr, setBandQr] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [qualityReason, setQualityReason] = useState("");

  function reset() {
    setMode("idle");
    setWorkerCode("");
    setWorkerName("");
    setBandQr("");
    setScanResult(null);
    setQualityReason("");
  }

  return (
    <div className="kiosk-shell">
      <div className="kiosk-header">
        <span className="kiosk-badge">MRPL Muster Kiosk · {KIOSK_ID}</span>
        <span className="kiosk-tagline">Fixed station — worker phones are not used for scanning</span>
      </div>

      {/* Progress stepper */}
      {mode !== "idle" && mode !== "close" && (
        <div className="kiosk-stepper">
          {["start-a", "start-b", "scan-c", "result-d"].map((s, i) => {
            const labels = ["A: Worker ID", "B: Wristband QR", "C: Capture", "D: Result"];
            const idx = ["start-a", "start-b", "scan-c", "result-d"].indexOf(mode);
            return (
              <div key={s} className={`step ${i <= idx ? "active" : ""} ${i < idx ? "done" : ""}`}>
                <div className="step-dot">{i < idx ? "✓" : i + 1}</div>
                <div className="step-label">{labels[i]}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="kiosk-content">
        {mode === "idle" && (
          <div className="kiosk-screen idle-screen">
            <div className="idle-logo">H₂S-DOSAI</div>
            <p className="muted" style={{ maxWidth: 480, textAlign: "center", margin: "8px auto 32px" }}>
              Passive colorimetric H₂S dosimeter · MRPL refinery muster station
            </p>
            <div className="idle-actions">
              <button id="start-shift-btn" className="idle-btn primary" onClick={() => setMode("start-a")}>
                <span className="idle-btn-icon">▶</span>
                <span>
                  <strong>Start Shift</strong>
                  <small>Worker ID → Wristband QR → Bind</small>
                </span>
              </button>
              <button id="mid-scan-btn" className="idle-btn" onClick={() => setMode("scan-c")}>
                <span className="idle-btn-icon">📸</span>
                <span>
                  <strong>Mid-Shift Scan</strong>
                  <small>Wristband QR → capture badge photo</small>
                </span>
              </button>
              <button id="close-shift-idle-btn" className="idle-btn danger" onClick={() => setMode("close")}>
                <span className="idle-btn-icon">🔒</span>
                <span>
                  <strong>Close Shift</strong>
                  <small>Lock wristband QR as used</small>
                </span>
              </button>
            </div>
          </div>
        )}

        {mode === "start-a" && (
          <ScreenA
            onWorker={(id) => {
              setWorkerCode(id);
              setMode("start-b");
            }}
          />
        )}

        {mode === "start-b" && (
          <ScreenB
            workerCode={workerCode}
            onBound={(qr, worker) => {
              setBandQr(qr);
              setWorkerName(worker?.name || worker?.full_name || workerCode);
              setMode("scan-c");
            }}
            onBack={() => setMode("start-a")}
          />
        )}

        {mode === "scan-c" && (
          <ScreenC
            bandQr={bandQr}
            workerName={workerName}
            onResult={(data) => {
              setScanResult(data);
              setMode("result-d");
            }}
            onQualityFail={(reason) => {
              setQualityReason(reason);
              setMode("quality-e");
            }}
            onBack={() => setMode(workerCode ? "start-b" : "idle")}
          />
        )}

        {mode === "result-d" && (
          <ScreenD
            result={scanResult}
            workerName={workerName}
            bandQr={bandQr}
            onScanAgain={() => setMode("scan-c")}
            onCloseShift={reset}
          />
        )}

        {mode === "quality-e" && (
          <ScreenE
            reason={qualityReason}
            onRescan={() => setMode("scan-c")}
            onBack={reset}
          />
        )}

        {mode === "close" && <CloseShiftFlow onDone={reset} />}
      </div>
    </div>
  );
}
