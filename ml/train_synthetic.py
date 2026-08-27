"""
train_synthetic.py — Train XGBoost dose regression model.

Phase 2: Loads from ml/dataset/labels.csv (image-derived features) when available.
Falls back to generating numeric features from scratch if dataset not generated yet.

Outputs:
  ml/models/dose_xgb.json  — trained XGBoost model
  ml/models/metrics.json   — MAE, RMSE, R², per-band breakdown, feature importance
  docs/eval_scatter.png    — Estimated vs Actual dose scatter plot
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless — no display needed
import matplotlib.pyplot as plt
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

ROOT      = Path(__file__).parent
MODEL_DIR = ROOT / "models"
DOCS_DIR  = ROOT.parent / "docs"
MODEL_DIR.mkdir(exist_ok=True)
DOCS_DIR.mkdir(exist_ok=True)

LABEL_FILE = ROOT / "dataset" / "labels.csv"
FEATURE_NAMES = ["L", "a", "b", "darkness", "rel_dark", "patch_r", "patch_g", "patch_b"]


# ── Risk band helpers ─────────────────────────────────────────────────────────
def risk_band(dose: float) -> str:
    if dose < 1.0:   return "fresh"
    if dose < 5.0:   return "low"
    if dose < 20.0:  return "medium"
    if dose < 50.0:  return "high"
    return "very_high"


# ── Data loading ──────────────────────────────────────────────────────────────
def load_from_csv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Load image-derived features from generate_dataset.py output."""
    X_rows, y_rows = [], []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # Skip bad-quality images — we train only on clean images
            if row.get("quality_status") != "pass":
                continue
            X_rows.append([float(row[k]) for k in FEATURE_NAMES])
            y_rows.append(float(row["dose_ppm_h"]))
    print(f"Loaded {len(X_rows)} clean samples from {path}")
    return np.array(X_rows, dtype=np.float32), np.array(y_rows, dtype=np.float32)


def synthesize_fallback(n: int = 4000, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Generate numeric feature vectors without images (fallback)."""
    print(f"Generating {n} synthetic feature vectors (fallback — run generate_dataset.py for image-based training)")
    rng = np.random.default_rng(seed)
    rel_dark = rng.beta(1.4, 1.8, size=n)
    darkness = np.clip(rel_dark + rng.normal(0, 0.03, n), 0, 1)
    L = 92 - rel_dark * 78 + rng.normal(0, 1.5, n)
    a = 4  + rel_dark * 18 + rng.normal(0, 1.2, n)
    b = 8  + rel_dark * 22 + rng.normal(0, 1.5, n)
    patch_r = (1 - rel_dark) * 230 + rel_dark * 25 + rng.normal(0, 6, n)
    patch_g = (1 - rel_dark) * 220 + rel_dark * 22 + rng.normal(0, 6, n)
    patch_b = (1 - rel_dark) * 205 + rel_dark * 18 + rng.normal(0, 6, n)
    X = np.column_stack([L, a, b, darkness, rel_dark, patch_r, patch_g, patch_b]).astype(np.float32)
    y = np.minimum(50.0, (np.exp(np.clip(rel_dark, 0, 1) * 3.6) - 1.0) * 3.4) + rng.normal(0, 0.15, n)
    y = np.clip(y, 0, 50).astype(np.float32)
    return X, y


# ── Scatter plot ──────────────────────────────────────────────────────────────
BAND_PALETTE = {
    "fresh":     "#f4efe6",
    "low":       "#c9a227",
    "medium":    "#b07d10",
    "high":      "#6b7a32",
    "very_high": "#4a2018",
}

def save_scatter(y_true: np.ndarray, y_pred: np.ndarray, r2: float, rmse: float, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    fig.patch.set_facecolor("#0b0f0d")
    ax.set_facecolor("#141a17")

    # Color points by actual risk band
    colors = [BAND_PALETTE[risk_band(float(d))] for d in y_true]
    ax.scatter(y_true, y_pred, c=colors, alpha=0.55, s=14, linewidths=0)

    # Ideal diagonal
    mx = float(max(y_true.max(), y_pred.max())) * 1.05
    ax.plot([0, mx], [0, mx], color="#c9a227", linewidth=1.2, linestyle="--", alpha=0.8, label="Ideal")

    # Risk band vertical lines
    for threshold, label in [(1, "Low"), (5, "Med"), (20, "High")]:
        ax.axvline(threshold, color="#444", linewidth=0.8, linestyle=":")
        ax.text(threshold + 0.2, mx * 0.05, label, color="#888", fontsize=7)

    ax.set_xlabel("Actual dose (ppm·h)", color="#9ab0a0", fontsize=11)
    ax.set_ylabel("Predicted dose (ppm·h)", color="#9ab0a0", fontsize=11)
    ax.set_title("XGBoost Dose Model — Estimated vs Actual", color="#e8f0ea", fontsize=13, pad=12)
    ax.text(0.98, 0.05, f"R² = {r2:.4f}\nRMSE = {rmse:.4f}",
            transform=ax.transAxes, ha="right", va="bottom",
            color="#c9a227", fontsize=11,
            bbox=dict(boxstyle="round,pad=0.4", facecolor="#1c2520", edgecolor="#3a4e3f"))

    ax.tick_params(colors="#9ab0a0")
    for spine in ax.spines.values():
        spine.set_edgecolor("#243029")

    # Legend for risk bands
    from matplotlib.patches import Patch
    legend_elements = [Patch(facecolor=BAND_PALETTE[b], edgecolor="none", label=b.replace("_", " ").title())
                       for b in ["fresh", "low", "medium", "high", "very_high"]]
    ax.legend(handles=legend_elements, loc="upper left", fontsize=8,
              facecolor="#1c2520", edgecolor="#3a4e3f", labelcolor="#c8d8cc")

    plt.tight_layout()
    plt.savefig(str(path), dpi=140, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close()
    print(f"Scatter plot saved -> {path}")


# ── Per-band breakdown ────────────────────────────────────────────────────────
def per_band_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    bands = ["fresh", "low", "medium", "high", "very_high"]
    result = {}
    for band in bands:
        mask = np.array([risk_band(float(d)) == band for d in y_true])
        if mask.sum() < 2:
            continue
        mae  = float(mean_absolute_error(y_true[mask], y_pred[mask]))
        rmse = float(np.sqrt(mean_squared_error(y_true[mask], y_pred[mask])))
        result[band] = {"n": int(mask.sum()), "mae": round(mae, 4), "rmse": round(rmse, 4)}
    return result


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Load data
    if LABEL_FILE.exists():
        X, y = load_from_csv(LABEL_FILE)
    else:
        X, y = synthesize_fallback()

    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)
    print(f"Train: {len(X_train)} · Val: {len(X_val)}")

    # Train
    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.06,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=3,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )

    # Evaluate
    y_pred = np.clip(model.predict(X_val), 0, 50)
    mae  = float(mean_absolute_error(y_val, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_val, y_pred)))
    r2   = float(r2_score(y_val, y_pred))
    print(f"\nValidation — MAE: {mae:.4f}  RMSE: {rmse:.4f}  R²: {r2:.4f}")

    # Save model
    model.save_model(MODEL_DIR / "dose_xgb.json")
    print(f"Model saved -> {MODEL_DIR / 'dose_xgb.json'}")

    # Save metrics
    meta = {
        "feature_names": FEATURE_NAMES,
        "n_train": len(X_train),
        "n_val": len(X_val),
        "mae":  round(mae,  4),
        "rmse": round(rmse, 4),
        "r2":   round(r2,   4),
        "per_band": per_band_metrics(y_val, y_pred),
        "importance": {k: round(float(v), 4) for k, v in zip(FEATURE_NAMES, model.feature_importances_)},
        "note": "Phase 2 — trained on image-derived features from generate_dataset.py (or fallback). Replace with lab-calibrated pairs for production.",
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))

    # Scatter plot
    save_scatter(y_val, y_pred, r2, rmse, DOCS_DIR / "eval_scatter.png")


if __name__ == "__main__":
    main()
