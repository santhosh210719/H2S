import { Html5Qrcode } from "html5-qrcode";
import { Component, useEffect, useRef, useState } from "react";

// ── React Error Boundary — wraps QrScanner so a camera crash never kills the app ──
class QrErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: "" };
  }
  static getDerivedStateFromError(err) {
    return { crashed: true, message: err?.message || "Camera unavailable" };
  }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          background: "#1a1210",
          border: "1px solid #6b3020",
          borderRadius: 8,
          padding: "16px 18px",
          marginTop: 8,
        }}>
          <p style={{ color: "#f0a060", margin: "0 0 6px", fontWeight: 700 }}>
            ⚠️ Camera unavailable
          </p>
          <p style={{ color: "#9a8070", margin: 0, fontSize: 13 }}>
            {this.state.message} — use the typed field or upload an image file.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Unique ID counter so multiple QrScanner instances never share the same DOM id ──
let _qrCounter = 0;

// ── QR Scanner ────────────────────────────────────────────────────────────────
function QrScannerInner({ onDecode, active, demoCodes }) {
  // Stable unique region id — created once per component mount
  const regionId = useRef(`h2s-qr-region-${++_qrCounter}`).current;
  const inst = useRef(null);
  const fileInputRef = useRef(null);
  const [camState, setCamState] = useState("idle"); // idle | starting | running | error
  const [err, setErr] = useState("");
  const [scanningFile, setScanningFile] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setCamState("starting");
    setErr("");

    const html5 = new Html5Qrcode(regionId);
    inst.current = html5;

    html5
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          if (!cancelled) {
            // Stop camera after a successful decode to avoid duplicate fires
            html5.stop().catch(() => {});
            onDecode(text);
          }
        },
        () => {} // per-frame failure — ignore
      )
      .then(() => { if (!cancelled) setCamState("running"); })
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e?.message || e || "");
        if (msg.includes("Permission") || msg.includes("NotAllowed")) {
          setErr(
            "Camera permission denied. Click the 🔒 lock icon in your browser address bar → " +
            "set Camera to Allow — then click ▲ Hide camera / ▼ Use QR camera to retry."
          );
        } else if (msg.includes("NotFound") || msg.includes("no camera") || msg.includes("DevicesNotFound")) {
          setErr("No camera hardware found on this device.");
        } else if (msg.includes("NotReadable") || msg.includes("TrackStart")) {
          setErr("Camera is already in use by another app. Close it and retry.");
        } else {
          setErr(`Camera unavailable: ${msg || "unknown error"}.`);
        }
        setCamState("error");
      });

    return () => {
      cancelled = true;
      html5.stop().catch(() => {});
      html5.clear().catch(() => {});
    };
  }, [active, regionId, onDecode]);

  // Decode QR code from an uploaded image file
  async function handleFileScan(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanningFile(true);
    setErr("");
    try {
      // scanFile works even if the live camera failed — use a fresh instance
      const scanner = new Html5Qrcode(`${regionId}-filescan`);
      const text = await scanner.scanFile(file, true);
      scanner.clear().catch(() => {});
      onDecode(text);
    } catch {
      setErr("Could not detect a valid QR code in the uploaded image. Try a clearer photo.");
    } finally {
      setScanningFile(false);
    }
  }

  const showFallback = camState === "error" || err;

  return (
    <div style={{ marginTop: 8 }}>
      {/* Live camera viewfinder — always rendered so Html5Qrcode can attach to it */}
      <div id={regionId} className="qr-box" style={{ display: showFallback ? "none" : undefined }} />

      {camState === "starting" && !err && (
        <div className="camera-requesting" style={{ minHeight: 90 }}>
          <div className="camera-requesting-spinner" />
          <p>Starting QR camera…</p>
          <p className="muted" style={{ fontSize: 12 }}>Click "Allow" if your browser asks for camera permission.</p>
        </div>
      )}

      {/* Always show quick-select demo buttons so user can proceed immediately */}
      {demoCodes && demoCodes.length > 0 && (
        <div style={{ margin: "10px 0 4px" }}>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 6px", textTransform: "uppercase", fontWeight: 700 }}>
            Quick Select Demo QR:
          </p>
          <div className="row" style={{ gap: 6 }}>
            {demoCodes.map((code) => (
              <button
                key={code}
                className="btn primary"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={() => onDecode(code)}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      )}

      {showFallback && (
        <div className="camera-fallback" style={{ marginTop: 8, padding: "16px 14px" }}>
          <p className="camera-fallback-title" style={{ fontSize: 14 }}>⚠️ {err || "Camera unavailable"}</p>
          <p className="camera-fallback-msg" style={{ margin: "4px 0 12px", fontSize: 12 }}>
            Type the code above, click a demo QR button, or upload a QR image file:
          </p>

          {/* File Upload QR fallback */}
          <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileScan}
            />
            <button
              className="btn"
              style={{ width: "100%", fontSize: 13 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={scanningFile}
            >
              📁 {scanningFile ? "Scanning image…" : "Upload QR image file"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function QrScanner(props) {
  return (
    <QrErrorBoundary>
      <QrScannerInner {...props} />
    </QrErrorBoundary>
  );
}

// ── Camera Capture ────────────────────────────────────────────────────────────
export function CameraCapture({ onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | requesting | ready | error | no-camera
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("no-camera");
      setErrMsg("getUserMedia not supported in this browser context.");
      return;
    }

    setState("requesting");
    let stream;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.onloadedmetadata = () => setState("ready");
        } else {
          setState("ready");
        }
      })
      .catch((e) => {
        const msg = e?.message || e?.name || "";
        if (msg.includes("NotAllowed") || msg.includes("Permission")) {
          setErrMsg("Camera permission denied by the browser.");
        } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
          setErrMsg("No camera hardware detected on this device.");
        } else if (msg.includes("NotReadable") || msg.includes("TrackStart")) {
          setErrMsg("Camera is in use by another application.");
        } else {
          setErrMsg(`Camera error: ${msg || "unavailable"}`);
        }
        setState("error");
      });

    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.92);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
  }

  // ── No camera / error state ──
  if (state === "error" || state === "no-camera") {
    return (
      <div className="camera-fallback">
        <div className="camera-fallback-icon">📷</div>
        <p className="camera-fallback-title">Camera Feed Unavailable</p>
        <p className="camera-fallback-msg">{errMsg}</p>
        <div className="camera-fallback-tips">
          <p><strong>Options to proceed:</strong></p>
          <ul style={{ margin: "6px 0 12px" }}>
            <li>Click the lock/camera icon in your browser address bar to <strong>Allow Camera</strong></li>
            <li>Or upload a photo of the wristband badge directly</li>
            <li>Or use the synthetic badge generator below</li>
          </ul>

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => fileInputRef.current?.click()}
          >
            📁 Upload Wristband Photo File
          </button>
        </div>
      </div>
    );
  }

  // ── Requesting permission ──
  if (state === "idle" || state === "requesting") {
    return (
      <div className="camera-requesting">
        <div className="camera-requesting-spinner" />
        <p>Requesting camera access…</p>
        <p className="muted" style={{ fontSize: 12 }}>Click "Allow" if prompted by your browser.</p>
      </div>
    );
  }

  // ── Camera ready ──
  return (
    <div className="capture">
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "#000" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", display: "block", borderRadius: 8 }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {/* Viewfinder overlay */}
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            width: 200,
            height: 140,
            border: "2px solid rgba(201,162,39,0.7)",
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
          }} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          id="capture-badge-btn"
          className="btn primary"
          onClick={snap}
          style={{ flex: 1 }}
        >
          📸 Capture badge photo
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload image file instead of taking photo"
        >
          📁 File
        </button>
      </div>
    </div>
  );
}

/** Demo helper: generate a 2-zone badge image (patch + reference strip). */
export function makeSyntheticBadge(relDark) {
  const w = 640;
  const h = 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8e4dc";
  ctx.fillRect(0, 0, w, h);
  const t = Math.max(0, Math.min(1, relDark));
  const r = Math.round(232 - t * 200);
  const g = Math.round(220 - t * 175);
  const b = Math.round(200 - t * 175);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(40, 50, 280, 250);
  ctx.fillStyle = "#f7f5f0";
  ctx.fillRect(360, 40, 240, 70);
  // Official H2S-DOSAI reference chart colors
  const bands = ["#F0E9E2", "#DCC08A", "#B8902F", "#5C4A1E", "#231A24"];
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(360, 130 + i * 38, 240, 34);
  });
  ctx.fillStyle = "#111";
  ctx.font = "16px sans-serif";
  ctx.fillText("REF SCALE + QR zone", 370, 80);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95));
}
