import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();
import express from "express";
import cors from "cors";
import { kioskRouter } from "./routes/kiosk.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "h2s-dosai-api",
    kiosk_only: true,
    note: "Scanning is kiosk-station only — not worker phones.",
  });
});

app.use("/api/kiosk", kioskRouter);
app.use("/api/admin", adminRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`[h2s] API on http://localhost:${PORT}`);
});
