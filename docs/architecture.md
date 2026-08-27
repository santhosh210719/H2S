# Architecture Notes — H2S-DOSAI

## Core constraints (locked from SIH brief)

1. **Kiosk-only scanning** — worker phones never used. Scanning happens only at fixed muster-point kiosk stations running `/kiosk`.
2. **Two QR codes** — factory wristband QR (`WB-2026-XXXXXX`) is separate from the worker ID QR. Shift start binds them; later mid-shift scans need only the wristband QR.
3. **One-time-use lock** — after shift close-out, the wristband QR is permanently `used`. Re-scan is rejected.
4. **Quality gate before AI** — Laplacian blur + glare/overexposure runs before the dose model. Failures prompt Re-scan and never reach the ML layer.
5. **Two badge zones only** — reactive H₂S patch array (left) + printed reference scale / QR (right). No sealed control/drift-correction zone.
6. **XGBoost, not CNN** — color features → ppm·h + confidence. Explainable, fast, trainable on synthetic data.
7. **Optional sensor pack** — MQ-136 + DHT-11 is a supplementary live layer on the admin dashboard. Passive badge is the primary PS-answering solution.

---

## Data flow

```
Worker arrives at muster point
        │
        ▼
[KIOSK /kiosk — Screen A]
  Scan / type Worker ID QR  →  worker_id resolved
        │
        ▼
[KIOSK — Screen B]
  Scan / type Wristband QR  →  wristband_qr resolved
        │
        ▼
POST /api/kiosk/bind  (also aliased at /api/bind-wristband)
  Express + supabaseAdmin (service_role)
    ├─ Validate worker_id exists in workers table
    ├─ Validate wristband_qr exists, status='available'
    ├─ Check no open shift for this worker or this wristband
    ├─ INSERT into shift_bindings
    └─ UPDATE wristbands SET status='bound'
        │
        ▼  (later in shift)
[KIOSK — Screen C]
  Camera capture (getUserMedia) → JPEG blob
        │
        ▼
POST /api/kiosk/scan  (also /api/scan)
  multipart/form-data: image + wristband_qr
    ├─ Validate wristband_qr (bound, active shift)
    ├─ Quality gate (Python OpenCV preferred / Node Sharp fallback)
    │     blur_score < 80  →  QUALITY_FAIL → Screen E
    │     glare_ratio > 0.12 → QUALITY_FAIL → Screen E
    ├─ [Phase 2] Extract color features from patch zone
    ├─ [Phase 2] XGBoost predict dose_ppm_h + confidence
    ├─ Phase 1: mockDose() stub (deterministic from QR string)
    ├─ Upload image to Supabase Storage (wristband-scans bucket)
    └─ INSERT into scan_logs
        │
        ▼
[KIOSK — Screen D]
  Display: dose_ppm_h, risk_band, confidence
        │
        ▼
POST /api/kiosk/close  (also /api/close-shift)
  wristband_qr
    ├─ UPDATE shift_bindings SET shift_end=now()
    └─ UPDATE wristbands SET status='used'
```

```
[ADMIN /admin]
  Supabase Auth login (email/password)
        │
        ▼
GET /api/workers  →  all workers + latest scan_log per active binding
GET /api/workers/:id/history  →  all scan_logs for worker's shift bindings
        │
        ▼
[Phase 3] GET /api/admin/overview  →  active shifts + live_ambient_readings
  (MQ-136 / DHT-11 optional sensor pack)
```

---

## Security model

| Actor | Auth | Supabase access |
|-------|------|-----------------|
| Kiosk station | Unauthenticated browser | Never touches Supabase directly. All writes go through Express using service_role key (server-side only). |
| Admin dashboard | Supabase Auth (JWT) | Reads tables via anon key + RLS policies (`authenticated` role). |
| Express backend | Service role key (env var, server only) | Bypasses RLS. Full read/write. |
| Python ML | localhost only | No Supabase access. Called by Express. |

---

## Risk bands

| Band | Dose (ppm·h) | Badge colour |
|------|-------------|--------------|
| fresh | 0 | off-white |
| low | 0–1 | pale tan |
| medium | 1–5 | gold/amber |
| high | 5–20 | olive/brown |
| very_high | >20 (cap 50 synthetic) | near-black |

---

## Phase roadmap

| Phase | Scope |
|-------|-------|
| **1** | Skeleton, schema, auth, kiosk + admin UI shells, mock dose |
| **2** | Real quality gate + XGBoost dose model, image upload to Storage |
| **3** | Live MQ-136 / DHT-11 sensor-pack integration, ambient dashboard |
| **4** | Trend alerts, TWA calculations, shift report export |
