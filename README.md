# TOPO-OPT 3D

Full-stack web application for 3D topology optimization using the SIMP (Solid Isotropic Material with Penalization) method.

The project combines:

- A Flask backend that builds a structured 3D hexahedral mesh, applies loads and constraints, runs topology optimization, and streams progress back to the browser.
- A single-page frontend for beam setup, mesh editing, load/constraint authoring, real-time orthographic visualization, live convergence tracking, and result review.

## Features

- Real-time beam visualizer with three orthographic views:
  - Top: X-Y
  - Front: X-Z
  - Right: Y-Z
- Point and distributed load authoring with node-snapped coordinates
- Fixed, roller, and guided boundary conditions
- Preset structural configurations
- Live optimization progress streamed from Flask over Server-Sent Events
- Convergence charts for:
  - Compliance
  - Volume fraction
  - Maximum density change
- PNG result exports for multiple density thresholds
- Dark engineering-style UI with collapsible control panel

## Project Structure

```text
project/
├── app.py
├── fem3d_numpy.py
├── simp_numpy.py
├── requirements.txt
├── static/
│   ├── main.js
│   ├── style.css
│   ├── visualizer.js
│   └── results/
└── templates/
    └── index.html
```

## How It Works

### Backend

The backend in `app.py` is responsible for:

- Serving the main page
- Returning preset configurations
- Validating mesh coordinates for frontend dropdowns
- Running the optimizer in a background thread
- Streaming iteration updates over `text/event-stream`
- Saving thresholded result images into `static/results/`

Optimization runs are processed in a worker thread and pushed through a `queue.Queue`, which allows Flask to stream iteration updates without blocking the request.

### Frontend

The frontend is a single-page interface built with plain HTML, CSS, and JavaScript:

- `main.js` manages UI state, API requests, SSE parsing, charts, presets, and results
- `visualizer.js` renders the beam, mesh, loads, and constraints as SVG projections
- `style.css` controls the application layout and visual design

### Solver Integration

The provided solver files are kept intact:

- `fem3d_numpy.py`
- `simp_numpy.py`

To preserve them, the app uses a thin wrapper class inside `app.py` that adds an iteration callback around the existing SIMP optimization loop.

## Units

There is an intentional split between UI units and solver units:

- Frontend dimensions and coordinate selectors are shown in millimeters
- Backend optimization runs in meters

The frontend converts values to meters before calling `/api/run` and `/api/validate_mesh`.

## Requirements

Install dependencies with:

```bash
python -m pip install -r requirements.txt
```

Current dependencies:

- Flask
- NumPy
- Matplotlib

## Running the App

Start the Flask server with:

```bash
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Using the App

1. Set beam dimensions and mesh density.
2. Add at least one load and one constraint.
3. Optionally tune the advanced optimization parameters.
4. Optionally load a preset.
5. Click `Run Optimization`.
6. Watch the terminal and convergence charts update live.
7. Review thresholded density images in the Results tab.

If beam dimensions or mesh counts change, existing loads and constraints are cleared to avoid invalid node selections.

## Presets Included

- Cantilever Beam
- Simply Supported Beam
- Short Block
- Michell Truss

## API

### `GET /`

Returns the main web UI.

### `GET /api/presets`

Returns the list of preset configurations.

### `POST /api/validate_mesh`

Request body:

```json
{
  "lx": 1.0,
  "ly": 0.2,
  "lz": 0.1,
  "nx": 20,
  "ny": 6,
  "nz": 4
}
```

Response:

```json
{
  "x": [0.0, 0.05, 0.1],
  "y": [0.0, 0.1, 0.2],
  "z": [0.0, 0.05, 0.1]
}
```

### `POST /api/run`

Accepts the full optimization payload and returns a streaming SSE response.

Iteration events look like:

```text
data: {"iteration":0,"compliance":1.23e5,"volume":0.2,"density_change":1.0e-2}
```

Completion event includes:

- `done`
- `density`
- `nodes`
- `elems`
- `history`
- `results`
- `summary`

### `POST /api/stop/<run_id>`

Stops an active optimization run. This endpoint exists to support the frontend Stop button.

## Load and Constraint Mapping

Frontend inputs are translated into solver operations as follows:

- Fixed face:
  - `fem.fix_face(...)`
- Roller and guided constraints:
  - `fem.fix_face_partial(...)`
- Distributed load:
  - `fem.add_distributed_load(...)`
- Point load:
  - Applied directly to the nearest node DOF from `app.py`

The point-load logic is handled in `app.py` rather than calling the provided helper directly, which avoids console encoding issues during streamed runs on Windows.

## Result Images

After a completed optimization run, the backend generates one image per density threshold and saves them under:

```text
static/results/
```

The frontend then loads these images directly by URL.

## Development Notes

- The frontend uses `fetch()` streaming instead of `EventSource` because the optimization request is a `POST`.
- The terminal pane is fixed-height and scrollable.
- The visualizer resizes with the page using a `ResizeObserver`.
- Convergence charts are rendered with Chart.js from a CDN.

## Known Limitations

- The application currently assumes structured hex meshes only.
- Stopping a run is cooperative and occurs between optimization iterations.
- Result plotting is intentionally simple and intended for quick review rather than publication-quality visualization.

## Verification

The app was smoke-tested with:

- Python compilation via `python -m py_compile`
- Flask test-client checks for:
  - `/api/presets`
  - `/api/validate_mesh`
  - `/api/run` SSE streaming

## License

Add your preferred license here if this project will be shared publicly.
