-- H2S-DOSAI Phase 1 schema (SIH 26118)
-- Kiosk writes go through Express (service_role). Admins read via Auth + RLS.

create extension if not exists pgcrypto;

do $$ begin
  create type wristband_status as enum ('available', 'bound', 'used');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type quality_status as enum ('pass', 'blur', 'glare');
exception when duplicate_object then null;
end $$;

create table if not exists public.workers (
  worker_id text primary key,
  name text not null,
  department text,
  shift text,
  created_at timestamptz not null default now()
);

create table if not exists public.wristbands (
  wristband_qr text primary key,
  batch_id text,
  manufactured_date date,
  status wristband_status not null default 'available',
  created_at timestamptz not null default now()
);

create table if not exists public.shift_bindings (
  id uuid primary key default gen_random_uuid(),
  wristband_qr text not null references public.wristbands (wristband_qr),
  worker_id text not null references public.workers (worker_id),
  shift_start timestamptz not null default now(),
  shift_end timestamptz,
  kiosk_location text not null default 'KIOSK-MUSTER-01'
);

create unique index if not exists shift_bindings_one_open_band
  on public.shift_bindings (wristband_qr)
  where shift_end is null;

create unique index if not exists shift_bindings_one_open_worker
  on public.shift_bindings (worker_id)
  where shift_end is null;

create table if not exists public.scan_logs (
  id uuid primary key default gen_random_uuid(),
  wristband_qr text not null references public.wristbands (wristband_qr),
  timestamp timestamptz not null default now(),
  image_url text,
  quality_status quality_status not null default 'pass',
  dose_ppm_h double precision,
  confidence double precision,
  risk_band text
);

create table if not exists public.live_ambient_readings (
  id uuid primary key default gen_random_uuid(),
  worker_id text references public.workers (worker_id),
  kiosk_location text,
  ambient_h2s_ppm double precision,
  temperature_c double precision,
  humidity_percent double precision,
  timestamp timestamptz not null default now()
);

create index if not exists scan_logs_ts_idx on public.scan_logs (timestamp desc);
create index if not exists ambient_ts_idx on public.live_ambient_readings (timestamp desc);

alter table public.workers enable row level security;
alter table public.wristbands enable row level security;
alter table public.shift_bindings enable row level security;
alter table public.scan_logs enable row level security;
alter table public.live_ambient_readings enable row level security;

-- Admin (authenticated) can read everything.
drop policy if exists workers_admin_read on public.workers;
create policy workers_admin_read on public.workers for select to authenticated using (true);

drop policy if exists wristbands_admin_read on public.wristbands;
create policy wristbands_admin_read on public.wristbands for select to authenticated using (true);

drop policy if exists bindings_admin_read on public.shift_bindings;
create policy bindings_admin_read on public.shift_bindings for select to authenticated using (true);

drop policy if exists scans_admin_read on public.scan_logs;
create policy scans_admin_read on public.scan_logs for select to authenticated using (true);

drop policy if exists ambient_admin_read on public.live_ambient_readings;
create policy ambient_admin_read on public.live_ambient_readings for select to authenticated using (true);

-- Direct anon kiosk is denied. Kiosk uses Express + service_role (bypasses RLS)
-- for bind/scan/close. If a shared kiosk JWT is added later, grant only:
--   select on workers, wristbands, shift_bindings
--   insert on scan_logs
-- Do not grant wristband status updates to anon.

alter table public.scan_logs replica identity full;
alter table public.shift_bindings replica identity full;
alter table public.live_ambient_readings replica identity full;

insert into public.workers (worker_id, name, department, shift) values
  ('WKR-1001', 'Arun Kumar', 'CDU', 'A'),
  ('WKR-1002', 'Priya Nair', 'SRU', 'A'),
  ('WKR-1003', 'Rahul Shetty', 'Utilities', 'B')
on conflict (worker_id) do nothing;

insert into public.wristbands (wristband_qr, batch_id, manufactured_date, status) values
  ('WB-2026-000481', 'BATCH-26-01', '2026-06-01', 'available'),
  ('WB-2026-000482', 'BATCH-26-01', '2026-06-01', 'available'),
  ('WB-2026-000483', 'BATCH-26-01', '2026-06-01', 'available'),
  ('WB-2026-000484', 'BATCH-26-01', '2026-06-01', 'available'),
  ('WB-2026-000499', 'BATCH-25-12', '2025-12-15', 'used')
on conflict (wristband_qr) do nothing;
