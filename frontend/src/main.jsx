import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin.jsx";
import { KioskPage } from "./pages/Kiosk.jsx";
import { WorkerLoginPage } from "./pages/WorkerLogin.jsx";
import { WorkerDashboardPage } from "./pages/WorkerDashboard.jsx";
import "./styles.css";

// ── Worker session guard ──────────────────────────────────────────────────────
function WorkerRoute({ children }) {
  const token = sessionStorage.getItem("workerToken");
  if (!token) {
    return <Navigate to="/worker-login" replace />;
  }
  return children;
}

// ── Home page ─────────────────────────────────────────────────────────────────
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
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 40px", lineHeight: 1.7 }}>
        Passive colorimetric H₂S exposure-dosimeter wristband — scanned only at fixed
        kiosk stations at refinery muster points.
      </p>
      <div className="home-links">
        <Link to="/worker-login" id="home-worker-link">
          <span style={{ fontSize: "1.5rem" }}>📸</span>
          Worker login
          <small style={{ display: "block", fontSize: "0.7em", opacity: 0.7, marginTop: 4, fontWeight: 400 }}>
            View your dashboard & scan your wristband badge
          </small>
        </Link>
        <Link to="/admin-login" id="home-admin-link">
          <span style={{ fontSize: "1.5rem" }}>🛡</span>
          Admin login
          <small style={{ display: "block", fontSize: "0.7em", opacity: 0.7, marginTop: 4, fontWeight: 400 }}>
            Safety desk · manage workers & view exposure data
          </small>
        </Link>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none" }}>H2S-DOSAI</Link>
        <span className="muted" style={{ fontSize: 12 }}>
          Kiosk scanning only · SIH 26118 · MRPL
        </span>
      </div>
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Worker auth */}
        <Route path="/worker-login" element={<WorkerLoginPage />} />

        {/* Worker dashboard — requires valid worker session */}
        <Route
          path="/worker-dashboard"
          element={
            <WorkerRoute>
              <WorkerDashboardPage />
            </WorkerRoute>
          }
        />

        {/* Kiosk — requires valid worker session */}
        <Route
          path="/kiosk"
          element={
            <WorkerRoute>
              <KioskPage />
            </WorkerRoute>
          }
        />

        {/* Admin portal */}
        <Route path="/admin-login" element={<AdminPage />} />
        <Route path="/admin" element={<AdminPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
