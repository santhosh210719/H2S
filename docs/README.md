# H2S-DOSAI — Docs

**SIH Problem Statement 26118 · MRPL (Mangalore Refinery & Petrochemicals Ltd.)**

Passive colorimetric H₂S exposure-dosimeter wristband system with computer-vision-assisted quantitative reading, scanned only at fixed kiosk stations at refinery muster points.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite, React Router v7 |
| Backend | Node.js (ESM) + Express 5 |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Auth | Supabase Auth (email/password, admin only) |
| Storage | Supabase Storage (private bucket `wristband-scans`) |
| ML / CV | Python 3.11 + Flask microservice, OpenCV, XGBoost |
| Node CV fallback | Sharp (Laplacian blur) + color feature extraction |
| Monorepo scripts | `concurrently` root dev runner |

---

## Folder layout

```
/
├── frontend/          React app — routes /kiosk and /admin
│   └── src/
│       ├── pages/     Kiosk.jsx  Admin.jsx
│       └── lib/       camera.jsx  supabase.js
├── backend/           Node/Express API (:4000)
│   └── src/
│       ├── routes/    kiosk.js  admin.js
│       ├── lib/       supabase.js  mlClient.js  qualityGate.js  features.js  doseStub.js
│       └── store/     index.js  supabaseStore.js  memory.js
├── ml/                Python CV/ML microservice (:5001)
│   ├── service.py     Flask /quality + /dose endpoints
│   ├── train_synthetic.py
│   └── models/        dose_xgb.json (generated)
├── supabase/
│   └── migrations/    001_init.sql  002_storage.sql
└── docs/              ← you are here
```

---

## Running locally

```bash
# 1. Copy and fill in credentials
cp .env.example .env

# 2. Install all dependencies
npm run install:all

# 3a. Run without Python ML (Node quality-gate + heuristic fallback)
npm run dev:web

# 3b. Run everything including Python ML microservice
cd ml && python train_synthetic.py && cd ..
npm run dev
```

- Kiosk: http://localhost:5173/kiosk
- Admin: http://localhost:5173/admin
- API health: http://localhost:4000/api/health

---

## See also

- [architecture.md](./architecture.md) — data flow + design decisions
- [phase1-prompt.md](./phase1-prompt.md) — original Phase 1 specification
