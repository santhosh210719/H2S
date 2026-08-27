# H2S-DOSAI

**SIH Problem Statement 26118 · MRPL (Mangalore Refinery & Petrochemicals Ltd.)**

Passive **colorimetric H₂S exposure-dosimeter wristband** + explainable quantitative reading, scanned only at **fixed kiosk stations** at refinery muster points — **not** on individual worker phones.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite · React Router v7 · Recharts |
| Backend | Node.js (ESM) · Express 5 · Multer |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Auth | Supabase Auth (email/password, admin only) |
| Storage | Supabase Storage (private bucket `wristband-scans`) |
| ML / CV | Python 3.11 · Flask · OpenCV · XGBoost |
| Node CV fallback | Sharp (Laplacian blur) + color feature extraction |
| Dev runner | concurrently (root `npm run dev`) |

## Repo layout

```
/frontend         React app — routes /kiosk and /admin
/backend          Node/Express API (:4000)
/ml               Python CV/ML microservice (:5001)
/supabase         Postgres schema + storage SQL migrations
/docs             Architecture notes, this prompt, setup guide
```

→ See [docs/README.md](./docs/README.md) for the full developer guide.
→ See [docs/architecture.md](./docs/architecture.md) for data-flow and design decisions.

## Locked product rules

1. Scanning happens only at `/kiosk` (muster kiosk). `/admin` is the safety-desk dashboard.
2. Each wristband has its **own factory QR** (e.g. `WB-2026-000482`), separate from the worker ID QR. Shift start binds them.
3. **One-time-use lock:** after shift close-out the wristband QR is permanently `used`. Re-scan is rejected.
4. **Image quality gate:** Laplacian blur + glare/overexposure runs **before** the dose model. Failures prompt Re-scan and never reach AI.
5. Badge has **two zones only**: reactive H₂S patch array + printed reference scale / QR.
6. Dose model is **XGBoost** (color features → ppm·h + confidence), not a CNN.
7. Optional **MQ-136 + DHT-11** pack is a **supplementary live layer** (Phase 3). Passive badge is the primary PS-answering solution.

### Risk bands (ppm·h)

| Band | Dose | Badge appearance |
|------|------|-----------------|
| Fresh | 0 | off-white |
| Low | 0–1 | pale tan |
| Medium | 1–5 | gold/amber |
| High | 5–20 | olive/brown |
| Very High | >20 (cap 50 synthetic) | near-black |

## Quick start

```bash
# 1. Copy and fill Supabase URL + keys
cp .env.example .env

# 2. Install all dependencies
npm run install:all

# 3a. Run without Python ML (Node quality-gate fallback works fine)
npm run dev:web

# 3b. Full stack including Python ML microservice
cd ml && python train_synthetic.py && cd ..
npm run dev
```

- Kiosk station: http://localhost:5173/kiosk
- Admin dashboard: http://localhost:5173/admin
- API health: http://localhost:4000/api/health

### Supabase setup (first time)

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/migrations/001_init.sql` then `002_storage.sql`.
3. Go to **Auth → Users** and create an admin email/password user.
4. Enable **Realtime** on tables `scan_logs`, `shift_bindings`, `live_ambient_readings`.
5. Copy project URL, anon key, and service role key into `.env`.

### Seed QR codes (in-memory store, no Supabase needed)

| Code | Who / What |
|------|-----------|
| `WKR-1001` | Arun Kumar · CDU |
| `WKR-1002` | Priya Nair · SRU |
| `WKR-1003` | Rahul Shetty · Utilities |
| `WB-2026-000481` … `000484` | Available wristbands |
| `WB-2026-000499` | Already used — will be rejected |

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/bind-wristband` | Bind worker + wristband, start shift |
| POST | `/api/scan` | Submit wristband photo, get dose reading |
| GET | `/api/workers` | All workers with latest scan |
| GET | `/api/workers/:id/history` | Full scan history for one worker |
| POST | `/api/close-shift` | Close shift, lock wristband QR |
| POST | `/api/kiosk/bind` | (frontend alias) |
| POST | `/api/kiosk/scan` | (frontend alias) |
| POST | `/api/kiosk/close` | (frontend alias) |
| GET | `/api/admin/overview` | Active shifts + recent scans |

## Demo flow

1. **Kiosk → Start shift** → type `WKR-1001` → type `WB-2026-000482` → Bind.
2. **Mid-shift scan** → type `WB-2026-000482` → capture or use synthetic badge slider → dose result appears.
3. **Close shift** → wristband marked `used`. Scanning `WB-2026-000499` or any closed band hard-fails.
4. **Admin** → log in → click any worker row → history chart + scan log.

## GitHub

Remote: https://github.com/santhosh210719/H2S.git
