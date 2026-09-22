# Coffee voltammetry inference export bundle

This folder is organized for export to a web app or deployment environment.

## Contents

- `models/`: trained PyTorch checkpoints for each target
- `best_params/`: saved BEST_*.pkl files with best voltage-window + architecture metadata
- `manifest.json`: concise summary of each model bundle

## Targets in this bundle

- Caffeine: `HPLC_Caff__SmallBN-128-64-1__V0.40-1.40.pth`
- CGA: `HPLC_CGA__LargeBN-1024-512-1__V0.00-1.20.pth`
- TDS: `TDS__Wide-768-256-1__V0.20-1.20.pth`

## Required input format

Upload a text file with a raw voltammetry trace in the form:

```
t,v,i
46.000,0.00,0.123
46.050,0.01,0.130
...
```

The app should use the saved model metadata to slice the trace to the target voltage window, standardize using x_mean/x_std, run the model, then inverse-transform using y_mean/y_std to recover ppm.

## Source repo

- `src/thesis_plots/predict_folder_targets.py`
- `src/thesis_plots/plot_best_models.py`
- `src/nn/nn_model_window_search.py`
