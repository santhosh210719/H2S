"""
Synthetic trainer for explainable H2S dose regression.

Features (color of Zone 1 patch vs printed reference) -> cumulative dose (ppm·h).
Model: XGBoost gradient boosted trees — NOT a CNN.

Risk mapping used for labels:
  Fresh 0 | Low 0-1 | Medium 1-5 | High 5-20 | Very High >20 (cap 50)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import xgboost as xgb

ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)

FEATURE_NAMES = ["L", "a", "b", "darkness", "rel_dark", "patch_r", "patch_g", "patch_b"]


def dose_from_rel_dark(d: np.ndarray) -> np.ndarray:
    d = np.clip(d, 0, 1)
    return np.minimum(50.0, (np.exp(d * 3.6) - 1.0) * 3.4)


def synthesize(n: int = 4000, seed: int = 42):
    rng = np.random.default_rng(seed)
    rel_dark = rng.beta(1.4, 1.8, size=n)
    darkness = np.clip(rel_dark + rng.normal(0, 0.03, n), 0, 1)
    L = 92 - rel_dark * 78 + rng.normal(0, 1.5, n)
    a = 4 + rel_dark * 18 + rng.normal(0, 1.2, n)
    b = 8 + rel_dark * 22 + rng.normal(0, 1.5, n)
    patch_r = (1 - rel_dark) * 230 + rel_dark * 25 + rng.normal(0, 6, n)
    patch_g = (1 - rel_dark) * 220 + rel_dark * 22 + rng.normal(0, 6, n)
    patch_b = (1 - rel_dark) * 205 + rel_dark * 18 + rng.normal(0, 6, n)
    X = np.column_stack([L, a, b, darkness, rel_dark, patch_r, patch_g, patch_b])
    y = dose_from_rel_dark(rel_dark) + rng.normal(0, 0.15, n)
    y = np.clip(y, 0, 50)
    return X, y


def main():
    X, y = synthesize()
    split = int(0.8 * len(y))
    model = xgb.XGBRegressor(
        n_estimators=120,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=42,
    )
    model.fit(X[:split], y[:split])
    pred = model.predict(X[split:])
    mae = float(np.mean(np.abs(pred - y[split:])))
    rmse = float(np.sqrt(np.mean((pred - y[split:]) ** 2)))
    model.save_model(MODEL_DIR / "dose_xgb.json")
    meta = {
        "feature_names": FEATURE_NAMES,
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "note": "Synthetic colorimetric mapping for SIH demo — replace with lab-calibrated pairs later.",
        "importance": {k: float(v) for k, v in zip(FEATURE_NAMES, model.feature_importances_)},
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
