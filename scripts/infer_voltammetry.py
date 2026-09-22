#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from scipy.stats import gaussian_kde

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "inference_bundle" / "models"

# Global aggregation strategy
ENSEMBLE_METHOD = "kde_mode"


def parse_trace(path: Path):
    """Parses raw voltammetry trace files [t, v, i] or [v, i]."""
    rows = []
    with path.open("r", encoding="utf-8-sig") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.lower().startswith(("t,", "time,", "v,", "voltage,")):
                continue
            pieces = [p.strip() for p in (line.split(",") if "," in line else line.split())]
            if len(pieces) >= 2:
                try:
                    if len(pieces) == 2:
                        rows.append([0.0, float(pieces[0]), float(pieces[1])])
                    else:
                        rows.append([float(pieces[0]), float(pieces[1]), float(pieces[2])])
                except ValueError:
                    continue

    arr = np.asarray(rows, dtype=np.float32)
    if arr.size == 0:
        raise ValueError("The uploaded file contained no valid numeric data points.")

    if np.max(np.abs(arr[:, 1])) > 50.0:
        arr[:, 1] /= 1000.0

    return arr


def get_network(arch_name, input_size):
    """Recreates the model architecture by name."""
    if arch_name == "SmallBN-128-64-1":
        return nn.Sequential(
            nn.Linear(input_size, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )
    elif arch_name == "LargeBN-1024-512-1":
        return nn.Sequential(
            nn.Linear(input_size, 1024),
            nn.BatchNorm1d(1024),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(1024, 512),
            nn.ReLU(),
            nn.Linear(512, 1),
        )
    elif arch_name == "Wide-768-256-1":
        return nn.Sequential(
            nn.Linear(input_size, 768),
            nn.ReLU(),
            nn.Linear(768, 256),
            nn.ReLU(),
            nn.Linear(256, 1),
        )
    raise ValueError(f"Unknown architecture: {arch_name}")


def compute_kde_mode(values: list[float], num_points: int = 1000) -> float:
    """Finds the density peak (mode) of 1D fold predictions using Kernel Density Estimation.

    Fits a continuous probability density function over all ensemble predictions
    and evaluates it across a fine grid to identify the exact consensus peak.
    """
    arr = np.asarray(values, dtype=np.float64)

    if len(arr) == 0:
        return 0.0

    # Fallback to mean if sample size is too small or all predictions are identical
    if len(arr) <= 2 or np.all(arr == arr[0]) or np.std(arr) < 1e-8:
        return float(np.mean(arr))

    try:
        # Fit Gaussian Kernel Density Estimator
        kde = gaussian_kde(arr)

        # Evaluate density over 1,000 evenly spaced evaluation points across the span
        grid = np.linspace(arr.min(), arr.max(), num_points)
        density = kde(grid)

        # Return the value at the peak of the probability density function
        peak_idx = np.argmax(density)
        return float(grid[peak_idx])
    except Exception:
        # Robust fallback to median in case matrix inversion fails inside KDE
        return float(np.median(arr))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: infer_voltammetry.py ")

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # 1. Parse raw trace and sort by voltage
    raw_trace = parse_trace(input_path)
    v_raw, i_raw = raw_trace[:, 1], raw_trace[:, 2]

    sort_idx = np.argsort(v_raw)
    v_raw, i_raw = v_raw[sort_idx], i_raw[sort_idx]

    results = {
        "filename": input_path.name,
        "status": "processed",
        "aggregation_method": ENSEMBLE_METHOD,
        "targets": {},
    }

    model_files = list(MODELS_DIR.glob("*.pt"))
    if not model_files:
        raise FileNotFoundError(f"No trained .pt model bundles found in {MODELS_DIR}")

    # 2. Process each target ensemble model
    for model_path in model_files:
        bundle = torch.load(model_path, map_location="cpu", weights_only=False)
        meta = bundle["metadata"]
        scalers = bundle["scalers"]

        target_key = meta["target"]
        display_name = meta.get("display_name", target_key)
        arch_name = meta["architecture"]
        vmin, vmax = meta["window"]
        input_size = meta["input_size"]
        unit = meta.get("output_unit", "")

        # 3. Create target grid corresponding to model's voltage window
        target_v_grid = np.linspace(vmin, vmax, input_size)

        # 4. Interpolate current values onto target grid
        i_interp = np.interp(target_v_grid, v_raw, i_raw, left=i_raw[0], right=i_raw[-1]).astype(np.float32)

        # 5. Apply saved StandardScaler statistics
        x_mean = np.array(scalers["x_mean"], dtype=np.float32)
        x_scale = np.array(scalers["x_scale"], dtype=np.float32)
        x_norm = (i_interp - x_mean) / x_scale

        x_tensor = torch.from_numpy(x_norm).unsqueeze(0)

        # 6. Collect predictions across all LOCO fold models
        fold_state_dicts = bundle.get("fold_state_dicts", [])

        if not fold_state_dicts and "model_state_dict" in bundle:
            fold_state_dicts = [bundle["model_state_dict"]]

        model = get_network(arch_name, input_size)
        fold_predictions_z = []

        for state_dict in fold_state_dicts:
            model.load_state_dict(state_dict)
            model.eval()
            with torch.no_grad():
                pred_z = model(x_tensor).item()
                fold_predictions_z.append(pred_z)

        # 7. Denormalize individual fold predictions to physical units
        fold_preds_physical = [
            (pz * scalers["y_scale"]) + scalers["y_mean"] for pz in fold_predictions_z
        ]

        # 8. Aggregate predictions using KDE Peak / Mode consensus
        pred_final = compute_kde_mode(fold_preds_physical)

        # 9. Calculate voltage overlap coverage (confidence metric)
        v_min_trace, v_max_trace = np.min(v_raw), np.max(v_raw)
        overlap_min = max(vmin, v_min_trace)
        overlap_max = min(vmax, v_max_trace)
        coverage = max(0.0, (overlap_max - overlap_min) / (vmax - vmin))

        loco = meta.get("loco_metrics", {})

        results["targets"][target_key] = {
            "name": display_name,
            "target_key": target_key,
            "unit": unit,
            "value": round(float(pred_final), 4),
            "window": [vmin, vmax],
            "confidence": round(float(np.clip(coverage * 100.0, 0.0, 100.0)), 1),
            "model_loco_r2": round(loco.get("r2", 0.0), 4) if "r2" in loco else None,
            "num_ensemble_models": len(fold_state_dicts),
        }

    # Print summary directly to stderr for terminal visibility
    print("\n==================================================", file=sys.stderr)
    print(f" Voltammetry Prediction Summary [{ENSEMBLE_METHOD.upper()} ENSEMBLE]", file=sys.stderr)
    print(f" File: {input_path.name}", file=sys.stderr)
    print("==================================================", file=sys.stderr)
    for target_data in results["targets"].values():
        print(
            f"  • {target_data['name']:<30} : {target_data['value']:>9.4f} {target_data['unit']:<4} "
            f"(Window: {target_data['window'][0]:.1f}V-{target_data['window'][1]:.1f}V | "
            f"Models: {target_data['num_ensemble_models']})",
            file=sys.stderr,
        )
    print("==================================================\n", file=sys.stderr)

    # Output JSON to stdout for Web App consumption
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": "failed"}), file=sys.stderr)
        sys.exit(1)