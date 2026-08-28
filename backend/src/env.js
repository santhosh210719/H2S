// env.js — MUST be the very first import in index.js.
// Loads the repo-root .env before any other module (which may read
// process.env at import time, e.g. store/index.js, lib/supabase.js) runs.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();