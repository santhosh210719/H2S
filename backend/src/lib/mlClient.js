import { localQualityGate } from "./qualityGate.js";
import { extractColorFeatures, heuristicDose, riskBandFromDose } from "./features.js";

const ML_URL = process.env.PYTHON_ML_URL || "http://127.0.0.1:5001";
const TIMEOUT = Number(process.env.PYTHON_ML_TIMEOUT_MS || 15000);

async function postMl(path, form) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${ML_URL}${path}`, { method: "POST", body: form, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ML ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function runQualityGate(buffer, filename = "scan.jpg") {
  try {
    const form = new FormData();
    form.append("image", new Blob([buffer]), filename);
    const remote = await postMl("/quality", form);
    if (remote && typeof remote.pass === "boolean") return { ...remote, engine: remote.engine || "python" };
  } catch {
    // fall through to Node Laplacian/glare gate
  }
  return localQualityGate(buffer);
}

export async function runDoseModel(buffer, features) {
  try {
    const form = new FormData();
    form.append("image", new Blob([buffer]), "scan.jpg");
    form.append("features", JSON.stringify(features));
    const remote = await postMl("/dose", form);
    if (remote && typeof remote.dose_ppm_h === "number") {
      return {
        dose_ppm_h: remote.dose_ppm_h,
        confidence: remote.confidence,
        engine: remote.engine || "xgboost",
      };
    }
  } catch {
    // explainable local fallback — still color features -> dose, not a CNN
  }
  return heuristicDose(features);
}

export async function analyzeBadgeImage(buffer, filename) {
  const quality = await runQualityGate(buffer, filename);
  if (!quality.pass) {
    return { quality, features: null, dose: null, risk_band: null };
  }
  const features = await extractColorFeatures(buffer);
  const dose = await runDoseModel(buffer, features);
  return {
    quality,
    features,
    dose,
    risk_band: riskBandFromDose(dose.dose_ppm_h),
  };
}
