import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin.jsx";
import { KioskPage } from "./pages/Kiosk.jsx";
import "./styles.css";

function Home() {
  return (
    <div className="shell">
      <p className="brand">SIH 26118 · MRPL</p>
      <h1>H2S-DOSAI</h1>
      <p className="muted">
        Passive colorimetric H2S dosimeter — scanned only at fixed kiosk stations, not on worker phones.
      </p>
      <div className="home-links">
        <Link to="/kiosk">Open kiosk station</Link>
        <Link to="/admin">Open admin dashboard</Link>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="topbar">
        <span className="brand">H2S-DOSAI</span>
        <span className="muted">Kiosk scanning only · split-screen demo: /kiosk + /admin</span>
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
