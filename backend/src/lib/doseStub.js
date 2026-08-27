export const USED_MSG = "This wristband has already been used — please use a new one.";

export function riskBand(dose) {
  if (dose == null) return null;
  if (dose <= 0) return "fresh";
  if (dose <= 1) return "low";
  if (dose <= 5) return "medium";
  if (dose <= 20) return "high";
  return "very_high";
}

export function mockDose(wristbandQr) {
  const n = [...String(wristbandQr)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const dose = Number((((n % 37) / 37) * 18 + 0.2).toFixed(2));
  return { dose_ppm_h: dose, confidence: 0.81, risk_band: riskBand(dose) };
}
