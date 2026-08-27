import { useCallback, useState } from "react";
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

export function KioskPage() {
  const [mode, setMode] = useState("idle");
  const [scanTarget, setScanTarget] = useState(null);
  const [workerCode, setWorkerCode] = useState("");
  const [bandQr, setBandQr] = useState("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [relDark, setRelDark] = useState(0.35);

  const onDecode = useCallback(
    (text) => {
      const v = String(text).trim();
      if (scanTarget === "worker") setWorkerCode(v);
      if (scanTarget === "band") setBandQr(v);
      setScanTarget(null);
    },
    [scanTarget]
  );

  function applyTyped() {
    if (!typed.trim()) return;
    onDecode(typed.trim());
    setTyped("");
  }

  async function bind() {
    setBusy(true);
    setStatus(null);
    try {
      const data = await postJson("/api/kiosk/bind", {
        worker_code: workerCode,
        wristband_qr: bandQr,
        kiosk_id: KIOSK_ID,
      });
      setStatus({ ok: true, text: `Bound ${data.worker.full_name} ↔ ${data.wristband.qr_code}` });
      setMode("idle");
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    setBusy(true);
    setStatus(null);
    try {
      const data = await postJson("/api/kiosk/close", { wristband_qr: bandQr, kiosk_id: KIOSK_ID });
      setStatus({ ok: true, text: data.message || "Shift closed. Wristband permanently used." });
      setMode("idle");
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoto(blob) {
    setBusy(true);
    setStatus(null);
    try {
      const lookup = await postJson("/api/kiosk/lookup", { wristband_qr: bandQr });
      const fd = new FormData();
      fd.append("image", blob, "badge.jpg");
      fd.append("wristband_qr", bandQr);
      fd.append("kiosk_id", KIOSK_ID);
      const res = await fetch(apiUrl("/api/kiosk/scan"), { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 422 || data.code === "QUALITY_FAIL") {
        setStatus({ ok: false, text: data.error || "Re-scan", extra: "Re-scan" });
        return;
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || "Scan failed");
      setStatus({
        ok: true,
        text: `${lookup.worker.full_name}: ${data.dose.dose_ppm_h} ppm·h (${data.risk_band}) · conf ${data.dose.confidence}`,
      });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function sendSynthetic() {
    const blob = await makeSyntheticBadge(relDark);
    await sendPhoto(blob);
  }

  return (
    <div className="shell">
      <h1>Muster kiosk</h1>
      <p className="muted">Fixed station · worker phones are not used for scanning.</p>

      {status && <div className={status.ok ? "banner" : "banner warn"}>{status.extra ? `${status.extra} — ` : ""}{status.text}</div>}

      {mode === "idle" && (
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn primary" onClick={() => setMode("start")}>Start shift (ID + badge QR)</button>
          <button className="btn" onClick={() => setMode("scan")}>Mid-shift badge scan</button>
          <button className="btn danger" onClick={() => setMode("close")}>Close shift (lock QR)</button>
        </div>
      )}

      {mode !== "idle" && (
        <p>
          <button className="btn ghost" onClick={() => setMode("idle")}>← Back</button>
        </p>
      )}

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>QR capture</h3>
          {mode === "start" && (
            <>
              <p>1) Worker ID QR &nbsp; 2) Wristband QR (factory ID, e.g. WB-2026-000482)</p>
              <p>
                Worker: <strong>{workerCode || "—"}</strong>
                <br />
                Wristband: <strong>{bandQr || "—"}</strong>
              </p>
              <div className="row">
                <button className="btn" onClick={() => setScanTarget("worker")}>Scan worker ID</button>
                <button className="btn" onClick={() => setScanTarget("band")}>Scan wristband</button>
                <button className="btn primary" disabled={busy || !workerCode || !bandQr} onClick={bind}>
                  Bind for this shift
                </button>
              </div>
            </>
          )}
          {mode === "scan" && (
            <>
              <p>Only the wristband QR is needed — worker is already bound for this shift.</p>
              <p>Wristband: <strong>{bandQr || "—"}</strong></p>
              <button className="btn" onClick={() => setScanTarget("band")}>Scan wristband QR</button>
            </>
          )}
          {mode === "close" && (
            <>
              <p>Closing the shift permanently marks this wristband QR as used.</p>
              <p>Wristband: <strong>{bandQr || "—"}</strong></p>
              <div className="row">
                <button className="btn" onClick={() => setScanTarget("band")}>Scan wristband QR</button>
                <button className="btn danger" disabled={busy || !bandQr} onClick={closeShift}>
                  Close & lock QR
                </button>
              </div>
            </>
          )}

          <label className="muted" style={{ display: "block", marginTop: 16 }}>
            Demo typed QR (if camera QR fails)
            <div className="row" style={{ marginTop: 8 }}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="WKR-1001 or WB-2026-000482"
              />
              <button className="btn" type="button" onClick={applyTyped}>Use</button>
            </div>
          </label>
          {scanTarget && <QrScanner active onDecode={onDecode} />}
        </div>

        {mode === "scan" && (
          <div className="card">
            <h3>Colorimetric photo</h3>
            <p className="muted">Blur / glare gate runs before the dose model. Failures never reach AI.</p>
            <CameraCapture onCapture={sendPhoto} />
            <hr style={{ borderColor: "var(--line)", margin: "18px 0" }} />
            <p>No printed badge? Generate a synthetic 2-zone image:</p>
            <label>
              Simulated exposure (darkness) {relDark.toFixed(2)}
              <input type="range" min="0" max="1" step="0.01" value={relDark} onChange={(e) => setRelDark(Number(e.target.value))} />
            </label>
            <button className="btn primary" disabled={busy || !bandQr} onClick={sendSynthetic}>
              Submit synthetic badge
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
