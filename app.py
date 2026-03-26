from __future__ import annotations

import threading
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

from optimizer_service import get_ui_payload, normalize_config, run_topology_optimization


BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)

app = Flask(__name__)


@dataclass
class RunState:
    run_id: str
    status: str = "queued"
    progress: dict = field(default_factory=lambda: {"iteration": 0, "total_iterations": 0})
    logs: list[str] = field(default_factory=list)
    result: dict | None = None
    error: str | None = None


RUNS: dict[str, RunState] = {}
RUN_LOCK = threading.Lock()


def create_run(config: dict) -> RunState:
    run_id = uuid.uuid4().hex[:10]
    state = RunState(run_id=run_id, status="running")
    with RUN_LOCK:
        RUNS[run_id] = state

    thread = threading.Thread(target=execute_run, args=(state, config), daemon=True)
    thread.start()
    return state


def execute_run(state: RunState, config: dict) -> None:
    def on_iteration(event: dict) -> None:
        with RUN_LOCK:
            state.progress = {
                "iteration": event["iteration"],
                "total_iterations": event["total_iterations"],
                "compliance": event["compliance"],
                "volume": event["volume"],
                "density_change": event["density_change"],
            }
            state.logs.append(event["message"])

    try:
        output_dir = RUNS_DIR / state.run_id
        result = run_topology_optimization(config, output_dir=output_dir, logger=on_iteration)
        result["run_id"] = state.run_id
        with RUN_LOCK:
            state.status = "completed"
            state.result = result
    except Exception as exc:  # pragma: no cover
        with RUN_LOCK:
            state.status = "failed"
            state.error = f"{exc}\n\n{traceback.format_exc()}"


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/ui-config")
def ui_config():
    return jsonify(get_ui_payload())


@app.post("/api/runs")
def start_run():
    payload = request.get_json(silent=True) or {}
    config = normalize_config(payload)
    state = create_run(config)
    return jsonify({"run_id": state.run_id, "status": state.status}), 202


@app.get("/api/runs/<run_id>")
def get_run(run_id: str):
    with RUN_LOCK:
        state = RUNS.get(run_id)
        if state is None:
            return jsonify({"error": "Run not found"}), 404

        return jsonify(
            {
                "run_id": state.run_id,
                "status": state.status,
                "progress": state.progress,
                "logs": state.logs,
                "result": state.result,
                "error": state.error,
            }
        )


@app.get("/runs/<run_id>/<path:filename>")
def run_artifact(run_id: str, filename: str):
    return send_from_directory(RUNS_DIR / run_id, filename)


def main() -> None:
    app.run(host="127.0.0.1", port=8000, debug=False, threaded=True)


if __name__ == "__main__":
    main()
