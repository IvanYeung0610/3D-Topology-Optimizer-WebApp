from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Callable

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib import cm
from matplotlib.colors import Normalize
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from fem3d_numpy import HexFEMSolver3D
from simp_numpy import SIMPOptimizer


AXIS_INDEX = {"x": 0, "y": 1, "z": 2}
FACE_TO_AXIS_POSITION = {
    "xmin": ("x", "min"),
    "xmax": ("x", "max"),
    "ymin": ("y", "min"),
    "ymax": ("y", "max"),
    "zmin": ("z", "min"),
    "zmax": ("z", "max"),
}

PRESETS = {
    "cantilever": {
        "label": "Cantilever Beam",
        "description": "Fixed at the left face with a downward distributed load at the free end.",
        "config": {
            "geometry": {"Lx": 1.0, "Ly": 0.2, "Lz": 0.1, "nx": 18, "ny": 6, "nz": 4},
            "material": {"E_mod": 2.0e11, "nu": 0.3},
            "boundary_conditions": {
                "supports": [{"mode": "face", "face": "xmin"}],
                "loads": [
                    {
                        "type": "distributed",
                        "face": "xmax",
                        "direction": "y",
                        "magnitude": -10000.0,
                    }
                ],
            },
            "optimization": {
                "initial_density": 0.35,
                "volume_fraction": 0.22,
                "penalty": 3.0,
                "filter_radius": 1.6,
                "n_iterations": 45,
                "thresholds": [0.2, 0.4, 0.6],
            },
        },
    },
    "midspan_bridge": {
        "label": "Bridge-Like Span",
        "description": "Pinned at both ends with a downward point load at midspan.",
        "config": {
            "geometry": {"Lx": 1.2, "Ly": 0.16, "Lz": 0.12, "nx": 16, "ny": 4, "nz": 4},
            "material": {"E_mod": 7.0e10, "nu": 0.29},
            "boundary_conditions": {
                "supports": [
                    {"mode": "position", "axis": "x", "position": 0.0},
                    {"mode": "position", "axis": "x", "position": 1.2},
                ],
                "loads": [
                    {
                        "type": "point",
                        "direction": "y",
                        "magnitude": -7000.0,
                        "location": {"x": 0.6, "y": 0.08, "z": 0.06},
                    }
                ],
            },
            "optimization": {
                "initial_density": 0.4,
                "volume_fraction": 0.3,
                "penalty": 3.2,
                "filter_radius": 1.8,
                "n_iterations": 40,
                "thresholds": [0.2, 0.5, 0.7],
            },
        },
    },
    "torsion_block": {
        "label": "Offset Loaded Block",
        "description": "Fixed on one side with an offset point load for a less symmetric response.",
        "config": {
            "geometry": {"Lx": 0.8, "Ly": 0.24, "Lz": 0.18, "nx": 12, "ny": 5, "nz": 4},
            "material": {"E_mod": 1.1e11, "nu": 0.28},
            "boundary_conditions": {
                "supports": [{"mode": "face", "face": "xmin"}],
                "loads": [
                    {
                        "type": "point",
                        "direction": "z",
                        "magnitude": -5000.0,
                        "location": {"x": 0.8, "y": 0.18, "z": 0.14},
                    }
                ],
            },
            "optimization": {
                "initial_density": 0.38,
                "volume_fraction": 0.28,
                "penalty": 3.0,
                "filter_radius": 1.5,
                "n_iterations": 38,
                "thresholds": [0.2, 0.4, 0.6],
            },
        },
    },
}

DEFAULT_PRESET_KEY = "cantilever"

DEFAULT_CONFIG = deepcopy(PRESETS[DEFAULT_PRESET_KEY]["config"])


def get_ui_payload() -> dict:
    return {
        "default_preset": DEFAULT_PRESET_KEY,
        "defaults": deepcopy(DEFAULT_CONFIG),
        "presets": {
            key: {
                "label": value["label"],
                "description": value["description"],
                "config": deepcopy(value["config"]),
            }
            for key, value in PRESETS.items()
        },
    }


def normalize_config(payload: dict | None) -> dict:
    payload = payload or {}
    preset_key = payload.get("preset_key") or DEFAULT_PRESET_KEY
    base = deepcopy(PRESETS.get(preset_key, PRESETS[DEFAULT_PRESET_KEY])["config"])

    for top_level in ("geometry", "material", "optimization"):
        if top_level in payload:
            base[top_level].update(payload[top_level])

    boundary_payload = payload.get("boundary_conditions", {})
    if "supports" in boundary_payload:
        base["boundary_conditions"]["supports"] = boundary_payload["supports"]
    if "loads" in boundary_payload:
        base["boundary_conditions"]["loads"] = boundary_payload["loads"]

    geometry = base["geometry"]
    optimization = base["optimization"]
    material = base["material"]

    geometry["Lx"] = max(float(geometry["Lx"]), 1e-6)
    geometry["Ly"] = max(float(geometry["Ly"]), 1e-6)
    geometry["Lz"] = max(float(geometry["Lz"]), 1e-6)
    geometry["nx"] = max(int(geometry["nx"]), 1)
    geometry["ny"] = max(int(geometry["ny"]), 1)
    geometry["nz"] = max(int(geometry["nz"]), 1)

    material["E_mod"] = max(float(material["E_mod"]), 1e-9)
    material["nu"] = min(max(float(material.get("nu", 0.3)), -0.49), 0.49)

    optimization["initial_density"] = float(np.clip(float(optimization["initial_density"]), 0.01, 1.0))
    optimization["volume_fraction"] = float(np.clip(float(optimization["volume_fraction"]), 0.01, 1.0))
    optimization["penalty"] = max(float(optimization["penalty"]), 1.0)
    optimization["filter_radius"] = max(float(optimization["filter_radius"]), 1.05)
    optimization["n_iterations"] = max(int(optimization["n_iterations"]), 1)
    optimization["thresholds"] = [
        float(np.clip(float(value), 0.0, 1.0))
        for value in optimization.get("thresholds", [0.2, 0.4, 0.6])
    ]

    supports = []
    for support in base["boundary_conditions"].get("supports", []):
        mode = support.get("mode", "face")
        if mode == "position":
            axis = support.get("axis", "x")
            span = geometry[f"L{axis}"]
            supports.append(
                {
                    "mode": "position",
                    "axis": axis,
                    "position": float(np.clip(float(support.get("position", 0.0)), 0.0, span)),
                }
            )
        else:
            supports.append({"mode": "face", "face": support.get("face", "xmin")})
    if not supports:
        supports = [{"mode": "face", "face": "xmin"}]

    loads = []
    for load in base["boundary_conditions"].get("loads", []):
        load_type = load.get("type", "distributed")
        direction = load.get("direction", "y")
        magnitude = float(load.get("magnitude", -1000.0))
        if load_type == "point":
            location = load.get("location", {})
            loads.append(
                {
                    "type": "point",
                    "direction": direction,
                    "magnitude": magnitude,
                    "location": {
                        "x": float(np.clip(float(location.get("x", geometry["Lx"])), 0.0, geometry["Lx"])),
                        "y": float(np.clip(float(location.get("y", geometry["Ly"] / 2.0)), 0.0, geometry["Ly"])),
                        "z": float(np.clip(float(location.get("z", geometry["Lz"] / 2.0)), 0.0, geometry["Lz"])),
                    },
                }
            )
        else:
            loads.append(
                {
                    "type": "distributed",
                    "face": load.get("face", "xmax"),
                    "direction": direction,
                    "magnitude": magnitude,
                }
            )
    if not loads:
        loads = [
            {
                "type": "distributed",
                "face": "xmax",
                "direction": "y",
                "magnitude": -1000.0,
            }
        ]

    base["boundary_conditions"]["supports"] = supports
    base["boundary_conditions"]["loads"] = loads
    return base


def build_solver(config: dict) -> HexFEMSolver3D:
    geometry = config["geometry"]
    material = config["material"]
    optimization = config["optimization"]
    # Compliance-based topology optimization is invariant to a uniform modulus
    # scale, so we normalize the solver stiffness for numerical robustness and
    # keep the user-provided modulus as part of the input record.
    E_mod = 1.0
    Emin = 1e-9

    fem = HexFEMSolver3D(
        E_mod=E_mod,
        nu=float(material["nu"]),
        Emin=Emin,
        penalty=float(optimization["penalty"]),
    )
    fem.set_mesh(
        Lx=float(geometry["Lx"]),
        Ly=float(geometry["Ly"]),
        Lz=float(geometry["Lz"]),
        nx=int(geometry["nx"]),
        ny=int(geometry["ny"]),
        nz=int(geometry["nz"]),
    )
    apply_boundary_conditions(fem, config)
    return fem


def apply_boundary_conditions(fem: HexFEMSolver3D, config: dict) -> None:
    geometry = config["geometry"]
    boundary_conditions = config["boundary_conditions"]

    for support in boundary_conditions.get("supports", []):
        axis, coord = resolve_support(support, geometry)
        fem.fix_face(axis=axis, coord=coord)

    for load in boundary_conditions.get("loads", []):
        direction = AXIS_INDEX[load["direction"]]
        if load["type"] == "point":
            fem.add_point_load(
                location=(
                    float(load["location"]["x"]),
                    float(load["location"]["y"]),
                    float(load["location"]["z"]),
                ),
                direction=direction,
                magnitude=float(load["magnitude"]),
            )
        else:
            axis, coord = resolve_face(load["face"], geometry)
            fem.add_distributed_load(
                axis=axis,
                coord=coord,
                direction=direction,
                total=float(load["magnitude"]),
            )


def resolve_support(support: dict, geometry: dict) -> tuple[int, float]:
    if support.get("mode") == "position":
        axis_name = support["axis"]
        return AXIS_INDEX[axis_name], float(support["position"])

    return resolve_face(support.get("face", "xmin"), geometry)


def resolve_face(face_key: str, geometry: dict) -> tuple[int, float]:
    axis_name, side = FACE_TO_AXIS_POSITION[face_key]
    coord = 0.0 if side == "min" else float(geometry[f"L{axis_name}"])
    return AXIS_INDEX[axis_name], coord


def optimize_with_logging(
    optimizer: SIMPOptimizer,
    n_iterations: int,
    logger: Callable[[dict], None] | None = None,
) -> dict:
    for iteration in range(n_iterations):
        results = optimizer.fem_solver.solve(optimizer.density)
        compliance = float(results["compliance"])
        sensitivities = results["sensitivities"]
        density_new = optimizer.update_density(sensitivities)
        density_change = float(np.max(np.abs(density_new - optimizer.density)))
        optimizer.density = density_new

        volume = float(np.sum(optimizer.density) / optimizer.n_elem)
        optimizer.history["compliance"].append(compliance)
        optimizer.history["volume"].append(volume)
        optimizer.history["density_change"].append(density_change)
        optimizer.history["iteration"].append(iteration + 1)

        if logger is not None:
            logger(
                {
                    "iteration": iteration + 1,
                    "total_iterations": n_iterations,
                    "compliance": compliance,
                    "volume": volume,
                    "density_change": density_change,
                    "message": (
                        f"Iter {iteration + 1:03d} | "
                        f"C {compliance:.6e} | "
                        f"V {volume:.4f} | "
                        f"dRho {density_change:.6e}"
                    ),
                }
            )

    return {
        "density": optimizer.density,
        "final_compliance": optimizer.history["compliance"][-1],
        "final_volume": optimizer.history["volume"][-1],
        "history": optimizer.history,
    }


def plot_3d_design(nodes, elems, density, threshold: float, title: str):
    fig = plt.figure(figsize=(14, 10))
    ax = fig.add_subplot(111, projection="3d")

    active_elems = np.where(density > threshold)[0]
    if len(active_elems) == 0:
        ax.text2D(0.5, 0.5, f"No elements above density {threshold}", transform=ax.transAxes, ha="center")
        ax.set_title(title)
        return fig

    cmap = matplotlib.colormaps["RdYlGn"]
    norm = Normalize(vmin=threshold, vmax=1.0)
    faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [0, 3, 7, 4],
        [1, 2, 6, 5],
    ]

    for elem_idx in active_elems:
        elem_nodes = elems[elem_idx]
        elem_coords = nodes[elem_nodes]
        color = cmap(norm(density[elem_idx]))
        for face in faces:
            ax.add_collection3d(
                Poly3DCollection([elem_coords[face]], facecolors=color, edgecolors="k", linewidths=0.3)
            )

    active_coords = nodes[elems[active_elems]].reshape(-1, 3)
    ax.set_xlim(active_coords[:, 0].min(), active_coords[:, 0].max())
    ax.set_ylim(active_coords[:, 1].min(), active_coords[:, 1].max())
    ax.set_zlim(active_coords[:, 2].min(), active_coords[:, 2].max())
    aspect = np.ptp(active_coords, axis=0)
    aspect = np.where(aspect == 0, 1.0, aspect)
    ax.set_box_aspect(aspect.tolist())
    ax.set_xlabel("X")
    ax.set_ylabel("Y")
    ax.set_zlabel("Z")
    ax.set_title(title)

    sm = cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    colorbar = plt.colorbar(sm, ax=ax, pad=0.08, shrink=0.8)
    colorbar.set_label("Density")
    plt.tight_layout()
    return fig


def save_result_artifacts(output_dir: Path, fem: HexFEMSolver3D, result: dict, volume_fraction: float, thresholds: list[float]) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    history = result["history"]
    density = result["density"]

    artifacts = {"images": {}}

    fig, axes = plt.subplots(1, 3, figsize=(16, 4))
    axes[0].semilogy(history["iteration"], history["compliance"], "b-o", linewidth=2, markersize=3)
    axes[0].set_title("Compliance")
    axes[0].set_xlabel("Iteration")
    axes[0].set_ylabel("Compliance")
    axes[0].grid(True, alpha=0.3)

    axes[1].plot(history["iteration"], history["volume"], "g-o", linewidth=2, markersize=3)
    axes[1].axhline(volume_fraction, color="r", linestyle="--", linewidth=2)
    axes[1].set_title("Volume Fraction")
    axes[1].set_xlabel("Iteration")
    axes[1].set_ylabel("Volume")
    axes[1].grid(True, alpha=0.3)

    axes[2].semilogy(history["iteration"], history["density_change"], "r-o", linewidth=2, markersize=3)
    axes[2].set_title("Density Change")
    axes[2].set_xlabel("Iteration")
    axes[2].set_ylabel("Max Delta")
    axes[2].grid(True, alpha=0.3)
    plt.tight_layout()
    convergence_path = output_dir / "convergence.png"
    plt.savefig(convergence_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    artifacts["images"]["convergence"] = convergence_path.name

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.hist(density, bins=30, color="#2f7ed8", edgecolor="black", alpha=0.8)
    ax.axvline(np.mean(density), color="#d1495b", linestyle="--", linewidth=2)
    ax.axvline(volume_fraction, color="#2a9d8f", linestyle="--", linewidth=2)
    ax.set_xlabel("Density")
    ax.set_ylabel("Element Count")
    ax.set_title("Density Histogram")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    histogram_path = output_dir / "density_histogram.png"
    plt.savefig(histogram_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    artifacts["images"]["density_histogram"] = histogram_path.name

    threshold_files = []
    for threshold in thresholds:
        fig = plot_3d_design(
            fem.nodes_np,
            fem.elems_t,
            density,
            threshold=float(threshold),
            title=f"Optimized Structure (density > {threshold})",
        )
        filename = f"threshold_{threshold:.2f}.png".replace(".", "_", 1)
        plt.savefig(output_dir / filename, dpi=150, bbox_inches="tight")
        plt.close(fig)
        threshold_files.append({"threshold": float(threshold), "file": filename})

    artifacts["images"]["thresholds"] = threshold_files
    return artifacts


def run_topology_optimization(
    config: dict,
    output_dir: str | Path,
    logger: Callable[[dict], None] | None = None,
) -> dict:
    config = normalize_config(config)
    output_path = Path(output_dir)
    fem = build_solver(config)
    optimization = config["optimization"]
    optimizer = SIMPOptimizer(
        fem_solver=fem,
        initial_density=float(optimization["initial_density"]),
        volume_fraction=float(optimization["volume_fraction"]),
        penalty=float(optimization["penalty"]),
        filter_radius=float(optimization["filter_radius"]),
    )

    result = optimize_with_logging(
        optimizer=optimizer,
        n_iterations=int(optimization["n_iterations"]),
        logger=logger,
    )

    artifacts = save_result_artifacts(
        output_dir=output_path,
        fem=fem,
        result=result,
        volume_fraction=float(optimization["volume_fraction"]),
        thresholds=optimization["thresholds"],
    )

    density = result["density"]
    history = result["history"]
    improvement = 0.0
    if history["compliance"] and history["compliance"][0] != 0:
        improvement = (1.0 - result["final_compliance"] / history["compliance"][0]) * 100.0

    summary = {
        "config": json.loads(json.dumps(config)),
        "mesh": {"nodes": int(fem.nodes_np.shape[0]), "elements": int(fem.n_elems)},
        "final_compliance": float(result["final_compliance"]),
        "final_volume": float(result["final_volume"]),
        "compliance_improvement_percent": float(improvement),
        "density": {
            "min": float(np.min(density)),
            "max": float(np.max(density)),
            "mean": float(np.mean(density)),
            "std": float(np.std(density)),
        },
        "history": {key: [float(v) for v in values] for key, values in history.items()},
        "artifacts": artifacts,
    }

    with (output_path / "summary.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)

    return summary
