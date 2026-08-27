"""
generate_dataset.py — Synthetic H₂S dosimeter badge image generator.

Outputs:
  ml/dataset/clean/  — ~1000 labeled JPEG images, realistic kiosk lighting
  ml/dataset/bad/    — ~200 bad-quality images (blur + glare) for quality-gate testing
  ml/dataset/labels.csv — dose_ppm_h, risk_band, quality_status, extracted color features

Badge layout (640 × 360 px):
  Zone 1 (left 50%): H₂S reactive patch — color evolves white→tan→gold→olive→near-black
  Zone 2 (right 50%):
    - Top 25%: printed white reference area (for lighting normalisation)
    - Middle 65%: 5-band fixed reference color scale
    - Bottom 10%: QR code placeholder (black on white)

Color model: RGB derived from cumulative dose (ppm·h) with kiosk-grade noise (±8 RGB).
"""
from __future__ import annotations

import csv
import math
import random
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parent
DATASET_DIR = ROOT / "dataset"
CLEAN_DIR = DATASET_DIR / "clean"
BAD_DIR = DATASET_DIR / "bad"
LABEL_FILE = DATASET_DIR / "labels.csv"

for d in (CLEAN_DIR, BAD_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ── Risk band boundaries (ppm·h) ─────────────────────────────────────────────
BANDS = [
    (0.0,   "fresh"),
    (1.0,   "low"),
    (5.0,   "medium"),
    (20.0,  "high"),
    (50.0,  "very_high"),
]
BAND_COLORS = {
    "fresh":     (240, 238, 232),   # off-white
    "low":       (210, 195, 165),   # pale tan
    "medium":    (185, 148,  32),   # gold/amber
    "high":      ( 88, 105,  42),   # olive/brown
    "very_high": ( 25,  22,  18),   # near-black
}

# Reference scale strip colours (left→right = fresh→very_high)
REF_STRIP_COLORS = list(BAND_COLORS.values())


def risk_band(dose: float) -> str:
    if dose < 1.0:
        return "fresh"
    if dose < 5.0:
        return "low"
    if dose < 20.0:
        return "medium"
    if dose < 50.0:
        return "high"
    return "very_high"


def dose_to_patch_rgb(dose: float, rng: np.random.Generator, noise: float = 8.0) -> tuple[int, int, int]:
    """Smooth interpolation across the dose→color curve + kiosk-grade noise."""
    anchors = [
        (0.0,  BAND_COLORS["fresh"]),
        (1.0,  BAND_COLORS["low"]),
        (5.0,  BAND_COLORS["medium"]),
        (20.0, BAND_COLORS["high"]),
        (50.0, BAND_COLORS["very_high"]),
    ]
    d = float(np.clip(dose, 0, 50))
    # find segment
    for i in range(len(anchors) - 1):
        d0, c0 = anchors[i]
        d1, c1 = anchors[i + 1]
        if d <= d1:
            t = (d - d0) / (d1 - d0)
            r = c0[0] + t * (c1[0] - c0[0])
            g = c0[1] + t * (c1[1] - c0[1])
            b = c0[2] + t * (c1[2] - c0[2])
            noise_v = rng.normal(0, noise, 3)
            r = int(np.clip(r + noise_v[0], 0, 255))
            g = int(np.clip(g + noise_v[1], 0, 255))
            b = int(np.clip(b + noise_v[2], 0, 255))
            return r, g, b
    r, g, b = BAND_COLORS["very_high"]
    return (int(np.clip(r + rng.normal(0, noise), 0, 255)),
            int(np.clip(g + rng.normal(0, noise), 0, 255)),
            int(np.clip(b + rng.normal(0, noise), 0, 255)))


def draw_badge(dose: float, rng: np.random.Generator, W: int = 640, H: int = 360) -> np.ndarray:
    """Render a synthetic 2-zone badge image. Returns BGR uint8 array."""
    img = np.zeros((H, W, 3), dtype=np.uint8)

    # ── Background (kiosk matte surface — dark grey-green) ──
    img[:] = (42, 48, 44)

    # ── Zone 1: reactive patch ────────────────────────────────────────────────
    px1, py1 = int(W * 0.04), int(H * 0.08)
    px2, py2 = int(W * 0.48), int(H * 0.92)
    patch_r, patch_g, patch_b = dose_to_patch_rgb(dose, rng)

    # Subtle gradient across patch (simulates uneven development)
    for col in range(px1, px2):
        t = (col - px1) / max(px2 - px1 - 1, 1)
        grad = int(rng.normal(0, 2))
        cv2.line(img, (col, py1), (col, py2),
                 (int(np.clip(patch_b + t * 8 + grad, 0, 255)),
                  int(np.clip(patch_g + t * 4 + grad, 0, 255)),
                  int(np.clip(patch_r - t * 4 + grad, 0, 255))), 1)

    # Patch border
    cv2.rectangle(img, (px1, py1), (px2, py2), (30, 34, 30), 1)

    # ── Zone 2: right half ────────────────────────────────────────────────────
    zx1, zy1 = int(W * 0.52), int(H * 0.04)
    zx2, zy2 = int(W * 0.96), int(H * 0.96)

    # White reference area (top 28% of Zone 2)
    ref_y2 = zy1 + int((zy2 - zy1) * 0.28)
    white_noise = rng.integers(-6, 7, (ref_y2 - zy1, zx2 - zx1, 3))
    ref_patch = np.clip(248 + white_noise, 230, 255).astype(np.uint8)
    img[zy1:ref_y2, zx1:zx2] = ref_patch

    # Reference color scale (5 bands)
    scale_y1 = ref_y2 + 4
    scale_y2 = zy2 - int((zy2 - zy1) * 0.12)
    band_h = (scale_y2 - scale_y1) // 5
    for i, (br, bg, bb) in enumerate(REF_STRIP_COLORS):
        by1 = scale_y1 + i * band_h
        by2 = by1 + band_h
        cv2.rectangle(img, (zx1, by1), (zx2, by2), (bb, bg, br), -1)
        cv2.rectangle(img, (zx1, by1), (zx2, by2), (20, 20, 20), 1)

    # QR placeholder (bottom 12% of Zone 2)
    qx1, qy1 = zx1 + 4, scale_y2 + 4
    qx2, qy2 = zx2 - 4, zy2
    cv2.rectangle(img, (qx1, qy1), (qx2, qy2), (255, 255, 255), -1)
    # Draw simple grid to mimic QR
    cell = max(4, (qx2 - qx1) // 10)
    for ci in range(10):
        for ri in range(4):
            if (ci + ri) % 2 == 0:
                cx1, cy1_ = qx1 + ci * cell, qy1 + ri * cell
                cv2.rectangle(img, (cx1, cy1_), (cx1 + cell - 1, cy1_ + cell - 1), (20, 20, 20), -1)

    # ── Slight vignette (kiosk camera corner darkening) ──
    cy, cx = H / 2, W / 2
    Y, X = np.ogrid[:H, :W]
    dist = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / math.sqrt(cx ** 2 + cy ** 2)
    vignette = np.clip(1.0 - 0.25 * dist ** 2, 0.7, 1.0).astype(np.float32)
    img = (img.astype(np.float32) * vignette[:, :, np.newaxis]).astype(np.uint8)

    return img


def extract_features_from_image(img: np.ndarray) -> dict:
    """Extract the same 8 color features as ml/service.py::features_from_bgr()."""
    h, w, _ = img.shape
    patch = img[int(h * 0.08): int(h * 0.92), int(w * 0.04): int(w * 0.48)]
    ref   = img[int(h * 0.04): int(h * 0.04 + (h * 0.96) * 0.28), int(w * 0.52): int(w * 0.96)]
    if patch.size == 0:
        patch = img
    mean_bgr = patch.reshape(-1, 3).mean(axis=0)
    b, g, r = mean_bgr
    lab = cv2.cvtColor(np.uint8([[mean_bgr]]), cv2.COLOR_BGR2LAB)[0, 0]
    L, a, bb = [float(x) for x in lab]
    L = L * (100 / 255)
    darkness = 1.0 - (0.114 * b + 0.587 * g + 0.299 * r) / 255.0
    ref_L = 90.0
    if ref.size:
        ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(axis=0)
        ref_L = float(ref_lab[0]) * (100 / 255) or 90.0
    rel_dark = float(np.clip(1.0 - L / max(ref_L, 1.0), 0, 1))
    return {
        "L": round(L, 3), "a": round(float(a) - 128, 3), "b": round(float(bb) - 128, 3),
        "darkness": round(float(darkness), 4), "rel_dark": round(rel_dark, 4),
        "patch_r": round(float(r), 2), "patch_g": round(float(g), 2), "patch_b": round(float(b), 2),
    }


def apply_blur(img: np.ndarray, sigma: float) -> np.ndarray:
    k = int(sigma * 3) | 1  # odd kernel
    k = max(k, 3)
    return cv2.GaussianBlur(img, (k, k), sigma)


def apply_glare(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = img.copy()
    H, W = img.shape[:2]
    # 2-4 glare rectangles
    for _ in range(int(rng.integers(2, 5))):
        gw = int(rng.integers(W // 5, W // 2))
        gh = int(rng.integers(H // 5, H // 2))
        gx = int(rng.integers(0, W - gw))
        gy = int(rng.integers(0, H - gh))
        val = int(rng.integers(240, 256))
        cv2.rectangle(out, (gx, gy), (gx + gw, gy + gh), (val, val, val), -1)
    return out


# ── JPEG encode helper ───────────────────────────────────────────────────────
def save_jpeg(img: np.ndarray, path: Path, quality: int = 92) -> None:
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, quality])


# ── Main ─────────────────────────────────────────────────────────────────────
def main(n_clean: int = 1000, n_bad: int = 200, seed: int = 42):
    rng = np.random.default_rng(seed)
    random.seed(seed)

    rows: list[dict] = []

    # ── Clean images ──────────────────────────────────────────────────────────
    print(f"Generating {n_clean} clean badge images…")
    # Sample dose from beta-like distribution: most samples in 0–20, tail to 50
    doses = []
    for _ in range(n_clean):
        d = rng.beta(1.2, 1.8) * 50
        doses.append(float(d))

    for i, dose in enumerate(doses):
        img = draw_badge(dose, rng)
        fname = f"clean_{i:04d}.jpg"
        save_jpeg(img, CLEAN_DIR / fname)
        feats = extract_features_from_image(img)
        rows.append({
            "filename": f"clean/{fname}",
            "dose_ppm_h": round(dose, 4),
            "risk_band": risk_band(dose),
            "quality_status": "pass",
            **feats,
        })
        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{n_clean} clean done")

    # ── Bad-quality images ────────────────────────────────────────────────────
    print(f"Generating {n_bad} bad-quality images…")
    n_blur  = n_bad // 2
    n_glare = n_bad - n_blur

    # Blur set
    for i in range(n_blur):
        dose = float(rng.beta(1.2, 1.8) * 50)
        img = draw_badge(dose, rng)
        sigma = float(rng.uniform(4, 12))
        img = apply_blur(img, sigma)
        fname = f"blur_{i:03d}.jpg"
        save_jpeg(img, BAD_DIR / fname, quality=85)
        feats = extract_features_from_image(img)
        rows.append({
            "filename": f"bad/{fname}",
            "dose_ppm_h": round(dose, 4),
            "risk_band": risk_band(dose),
            "quality_status": "blur",
            **feats,
        })

    # Glare set
    for i in range(n_glare):
        dose = float(rng.beta(1.2, 1.8) * 50)
        img = draw_badge(dose, rng)
        img = apply_glare(img, rng)
        fname = f"glare_{i:03d}.jpg"
        save_jpeg(img, BAD_DIR / fname, quality=85)
        feats = extract_features_from_image(img)
        rows.append({
            "filename": f"bad/{fname}",
            "dose_ppm_h": round(dose, 4),
            "risk_band": risk_band(dose),
            "quality_status": "glare",
            **feats,
        })

    # ── Write labels CSV ─────────────────────────────────────────────────────
    fieldnames = ["filename", "dose_ppm_h", "risk_band", "quality_status",
                  "L", "a", "b", "darkness", "rel_dark", "patch_r", "patch_g", "patch_b"]
    with open(LABEL_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone. {len(rows)} total samples.")
    print(f"  Clean : {n_clean} -> {CLEAN_DIR}")
    print(f"  Bad   : {n_bad}   -> {BAD_DIR}")
    print(f"  Labels: {LABEL_FILE}")


if __name__ == "__main__":
    main()
