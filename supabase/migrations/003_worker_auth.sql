-- H2S-DOSAI Migration 003 — Worker PIN authentication
-- Adds pin_hash and active columns to public.workers.
-- PINs are hashed server-side (bcrypt, saltRounds=12) before storage.

alter table public.workers
  add column if not exists pin_hash text not null default '',
  add column if not exists active   boolean not null default true;

-- Ensure service_role can update pin_hash (it already bypasses RLS,
-- but explicit comment documents intent).
-- Authenticated admins can read worker records (existing policy covers this).

-- Admin can create workers via API (service_role used by Express).
drop policy if exists workers_admin_insert on public.workers;
create policy workers_admin_insert on public.workers
  for insert to authenticated with check (true);

drop policy if exists workers_admin_update on public.workers;
create policy workers_admin_update on public.workers
  for update to authenticated using (true);
