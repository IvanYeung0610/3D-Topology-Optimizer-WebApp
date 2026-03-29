import json
import queue
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

import matplotlib
matplotlib.use("Agg")

import numpy as np
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from matplotlib import cm, pyplot as plt
from matplotlib.colors import Normalize
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from fem3d_numpy import HexFEMSolver3D
from simp_numpy import SIMPOptimizer


BASE_DIR = Path(__file__).resolve().parent
RESULTS_DIR = BASE_DIR / "static" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)


PRESETS = [
    {
        "name": "Cantilever Beam",
        "dimensions": {"lx": 1.0, "ly": 0.2, "lz": 0.1},
        "mesh": {"nx": 20, "ny": 6, "nz": 4},
        "advanced": {
            "E_mod": 200e9,
            "nu": 0.3,
            "iterations": 100,
            "volume_fraction": 0.2,
            "initial_density": 0.2,
            "penalty": 3.0,
            "filter_radius": 0.02,
            "thresholds": [0.1, 0.3, 0.5],
        },
        "loads": [
            {
                "type": "distributed",
                "plane": "YZ",
                "planeCoord": 1.0,
                "direction": "-Z",
                "magnitude": 2500.0,
            }
        ],
        "constraints": [{"type": "fixed", "plane": "YZ", "planeCoord": 0.0}],
    },
    {
        "name": "Simply Supported Beam",
        "dimensions": {"lx": 1.0, "ly": 0.2, "lz": 0.1},
        "mesh": {"nx": 20, "ny": 6, "nz": 4},
        "advanced": {
            "E_mod": 200e9,
            "nu": 0.3,
            "iterations": 100,
            "volume_fraction": 0.25,
            "initial_density": 0.25,
            "penalty": 3.0,
            "filter_radius": 0.02,
            "thresholds": [0.1, 0.3, 0.5],
        },
        "loads": [
            {
                "type": "distributed",
                "plane": "XZ",
                "planeCoord": 0.1,
                "direction": "-Z",
                "magnitude": 5000.0,
            }
        ],
        "constraints": [
            {"type": "fixed", "plane": "YZ", "planeCoord": 0.0},
            {
                "type": "roller",
                "plane": "YZ",
                "planeCoord": 1.0,
                "fixedDOF": "Z",
            },
        ],
    },
    {
        "name": "Short Block",
        "dimensions": {"lx": 0.3, "ly": 0.3, "lz": 0.3},
        "mesh": {"nx": 6, "ny": 6, "nz": 6},
        "advanced": {
            "E_mod": 200e9,
            "nu": 0.3,
            "iterations": 80,
            "volume_fraction": 0.35,
            "initial_density": 0.35,
            "penalty": 3.0,
            "filter_radius": 0.05,
            "thresholds": [0.1, 0.3, 0.5],
        },
        "loads": [
            {
                "type": "point",
                "px": 0.15,
                "py": 0.15,
                "pz": 0.3,
                "direction": "-Z",
                "magnitude": 10000.0,
            }
        ],
        "constraints": [{"type": "fixed", "plane": "XY", "planeCoord": 0.0}],
    },
    {
        "name": "Michell Truss",
        "dimensions": {"lx": 2.0, "ly": 0.5, "lz": 0.2},
        "mesh": {"nx": 20, "ny": 8, "nz": 4},
        "advanced": {
            "E_mod": 200e9,
            "nu": 0.3,
            "iterations": 120,
            "volume_fraction": 0.18,
            "initial_density": 0.18,
            "penalty": 3.0,
            "filter_radius": 0.04,
            "thresholds": [0.1, 0.3, 0.5],
        },
        "loads": [
            {
                "type": "distributed",
                "plane": "XZ",
                "planeCoord": 0.25,
                "direction": "-Z",
                "magnitude": 8000.0,
            }
        ],
        "constraints": [
            {"type": "fixed", "plane": "YZ", "planeCoord": 0.0},
            {"type": "fixed", "plane": "YZ", "planeCoord": 2.0},
        ],
    },
]


RUNS = {}
RUNS_LOCK = threading.Lock()


@dataclass
class RunState:
    event_queue: queue.Queue
    stop_event: threading.Event
    finished_event: threading.Event
    thread: threading.Thread


class CallbackSIMPOptimizer(SIMPOptimizer):
    def optimize(self, n_iterations=50, verbose=True, on_iteration=None, stop_event=None):
        for iteration in range(n_iterations):
            if stop_event is not None and stop_event.is_set():
                break

            results = self.fem_solver.solve(self.density)
            compliance = float(results["compliance"])
            sensitivities = results["sensitivities"]

            density_new = self.update_density(sensitivities)
            density_change = float(np.max(np.abs(density_new - self.density)))
            self.density = density_new

            volume = float(np.sum(self.density) / self.n_elem)
            self.history["compliance"].append(compliance)
            self.history["volume"].append(volume)
            self.history["density_change"].append(density_change)
            self.history["iteration"].append(iteration)

            if on_iteration is not None:
                on_iteration(iteration, compliance, volume, density_change)

            if verbose:
                print(
                    f"  Iter {iteration:02d} | C: {compliance:.6e} | "
                    f"V: {volume:.4f} | ΔρMax: {density_change:.6e}"
                )

        return {
            "density": self.density,
            "final_compliance": self.history["compliance"][-1] if self.history["compliance"] else None,
            "final_volume": self.history["volume"][-1] if self.history["volume"] else None,
            "history": self.history,
            "stopped": bool(stop_event and stop_event.is_set()),
        }


def direction_to_index_and_sign(direction):
    direction = direction.upper()
    sign = -1.0 if direction.startswith("-") else 1.0
    axis = direction[-1]
    axis_index = {"X": 0, "Y": 1, "Z": 2}[axis]
    return axis_index, sign


def plane_to_axis(plane):
    return {"YZ": 0, "XZ": 1, "XY": 2}[plane.upper()]


def ensure_float_list(values):
    return [float(v) for v in values]


def sanitize_result_payload(payload):
    return json.loads(json.dumps(payload))


def make_mesh_coordinates(lx, ly, lz, nx, ny, nz):
    return {
        "x": ensure_float_list(np.linspace(0.0, lx, nx + 1)),
        "y": ensure_float_list(np.linspace(0.0, ly, ny + 1)),
        "z": ensure_float_list(np.linspace(0.0, lz, nz + 1)),
    }


def apply_constraints(fem, constraints):
    for constraint in constraints:
        plane = constraint["plane"].upper()
        coord = float(constraint["planeCoord"])
        axis = plane_to_axis(plane)
        constraint_type = constraint["type"].lower()

        if constraint_type == "fixed":
            fem.fix_face(axis=axis, coord=coord)
            continue

        if constraint_type == "roller":
            dof_index = {"X": 0, "Y": 1, "Z": 2}[constraint["fixedDOF"].upper()]
            fem.fix_face_partial(axis=axis, coord=coord, dof_directions=[dof_index])
            continue

        if constraint_type == "guided":
            free_dof = constraint["freeDOF"].upper()
            dof_indices = [idx for name, idx in {"X": 0, "Y": 1, "Z": 2}.items() if name != free_dof]
            fem.fix_face_partial(axis=axis, coord=coord, dof_directions=dof_indices)
            continue

        raise ValueError(f"Unsupported constraint type: {constraint_type}")


def apply_loads(fem, loads):
    for load in loads:
        direction_index, direction_sign = direction_to_index_and_sign(load["direction"])
        magnitude = float(load["magnitude"]) * direction_sign
        load_type = load["type"].lower()

        if load_type == "distributed":
            fem.add_distributed_load(
                axis=plane_to_axis(load["plane"]),
                coord=float(load["planeCoord"]),
                direction=direction_index,
                total=magnitude,
            )
            continue

        if load_type == "point":
            location = np.array(
                [float(load["px"]), float(load["py"]), float(load["pz"])],
                dtype=float,
            )
            squared_distances = np.sum((fem.nodes_np - location) ** 2, axis=1)
            node_id = int(np.argmin(squared_distances))
            fem.F_global[node_id * 3 + direction_index] += magnitude
            continue

        raise ValueError(f"Unsupported load type: {load_type}")


def plot_density_threshold(nodes, elems, density, threshold, filename):
    fig = plt.figure(figsize=(10, 7))
    ax = fig.add_subplot(111, projection="3d")

    active = np.where(density > threshold)[0]
    has_data = len(active) > 0

    if has_data:
        cmap = matplotlib.colormaps["RdYlGn"]
        norm = Normalize(vmin=threshold, vmax=1.0)

        for elem_idx in active:
            elem_nodes = elems[elem_idx]
            elem_coords = nodes[elem_nodes]
            color = cmap(norm(density[elem_idx]))
            faces = [
                [0, 1, 2, 3],
                [4, 5, 6, 7],
                [0, 1, 5, 4],
                [2, 3, 7, 6],
                [0, 3, 7, 4],
                [1, 2, 6, 5],
            ]
            for face in faces:
                ax.add_collection3d(
                    Poly3DCollection(
                        [elem_coords[face]],
                        facecolors=color,
                        edgecolors="#0f1923",
                        linewidths=0.35,
                    )
                )

        coords = nodes[elems[active]].reshape(-1, 3)
        ax.set_xlim(coords[:, 0].min(), coords[:, 0].max())
        ax.set_ylim(coords[:, 1].min(), coords[:, 1].max())
        ax.set_zlim(coords[:, 2].min(), coords[:, 2].max())
        ax.set_box_aspect(
            [
                max(np.ptp(coords[:, 0]), 1e-9),
                max(np.ptp(coords[:, 1]), 1e-9),
                max(np.ptp(coords[:, 2]), 1e-9),
            ]
        )
        sm = cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cbar = plt.colorbar(sm, ax=ax, pad=0.08, shrink=0.8)
        cbar.set_label("Density")
    else:
        ax.text2D(
            0.5,
            0.5,
            f"No elements with ρ > {threshold}",
            transform=ax.transAxes,
            ha="center",
            va="center",
            fontsize=14,
            color="#55657a",
        )

    ax.set_title(f"Topology Result (ρ > {threshold})")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_zlabel("Z (m)")
    ax.grid(False)

    fig.tight_layout()
    fig.savefig(filename, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return has_data


def build_result_images(run_id, fem, density, thresholds):
    images = []
    for threshold in thresholds:
        threshold_token = f"{float(threshold):.2f}".replace(".", "_")
        filename = f"{run_id}_rho_{threshold_token}.png"
        filepath = RESULTS_DIR / filename
        has_data = plot_density_threshold(
            fem.nodes_np,
            fem.elems_t,
            density,
            float(threshold),
            filepath,
        )
        images.append(
            {
                "threshold": float(threshold),
                "url": f"/static/results/{filename}",
                "has_data": has_data,
            }
        )
    return images


def optimization_worker(run_id, payload, event_queue, stop_event, finished_event):
    try:
        dimensions = payload["dimensions"]
        mesh = payload["mesh"]
        advanced = payload["advanced"]
        loads = payload["loads"]
        constraints = payload["constraints"]

        fem = HexFEMSolver3D(
            E_mod=float(advanced["E_mod"]),
            nu=float(advanced["nu"]),
            penalty=float(advanced["penalty"]),
        )
        fem.set_mesh(
            Lx=float(dimensions["lx"]),
            Ly=float(dimensions["ly"]),
            Lz=float(dimensions["lz"]),
            nx=int(mesh["nx"]),
            ny=int(mesh["ny"]),
            nz=int(mesh["nz"]),
        )

        apply_constraints(fem, constraints)
        apply_loads(fem, loads)

        optimizer = CallbackSIMPOptimizer(
            fem_solver=fem,
            initial_density=float(advanced["initial_density"]),
            volume_fraction=float(advanced["volume_fraction"]),
            penalty=float(advanced["penalty"]),
            filter_radius=float(advanced["filter_radius"]),
        )

        def on_iteration(iteration, compliance, volume, density_change):
            event_queue.put(
                {
                    "iteration": int(iteration),
                    "compliance": float(compliance),
                    "volume": float(volume),
                    "density_change": float(density_change),
                }
            )

        result = optimizer.optimize(
            n_iterations=int(advanced["iterations"]),
            verbose=False,
            on_iteration=on_iteration,
            stop_event=stop_event,
        )

        if stop_event.is_set():
            event_queue.put({"stopped": True})
            return

        density = np.asarray(result["density"], dtype=float)
        thresholds = advanced.get("thresholds", [0.1, 0.3, 0.5])
        images = build_result_images(run_id, fem, density, thresholds)

        history = {
            key: ensure_float_list(values) if key != "iteration" else [int(v) for v in values]
            for key, values in result["history"].items()
        }
        initial_compliance = history["compliance"][0]
        final_compliance = history["compliance"][-1]
        improvement_pct = (1.0 - final_compliance / initial_compliance) * 100.0 if initial_compliance else 0.0

        event_queue.put(
            sanitize_result_payload(
                {
                    "done": True,
                    "density": ensure_float_list(density),
                    "nodes": fem.nodes_np.tolist(),
                    "elems": fem.elems_t.tolist(),
                    "history": history,
                    "results": {"images": images},
                    "summary": {
                        "initial_compliance": initial_compliance,
                        "final_compliance": final_compliance,
                        "improvement_pct": improvement_pct,
                        "final_volume_fraction": history["volume"][-1],
                    },
                }
            )
        )
    except Exception as exc:
        event_queue.put({"error": str(exc)})
    finally:
        finished_event.set()
        with RUNS_LOCK:
            RUNS.pop(run_id, None)


def event_stream(run_id, run_state):
    try:
        while not run_state.finished_event.is_set() or not run_state.event_queue.empty():
            try:
                message = run_state.event_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            yield f"data: {json.dumps(message)}\n\n"
    finally:
        if not run_state.stop_event.is_set() and run_state.thread.is_alive():
            # Client disconnected unexpectedly; let the background worker keep going.
            pass


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/presets")
def api_presets():
    return jsonify(PRESETS)


@app.post("/api/validate_mesh")
def api_validate_mesh():
    data = request.get_json(force=True)
    coords = make_mesh_coordinates(
        float(data["lx"]),
        float(data["ly"]),
        float(data["lz"]),
        int(data["nx"]),
        int(data["ny"]),
        int(data["nz"]),
    )
    return jsonify(coords)


@app.post("/api/run")
def api_run():
    payload = request.get_json(force=True)
    run_id = uuid.uuid4().hex
    event_queue = queue.Queue()
    stop_event = threading.Event()
    finished_event = threading.Event()
    thread = threading.Thread(
        target=optimization_worker,
        args=(run_id, payload, event_queue, stop_event, finished_event),
        daemon=True,
    )
    run_state = RunState(
        event_queue=event_queue,
        stop_event=stop_event,
        finished_event=finished_event,
        thread=thread,
    )
    with RUNS_LOCK:
        RUNS[run_id] = run_state
    thread.start()

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "X-Run-Id": run_id,
    }
    return Response(
        stream_with_context(event_stream(run_id, run_state)),
        mimetype="text/event-stream",
        headers=headers,
    )


@app.post("/api/stop/<run_id>")
def api_stop(run_id):
    with RUNS_LOCK:
        run_state = RUNS.get(run_id)
    if run_state is None:
        return jsonify({"ok": False, "message": "Run not found"}), 404

    run_state.stop_event.set()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
