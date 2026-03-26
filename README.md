# 3D Topology Optimizer Web App

This project now includes a Flask-based web interface for the existing 3D topology optimization solver.

## Features

- preset examples that run successfully without manual tuning
- editable geometry, mesh, supports, loads, and optimization settings
- support planes defined either by face selection or explicit position
- live iteration output while the optimization is running
- saved convergence plots, density histograms, and 3D threshold views

## Run locally

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Start the Flask app:

```bash
python app.py
```

3. Open:

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## Key files

- `app.py`: Flask routes and run-state management
- `optimizer_service.py`: reusable optimization pipeline, presets, and artifact generation
- `templates/index.html`: page structure
- `static/styles.css`: styling
- `static/app.js`: frontend workflow and live polling
- `run_optimization_numpy.py`: CLI entrypoint using the shared backend logic

## Notes

- Filter radius is interpreted in element widths, not raw geometry units, and the app enforces a minimum effective value so it stays meaningful across mesh sizes.
- The solver internally normalizes the stiffness scale so different valid Young's modulus inputs remain numerically stable while preserving the topology workflow.
