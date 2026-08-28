import { createClient } from "@supabase/supabase-js";

/**
 * RAW ADC → estimated ppm calibration (exact steps from external live sensor hardware):
 *   adc < 700   → 0 ppm   (SAFE)
 *   adc < 760   → 5 ppm   (CAUTION)
 *   adc < 820   → 10 ppm  (WARNING)
 *   adc >= 820  → 15 ppm  (CRITICAL)
 */
export const ADC_CALIBRATION_STEPS = [
  { maxAdc: 699, ppm: 0, status: "SAFE" },
  { maxAdc: 759, ppm: 5, status: "CAUTION" },
  { maxAdc: 819, ppm: 10, status: "WARNING" },
  { maxAdc: Infinity, ppm: 15, status: "CRITICAL" },
];

export function adcToPpm(adc) {
  const rawAdc = Number(adc) || 0;
  for (const step of ADC_CALIBRATION_STEPS) {
    if (rawAdc <= step.maxAdc) {
      return { ppm: step.ppm, status: step.status, adc: rawAdc };
    }
  }
  return { ppm: 15, status: "CRITICAL", adc: rawAdc };
}

const url = process.env.SENSOR_SUPABASE_URL;
const key = process.env.SENSOR_SUPABASE_ANON_KEY;

export const isSensorConfigured = Boolean(
  url && key && !url.includes("YOUR_PROJECT") && url.trim().length > 0
);

export const sensorSupabaseClient = isSensorConfigured
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
