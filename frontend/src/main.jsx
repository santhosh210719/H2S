import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin.jsx";
import { KioskPage } from "./pages/Kiosk.jsx";
import "./styles.css";

function Home() {
  return (
    <div className="shell" style={{ textAlign: "center", paddingTop: 80 }}>
      <div style={{
        display: "inline-block",
        fontSize: "clamp(2.5rem, 6vw, 4rem)",
        fontWeight: 800,
        background: "linear-gradient(135deg, #c9a227, #f0d070)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        marginBottom: 8,
        letterSpacing: "-0.02em",
      }}>
        H₂S-DOSAI
      </div>
      <p className="brand" style={{ marginBottom: 8 }}>SIH 26118 · MRPL</p>
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 16px", lineHeight: 1.7 }}>
        Passive colorimetric H₂S exposure-dosimeter wristband — scanned only at fixed kiosk
        stations at refinery muster points, not on worker phones.
      </p>
      <div className="home-links">
        <Link to="/kiosk">
          <span style={{ fontSize: "1.5rem" }}>📸</span>
          Open kiosk station
        </Link>
        <Link to="/admin">
          <span style={{ fontSize: "1.5rem" }}>🛡</span>
          Open admin dashboard
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 48, fontSize: 12 }}>
        Demo: open both in two browser windows for a split-screen live demo
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none" }}>H2S-DOSAI</Link>
        <span className="muted" style={{ fontSize: 12 }}>
          Kiosk scanning only · /kiosk + /admin
        </span>
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/kiosk" element={<KioskPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
