/**
 * Local quality gate (hard requirement): blur + glare/overexposure.
 * Failed images never reach the dose model.
 * Python microservice is preferred when PYTHON_ML_URL is up; this is the Node fallback.
 */
import sharp from "sharp";

const BLUR_MIN = Number(process.env.BLUR_VARIANCE_MIN || 80);
const GLARE_MAX = Number(process.env.GLARE_RATIO_MAX || 0.12);

function laplacianVariance(gray, width, height) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function glareRatio(rgb, width, height) {
  let glare = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    if (v > 0.92 && s < 0.18) glare++;
  }
  return glare / n;
}

export async function localQualityGate(buffer) {
  const img = sharp(buffer).resize({ width: 640, withoutEnlargement: true }).removeAlpha();
  const grayMeta = await img.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgbMeta = await img.clone().raw().toBuffer({ resolveWithObject: true });

  const blurScore = laplacianVariance(
    grayMeta.data,
    grayMeta.info.width,
    grayMeta.info.height
  );
  const glare = glareRatio(rgbMeta.data, rgbMeta.info.width, rgbMeta.info.height);

  const reasons = [];
  if (blurScore < BLUR_MIN) reasons.push("blur");
  if (glare > GLARE_MAX) reasons.push("glare");

  return {
    pass: reasons.length === 0,
    blur_score: Number(blurScore.toFixed(2)),
    glare_ratio: Number(glare.toFixed(4)),
    fail_reason: reasons.length ? `Re-scan required: ${reasons.join(" + ")}` : null,
    engine: "node-sharp",
  };
}
