# Phase 1 Specification Prompt

**SIH 26118 — H2S-DOSAI Phase 1**

> PHASE 1 GOAL: Set up the full project skeleton, Supabase schema, auth, and both
> kiosk and admin UI shells (no AI/CV logic yet — just the structure, navigation,
> and data flow wired up with dummy/mock data).

## TASKS

### 1. GITHUB SETUP
- Initialize/confirm a GitHub repo. Create a clear folder structure:
  - /frontend (React app, routes: /kiosk, /admin)
  - /backend (Node/Express API)
  - /ml (Python — image pipeline + model training, called from backend as a microservice or subprocess)
  - /docs (README, this prompt, architecture notes)
- Add a root README explaining the project, stack, and how to run each part.
- Commit this skeleton as the first commit.

### 2. SUPABASE SCHEMA — create these tables:
- `workers` (worker_id PK, name, department, shift, created_at)
- `wristbands` (wristband_qr PK, batch_id, manufactured_date, status: enum['available','bound','used'], created_at)
- `shift_bindings` (id PK, wristband_qr FK, worker_id FK, shift_start, shift_end nullable, kiosk_location)
- `scan_logs` (id PK, wristband_qr FK, timestamp, image_url, quality_status: enum['pass','blur','glare'], dose_ppm_h nullable, confidence nullable, risk_band nullable)
- `live_ambient_readings` (id PK, worker_id FK nullable, kiosk_location, ambient_h2s_ppm, temperature_c, humidity_percent, timestamp) — for the optional sensor-pack add-on, Phase 3
- Set up Supabase Storage bucket for wristband scan images.
- Set up Supabase Auth for admin login (email/password is fine for a demo).
- Enable Row Level Security appropriately: admin role can read everything; kiosk (unauthenticated or a shared kiosk-service key) can only insert scans and read wristband/worker binding status needed for its own flow.

### 3. BACKEND SKELETON (Node/Express)
- Set up Express server, connect to Supabase using the Supabase JS client (service role key for backend-only operations).
- Stub routes (return mock data for now, real logic comes in Phase 2):
  - POST /api/bind-wristband (worker_id, wristband_qr) -> creates shift_binding, marks wristband status 'bound'
  - POST /api/scan (wristband_qr, image file) -> stub: just save image to Supabase Storage + insert a scan_logs row with dummy dose_ppm_h for now
  - GET /api/workers -> list all workers with their latest scan_logs entry
  - GET /api/workers/:id/history -> all scan_logs for that worker's shift bindings
  - POST /api/close-shift (wristband_qr) -> marks wristband status 'used', sets shift_end

### 4. FRONTEND SKELETON (React)
- Two main routes: /kiosk and /admin (simple React Router setup).
- /kiosk view (no login required):
  - Screen A: "Scan Worker ID" (input/mock QR scan -> worker_id)
  - Screen B: "Scan Wristband QR" (input/mock QR scan -> wristband_qr) -> calls POST /api/bind-wristband
  - Screen C: "Place Wristband to Scan" -> camera capture UI (use browser getUserMedia) -> calls POST /api/scan
  - Screen D: Result display (dose, risk band, confidence) — mock data ok for now
  - Screen E: quality-gate failure state ("Image unclear — please re-scan") — wire this as a UI state
- /admin view (Supabase Auth login required):
  - Login screen
  - Dashboard: table of all workers with latest dose/risk band (mock data ok)
  - Click into a worker -> history view (simple line chart placeholder using Recharts)
  - Environmental/ambient panel section reserved (empty/placeholder, real data Phase 3)
- Style: navy/white industrial-safety base, color-coded risk bands (tan -> gold -> olive -> near-black), clean and readable on a projector.

## END OF PHASE 1 CHECK
I should be able to open /kiosk, walk through worker ID -> wristband QR -> capture -> see a (mock) result, and separately open /admin, log in, and see a worker list with mock data. Confirm this works before I move to Phase 2.
