# H2S-DOSAI

SIH Problem Statement **26118** (MRPL, Hardware / Smart Automation).

Passive **colorimetric H2S exposure-dosimeter wristband** + explainable quantitative reading, scanned only at **fixed kiosk stations** at refinery muster points — **not** on individual worker phones.

## Locked product rules

1. Scanning happens only at `/kiosk` (demo stand-in for a muster kiosk). `/admin` is the safety-desk dashboard. Open both in two browser windows for a split-screen demo.
2. Each wristband has its **own factory QR** (e.g. `WB-2026-000482`), separate from the worker ID QR. Shift start binds them; later scans need only the wristband QR.
3. **One-time-use lock:** after shift close-out the wristband QR is permanently `used`. Re-scan is rejected: *This wristband has already been used — please use a new one.*
4. **Image quality gate:** Laplacian blur + glare/overexposure run **before** the dose model. Failures prompt **Re-scan** and never reach AI.
5. Badge has **two zones only**: reactive H2S patch array + printed reference scale / QR. No sealed control / drift-correction zone.
6. Dose model is **XGBoost** (color features → ppm·h + confidence), not a CNN.
7. Optional **MQ-136 + DHT-11** pack is a **supplementary live layer** on the dashboard. The passive badge remains the PS-answering primary solution.

### Risk bands (ppm·h)

| Band | Dose | Appearance |
| --- | --- | --- |
| Fresh | 0 | off-white |
| Low | 0–1 | pale tan |
| Medium | 1–5 | gold/amber |
| High | 5–20 | olive/brown |
| Very High | >20 (cap 50 synthetic) | near-black |

## Repo layout

- `frontend/` — React (Vite) routes `/kiosk` and `/admin`
- `backend/` — Node.js + Express (uploads, quality gate, Supabase)
- `ml/` — Python OpenCV quality gate + XGBoost dose service (`:5001`)
- `supabase/migrations/` — Postgres schema, RPCs, storage bucket

## Setup

1. Copy `.env.example` to `.env` and fill **Supabase URL**, **anon key**, and **service role key**.
2. In the [Supabase SQL editor](https://supabase.com/dashboard), run `supabase/migrations/001_init.sql` then `002_storage.sql`.
3. Enable **Realtime** on tables `scans`, `shifts`, `sensor_readings`.
4. Create an Auth user for the admin desk (email/password).
5. Install and run:

```bash
npm install
npm run install:all
cd ml && python train_synthetic.py && cd ..
npm run dev
```

If Python/OpenCV is not ready, `npm run dev:web` still works: Node Sharp runs the quality gate and a documented heuristic fallback estimates dose until XGBoost is up.

6. Open [http://localhost:5173/kiosk](http://localhost:5173/kiosk) and [http://localhost:5173/admin](http://localhost:5173/admin).

### Seed QR codes

Workers: `WKR-1001`, `WKR-1002`, `WKR-1003`  
Unused bands: `WB-2026-000481` … `000484`  
Already used (reject demo): `WB-2026-000499`

## Demo flow

1. Kiosk → Start shift → worker ID then wristband QR → Bind.
2. Mid-shift scan → wristband QR only → capture (or synthetic badge slider) → dose appears on admin live.
3. Close shift → wristband marked `used`. Scanning `WB-2026-000499` or a closed band must hard-fail.

## GitHub

Remote: https://github.com/santhosh210719/H2S.git
