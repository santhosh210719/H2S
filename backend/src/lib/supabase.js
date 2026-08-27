import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn("[h2s] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — API will fail until .env is set");
}

export const supabaseAdmin = createClient(url || "http://localhost:54321", key || "missing", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "wristband-scans";
