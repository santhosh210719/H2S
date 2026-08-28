/**
 * Color features from the 2-zone badge:
 *   Zone 1 (left ~55%): H2S-reactive patch array
 *   Zone 2 (right): printed reference scale + QR (QR decoded separately at kiosk)
 * No sealed control / drift-correction zone (intentionally omitted).
 */
import sharp from "sharp";

export function riskBandFromDose(dose) {
  if (dose <= 0) return "fresh";
  if (dose <= 1) return "low";
  if (dose <= 5) return "medium";
  if (dose <= 20) return "high";
  return "very_high";
}

function meanRgb(data, width, height, x0, y0, x1, y1) {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(width, Math.ceil(x1));
  const yb = Math.min(height, Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * width + x) * 3;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

function rgbToLabApprox({ r, g, b }) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [R, G, B] = srgb;
  const x = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const xn = x / 0.95047;
  const yn = y / 1;
  const zn = z / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export async function extractColorFeatures(buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: 480, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const patch = meanRgb(data, width, height, width * 0.08, height * 0.18, width * 0.52, height * 0.82);
  const refWhite = meanRgb(data, width, height, width * 0.58, height * 0.08, width * 0.92, height * 0.22);
  const lab = rgbToLabApprox(patch);
  const darkness = 1 - (0.2126 * patch.r + 0.7152 * patch.g + 0.0722 * patch.b) / 255;
  const refL = rgbToLabApprox(refWhite).L || 1;
  const relDark = Math.max(0, Math.min(1, 1 - lab.L / Math.max(refL, 1)));

  return {
    patch_r: Number(patch.r.toFixed(2)),
    patch_g: Number(patch.g.toFixed(2)),
    patch_b: Number(patch.b.toFixed(2)),
    L: Number(lab.L.toFixed(3)),
    a: Number(lab.a.toFixed(3)),
    b: Number(lab.b.toFixed(3)),
    darkness: Number(darkness.toFixed(4)),
    rel_dark: Number(relDark.toFixed(4)),
  };
}

/**
 * Official H2S-DOSAI Reference Swatches (RGB & CIELAB):
 *   Fresh:     #F0E9E2 -> RGB(240, 233, 226) -> L: 92.5, a: 1.2, b:  4.5 -> dose: 0.0 ppm·h (Fresh)
 *   Low:       #DCC08A -> RGB(220, 192, 138) -> L: 78.6, a: 3.5, b: 31.8 -> dose: 0.8 ppm·h (Low)
 *   Medium:    #B8902F -> RGB(184, 144,  47) -> L: 61.2, a: 7.8, b: 54.2 -> dose: 3.0 ppm·h (Medium)
 *   High:      #5C4A1E -> RGB( 92,  74,  30) -> L: 33.1, a: 3.2, b: 28.5 -> dose: 12.5 ppm·h (High)
 *   Very High: #231A24 -> RGB( 35,  26,  36) -> L: 11.2, a: 5.8, b: -4.8 -> dose: 25.0 ppm·h (Very High)
 */
export const COLOR_REFERENCE_SWATCHES = [
  { name: "fresh",     hex: "#F0E9E2", r: 240, g: 233, b: 226, L: 92.5, a: 1.2,  b_lab: 4.5,  targetDose: 0.0 },
  { name: "low",       hex: "#DCC08A", r: 220, g: 192, b: 138, L: 78.6, a: 3.5,  b_lab: 31.8, targetDose: 0.8 },
  { name: "medium",    hex: "#B8902F", r: 184, g: 144, b: 47,  L: 61.2, a: 7.8,  b_lab: 54.2, targetDose: 3.0 },
  { name: "high",      hex: "#5C4A1E", r: 92,  g: 74,  b: 30,  L: 33.1, a: 3.2,  b_lab: 28.5, targetDose: 12.5 },
  { name: "very_high", hex: "#231A24", r: 35,  g: 26,  b: 36,  L: 11.2, a: 5.8,  b_lab: -4.8, targetDose: 25.0 },
];

/** Explainable fallback if Python/XGBoost is offline: color-hue CIELAB classification -> ppm·h. */
export function heuristicDose(features) {
  let L = features.L;
  let a = features.a;
  let b_lab = features.b;

  if (L == null || a == null || b_lab == null) {
    const pr = features.patch_r ?? 200;
    const pg = features.patch_g ?? 200;
    const pb = features.patch_b ?? 200;
    const lab = rgbToLabApprox({ r: pr, g: pg, b: pb });
    L = lab.L;
    a = lab.a;
    b_lab = lab.b;
  }

  // Calculate weighted Lab distance to each reference swatch (chromatic weight = 1.5)
  const distances = COLOR_REFERENCE_SWATCHES.map((swatch) => {
    const dL = L - swatch.L;
    const da = a - swatch.a;
    const db = b_lab - swatch.b_lab;
    const dist = Math.sqrt(dL * dL + 1.5 * da * da + 1.5 * db * db);
    return { ...swatch, dist };
  });

  // Find nearest swatch
  distances.sort((d1, d2) => d1.dist - d2.dist);
  const nearest = distances[0];
  const second = distances[1];

  // Interpolate dose between nearest two swatches
  const totalWeight = (1 / Math.max(0.1, nearest.dist)) + (1 / Math.max(0.1, second.dist));
  const w1 = (1 / Math.max(0.1, nearest.dist)) / totalWeight;
  const w2 = (1 / Math.max(0.1, second.dist)) / totalWeight;
  let interpolatedDose = w1 * nearest.targetDose + w2 * second.targetDose;
  if (nearest.name === "fresh" && nearest.dist < 8) {
    interpolatedDose = 0.0;
  }

  const confidence = Math.max(0.65, Math.min(0.92, 0.95 - nearest.dist * 0.005));

  return {
    dose_ppm_h: Number(interpolatedDose.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    classified_band: nearest.name,
    engine: "heuristic-color-classifier",
  };
}
