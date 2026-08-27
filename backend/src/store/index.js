import { memoryStore } from "./memory.js";
import { supabaseStore } from "./supabaseStore.js";

const hasCloud =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !String(process.env.SUPABASE_URL).includes("YOUR_PROJECT");

export const store = hasCloud ? supabaseStore : memoryStore;

if (!hasCloud) {
  console.warn("[h2s] No Supabase keys — using in-memory Phase 1 mock store");
}
