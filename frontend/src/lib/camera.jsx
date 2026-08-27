import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef, useState } from "react";

export function QrScanner({ onDecode, active }) {
  const regionId = "h2s-qr-region";
  const inst = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const html5 = new Html5Qrcode(regionId);
    inst.current = html5;
    html5
      .start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => {
          if (!cancelled) onDecode(text);
        },
        () => {}
      )
      .catch((e) => setErr(e?.message || "Camera unavailable — use typed QR fallback."));
    return () => {
      cancelled = true;
      html5.stop().catch(() => {});
      html5.clear().catch(() => {});
    };
  }, [active, onDecode]);

  return (
    <div>
      <div id={regionId} className="qr-box" />
      {err && <p className="warn">{err}</p>}
    </div>
  );
}

export function CameraCapture({ onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: 1280 }, audio: false })
      .then((s) => {
        stream = s;
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          setReady(true);
        }
      })
      .catch(() => setReady(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.92);
  }

  return (
    <div className="capture">
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" className="btn primary" disabled={!ready} onClick={snap}>
        Capture badge photo
      </button>
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
  const bands = ["#f4efe6", "#e6d3b0", "#c9a227", "#6b5a2a", "#1a1612"];
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(360, 130 + i * 38, 240, 34);
  });
  ctx.fillStyle = "#111";
  ctx.font = "16px sans-serif";
  ctx.fillText("REF SCALE + QR zone", 370, 80);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95));
}
