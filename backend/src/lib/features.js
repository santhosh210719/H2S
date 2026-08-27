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

/** Explainable fallback if Python/XGBoost is offline: darkness -> ppm·h (same synthetic mapping). */
export function heuristicDose(features) {
  const d = Math.max(0, Math.min(1, features.rel_dark ?? features.darkness ?? 0));
  const dose = Math.min(50, (Math.exp(d * 3.6) - 1) * 3.4);
  const confidence = 0.55 + 0.25 * (1 - Math.abs(d - 0.5) * 0.4);
  return {
    dose_ppm_h: Number(dose.toFixed(3)),
    confidence: Number(Math.min(0.85, confidence).toFixed(3)),
    engine: "heuristic-fallback",
  };
}
