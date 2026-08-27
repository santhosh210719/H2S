-- Storage bucket for kiosk captures. Upload is service_role only (Express).
insert into storage.buckets (id, name, public)
values ('wristband-scans', 'wristband-scans', false)
on conflict (id) do nothing;

-- Authenticated admins may read objects if you later add signed URLs from the API.
-- Direct client uploads are not used (kiosk never talks to Storage with the anon key).
