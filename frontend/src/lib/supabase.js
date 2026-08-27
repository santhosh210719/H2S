import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured =
  url &&
  anon &&
  !String(url).includes("YOUR_PROJECT") &&
  !String(anon).includes("your-anon-key");

export const supabase = isConfigured ? createClient(url, anon) : null;

export const apiUrl = (path) => {
  const base = import.meta.env.VITE_API_URL || "";
  return `${base}${path}`;
};

