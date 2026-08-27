-- H2S-DOSAI schema (SIH 26118)
-- Wristband QR is factory-issued and ONE-TIME-USE after shift close-out.
-- Scanning is kiosk-only (Express uses service_role). Admins read via Auth + RLS.

create extension if not exists pgcrypto;

do $$ begin
  create type wristband_status as enum ('unused', 'bound', 'used');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type shift_status as enum ('active', 'closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type risk_band as enum ('fresh', 'low', 'medium', 'high', 'very_high');
exception when duplicate_object then null;
end $$;

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  worker_code text not null unique,
  full_name text not null,
  department text,
  created_at timestamptz not null default now()
);

create table if not exists public.wristbands (
  id uuid primary key default gen_random_uuid(),
  qr_code text not null unique,
  status wristband_status not null default 'unused',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id),
  wristband_id uuid not null references public.wristbands (id),
  kiosk_id text not null default 'KIOSK-MUSTER-01',
  status shift_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (wristband_id, started_at)
);

create unique index if not exists shifts_one_active_per_wristband
  on public.shifts (wristband_id)
  where status = 'active';

create unique index if not exists shifts_one_active_per_worker
  on public.shifts (worker_id)
  where status = 'active';

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  worker_id uuid not null references public.workers (id),
  wristband_id uuid not null references public.wristbands (id),
  kiosk_id text not null,
  image_path text,
  quality_pass boolean not null default false,
  quality_fail_reason text,
  blur_score double precision,
  glare_ratio double precision,
  dose_ppm_h double precision,
  confidence double precision,
  risk_band risk_band,
  color_features jsonb,
  created_at timestamptz not null default now()
);

-- OPTIONAL / TIER-2: active wearable pack (MQ-136 + DHT-11). Supplementary live
-- ambient layer ONLY — does not replace the passive badge cumulative dose.
create table if not exists public.sensor_readings (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.workers (id),
  device_id text not null,
  h2s_ppm double precision,
  temperature_c double precision,
  humidity_pct double precision,
  created_at timestamptz not null default now()
);

create index if not exists scans_created_at_idx on public.scans (created_at desc);
create index if not exists sensor_readings_created_at_idx on public.sensor_readings (created_at desc);

alter table public.workers enable row level security;
alter table public.wristbands enable row level security;
alter table public.shifts enable row level security;
alter table public.scans enable row level security;
alter table public.sensor_readings enable row level security;

-- Kiosk traffic goes through Express (service_role bypasses RLS).
-- Dashboard: any authenticated admin can read; close-shift goes through API.

drop policy if exists workers_select_auth on public.workers;
create policy workers_select_auth on public.workers
  for select to authenticated using (true);

drop policy if exists wristbands_select_auth on public.wristbands;
create policy wristbands_select_auth on public.wristbands
  for select to authenticated using (true);

drop policy if exists shifts_select_auth on public.shifts;
create policy shifts_select_auth on public.shifts
  for select to authenticated using (true);

drop policy if exists scans_select_auth on public.scans;
create policy scans_select_auth on public.scans
  for select to authenticated using (true);

drop policy if exists sensor_select_auth on public.sensor_readings;
create policy sensor_select_auth on public.sensor_readings
  for select to authenticated using (true);

-- Atomic bind: unused wristband + known worker -> active shift.
create or replace function public.bind_shift(
  p_worker_code text,
  p_wristband_qr text,
  p_kiosk_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_band public.wristbands%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_worker from public.workers where worker_code = p_worker_code;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKER_NOT_FOUND',
      'error', 'Worker ID QR not recognised.');
  end if;

  select * into v_band from public.wristbands where qr_code = p_wristband_qr for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WRISTBAND_NOT_FOUND',
      'error', 'Wristband QR not recognised.');
  end if;

  if v_band.status = 'used' then
    return jsonb_build_object('ok', false, 'code', 'WRISTBAND_USED',
      'error', 'This wristband has already been used — please use a new one.');
  end if;

  if v_band.status = 'bound' then
    return jsonb_build_object('ok', false, 'code', 'WRISTBAND_BOUND',
      'error', 'This wristband is already bound to an active shift.');
  end if;

  if exists (select 1 from public.shifts where worker_id = v_worker.id and status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'WORKER_ACTIVE_SHIFT',
      'error', 'This worker already has an active shift. Close it before binding a new badge.');
  end if;

  insert into public.shifts (worker_id, wristband_id, kiosk_id, status)
  values (v_worker.id, v_band.id, coalesce(p_kiosk_id, 'KIOSK-MUSTER-01'), 'active')
  returning * into v_shift;

  update public.wristbands set status = 'bound' where id = v_band.id;

  return jsonb_build_object(
    'ok', true,
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'kiosk_id', v_shift.kiosk_id,
      'started_at', v_shift.started_at,
      'status', v_shift.status
    ),
    'worker', jsonb_build_object(
      'id', v_worker.id,
      'worker_code', v_worker.worker_code,
      'full_name', v_worker.full_name,
      'department', v_worker.department
    ),
    'wristband', jsonb_build_object(
      'id', v_band.id,
      'qr_code', v_band.qr_code,
      'status', 'bound'
    )
  );
end;
$$;

create or replace function public.close_shift_by_wristband(
  p_wristband_qr text,
  p_kiosk_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_band public.wristbands%rowtype;
  v_shift public.shifts%rowtype;
  v_worker public.workers%rowtype;
begin
  select * into v_band from public.wristbands where qr_code = p_wristband_qr for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WRISTBAND_NOT_FOUND',
      'error', 'Wristband QR not recognised.');
  end if;

  if v_band.status = 'used' then
    return jsonb_build_object('ok', false, 'code', 'WRISTBAND_USED',
      'error', 'This wristband has already been used — please use a new one.');
  end if;

  select * into v_shift
  from public.shifts
  where wristband_id = v_band.id and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_SHIFT',
      'error', 'No active shift for this wristband.');
  end if;

  select * into v_worker from public.workers where id = v_shift.worker_id;

  update public.shifts
    set status = 'closed', ended_at = now()
    where id = v_shift.id;

  update public.wristbands
    set status = 'used', used_at = now()
    where id = v_band.id;

  return jsonb_build_object(
    'ok', true,
    'message', 'Shift closed. Wristband QR is permanently marked used.',
    'worker', jsonb_build_object('worker_code', v_worker.worker_code, 'full_name', v_worker.full_name),
    'wristband', jsonb_build_object('qr_code', v_band.qr_code, 'status', 'used')
  );
end;
$$;

revoke all on function public.bind_shift(text, text, text) from public, anon, authenticated;
revoke all on function public.close_shift_by_wristband(text, text) from public, anon, authenticated;
grant execute on function public.bind_shift(text, text, text) to service_role;
grant execute on function public.close_shift_by_wristband(text, text) to service_role;

insert into public.workers (worker_code, full_name, department) values
  ('WKR-1001', 'Arun Kumar', 'CDU'),
  ('WKR-1002', 'Priya Nair', 'SRU'),
  ('WKR-1003', 'Rahul Shetty', 'Utilities')
on conflict (worker_code) do nothing;

insert into public.wristbands (qr_code, status) values
  ('WB-2026-000481', 'unused'),
  ('WB-2026-000482', 'unused'),
  ('WB-2026-000483', 'unused'),
  ('WB-2026-000484', 'unused'),
  ('WB-2026-000499', 'used')
on conflict (qr_code) do nothing;

update public.wristbands
  set used_at = now()
  where qr_code = 'WB-2026-000499' and used_at is null;

alter table public.scans replica identity full;
alter table public.shifts replica identity full;
alter table public.sensor_readings replica identity full;
