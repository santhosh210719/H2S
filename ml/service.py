"""
Python CV/ML microservice.
  POST /quality  — Laplacian blur + glare gate (images that fail never go to /dose)
  POST /dose     — XGBoost on color features -> ppm·h + confidence
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import cv2
import numpy as np
import xgboost as xgb
from flask import Flask, jsonify, request
from PIL import Image

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "models" / "dose_xgb.json"
FEATURE_NAMES = ["L", "a", "b", "darkness", "rel_dark", "patch_r", "patch_g", "patch_b"]

BLUR_MIN = 80.0
GLARE_MAX = 0.12

app = Flask(__name__)
_booster = None


def load_model():
    global _booster
    if _booster is None and MODEL_PATH.exists():
        _booster = xgb.XGBRegressor()
        _booster.load_model(MODEL_PATH)
    return _booster


def read_bgr():
    file = request.files.get("image")
    if not file:
        return None
    data = np.frombuffer(file.read(), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return img


def quality_gate(bgr: np.ndarray) -> dict:
    h, w = bgr.shape[:2]
    scale = 640 / max(w, 1)
    if scale < 1:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)))
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    blur_score = float(lap.var())
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    glare = float(np.mean((v > 235) & (s < 40)))
    reasons = []
    if blur_score < BLUR_MIN:
        reasons.append("blur")
    if glare > GLARE_MAX:
        reasons.append("glare")
    return {
        "pass": len(reasons) == 0,
        "blur_score": round(blur_score, 2),
        "glare_ratio": round(glare, 4),
        "fail_reason": f"Re-scan required: {' + '.join(reasons)}" if reasons else None,
        "engine": "python-opencv",
    }


def detect_and_crop(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        c = max(contours, key=cv2.contourArea)
        x, y, w, h = cv2.boundingRect(c)
        if w > 80 and h > 50:
            return bgr[y : y + h, x : x + w]
    return bgr


def normalize_lighting(bgr: np.ndarray) -> np.ndarray:
    h, w = bgr.shape[:2]
    ref_region = bgr[int(h * 0.04) : int(h * 0.28), int(w * 0.52) : int(w * 0.96)]
    if ref_region.size > 0:
        mean_bgr = ref_region.reshape(-1, 3).mean(axis=0)
        scale = 245.0 / np.maximum(mean_bgr, 1.0)
        return np.clip(bgr.astype(np.float32) * scale, 0, 255).astype(np.uint8)
    return bgr


def features_from_bgr(bgr: np.ndarray) -> dict:
    cropped = detect_and_crop(bgr)
    norm = normalize_lighting(cropped)
    h, w, _ = norm.shape

    patch = norm[int(h * 0.18) : int(h * 0.82), int(w * 0.08) : int(w * 0.52)]
    ref = norm[int(h * 0.08) : int(h * 0.22), int(w * 0.58) : int(w * 0.92)]
    if patch.size == 0:
        patch = norm

    mean_bgr = patch.reshape(-1, 3).mean(axis=0)
    b, g, r = mean_bgr
    lab = cv2.cvtColor(np.uint8([[mean_bgr]]), cv2.COLOR_BGR2LAB)[0, 0]
    L, a, bb = [float(x) for x in lab]
    L = L * (100 / 255)
    a_val = float(a) - 128
    b_val = float(bb) - 128

    darkness = 1.0 - (0.114 * b + 0.587 * g + 0.299 * r) / 255.0

    if ref.size:
        ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(axis=0)
        ref_L = float(ref_lab[0]) * (100 / 255) or 1.0
    else:
        ref_L = 90.0

    rel_dark = float(np.clip(1.0 - L / max(ref_L, 1.0), 0, 1))

    # Delta E 1976 from fresh baseline (L=92, a=4, b=8)
    delta_e = float(np.sqrt((L - 92.0) ** 2 + (a_val - 4.0) ** 2 + (b_val - 8.0) ** 2))

    # HSV metrics
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    hue_mean = float(hsv[:, :, 0].mean())
    sat_mean = float(hsv[:, :, 1].mean())
    grad_score = float(np.std(patch.astype(np.float32).mean(axis=2), axis=0).mean())

    return {
        "L": round(L, 3),
        "a": round(a_val, 3),
        "b": round(b_val, 3),
        "darkness": round(float(darkness), 4),
        "rel_dark": round(rel_dark, 4),
        "patch_r": round(float(r), 2),
        "patch_g": round(float(g), 2),
        "patch_b": round(float(b), 2),
        "delta_e": round(delta_e, 3),
        "hue_mean": round(hue_mean, 2),
        "sat_mean": round(sat_mean, 2),
        "grad_score": round(grad_score, 3),
    }



def predict_dose(feat: dict) -> dict:
    model = load_model()
    x = np.array([[feat.get(k, 0) for k in FEATURE_NAMES]], dtype=np.float32)
    if model is None:
        d = float(np.clip(feat.get("rel_dark", 0), 0, 1))
        dose = float(min(50.0, (np.exp(d * 3.6) - 1) * 3.4))
        return {"dose_ppm_h": round(dose, 3), "confidence": 0.6, "engine": "heuristic-no-model"}
    pred = float(model.predict(x)[0])
    pred = float(np.clip(pred, 0, 50))
    # Tree ensemble: tighter confidence when prediction sits in dense synthetic range
    confidence = float(np.clip(0.92 - abs(pred - 8) / 80, 0.62, 0.95))
    return {"dose_ppm_h": round(pred, 3), "confidence": round(confidence, 3), "engine": "xgboost"}


@app.get("/health")
def health():
    return jsonify({"ok": True, "model": MODEL_PATH.exists()})


@app.post("/quality")
def quality():
    img = read_bgr()
    if img is None:
        return jsonify({"pass": False, "fail_reason": "No image"}), 400
    return jsonify(quality_gate(img))


@app.post("/dose")
def dose():
    raw_feat = request.form.get("features")
    feat = json.loads(raw_feat) if raw_feat else None
    img = read_bgr()
    if feat is None:
        if img is None:
            return jsonify({"error": "Need image or features"}), 400
        feat = features_from_bgr(img)
    out = predict_dose(feat)
    out["features"] = feat
    return jsonify(out)


if __name__ == "__main__":
    load_model()
    app.run(host="127.0.0.1", port=5001, debug=False)
