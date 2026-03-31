import {
  BeamVisualizer,
  describeConstraint,
  describeLoad,
  planeCoordinateLabel,
  LOAD_PALETTE,
  CONSTRAINT_PALETTE,
} from "./visualizer.js";

const MM_PER_M = 1000;

const state = {
  dimensions: { lx: 1000, ly: 200, lz: 100 },
  mesh: { nx: 20, ny: 6, nz: 4 },
  viewMode: "all",
  advanced: {
    E_mod: 200e9,
    nu: 0.3,
    iterations: 100,
    volume_fraction: 0.2,
    initial_density: 0.2,
    penalty: 3.0,
    filter_radius: 0.02,
    thresholds: [0.1, 0.3, 0.5],
  },
  loads: [],
  constraints: [],
};

const meshCoordinates = { x: [], y: [], z: [] };
const presets = [];

let loadId = 0;
let loadColorIndex = 0;
let constraintId = 0;
let constraintColorIndex = 0;
let geometryWarningTimer = null;
let geometryFadeTimer = null;
let meshRequestVersion = 0;
let visualizer = null;
let complianceChart = null;
let volumeChart = null;
let densityChangeChart = null;
let activeRun = null;

const elements = {
  dimX: document.getElementById("dimX"),
  dimY: document.getElementById("dimY"),
  dimZ: document.getElementById("dimZ"),
  meshX: document.getElementById("meshX"),
  meshY: document.getElementById("meshY"),
  meshZ: document.getElementById("meshZ"),
  meshInfo: document.getElementById("meshInfo"),
  loadType: document.getElementById("loadType"),
  loadDirection: document.getElementById("loadDirection"),
  loadMagnitude: document.getElementById("loadMagnitude"),
  pointLoadFields: document.getElementById("pointLoadFields"),
  distributedLoadFields: document.getElementById("distributedLoadFields"),
  loadPointX: document.getElementById("loadPointX"),
  loadPointY: document.getElementById("loadPointY"),
  loadPointZ: document.getElementById("loadPointZ"),
  loadPlane: document.getElementById("loadPlane"),
  loadPlaneCoord: document.getElementById("loadPlaneCoord"),
  loadPlaneCoordLabel: document.getElementById("loadPlaneCoordLabel"),
  loadsList: document.getElementById("loadsList"),
  constraintType: document.getElementById("constraintType"),
  constraintFixedDof: document.getElementById("constraintFixedDof"),
  constraintFreeDof: document.getElementById("constraintFreeDof"),
  rollerField: document.getElementById("rollerField"),
  guidedField: document.getElementById("guidedField"),
  constraintPlane: document.getElementById("constraintPlane"),
  constraintPlaneCoord: document.getElementById("constraintPlaneCoord"),
  constraintPlaneCoordLabel: document.getElementById("constraintPlaneCoordLabel"),
  constraintsList: document.getElementById("constraintsList"),
  advE: document.getElementById("advE"),
  advNu: document.getElementById("advNu"),
  advIterations: document.getElementById("advIterations"),
  advVolumeFraction: document.getElementById("advVolumeFraction"),
  advInitialDensity: document.getElementById("advInitialDensity"),
  advPenalty: document.getElementById("advPenalty"),
  advFilterRadius: document.getElementById("advFilterRadius"),
  advThreshold1: document.getElementById("advThreshold1"),
  advThreshold2: document.getElementById("advThreshold2"),
  advThreshold3: document.getElementById("advThreshold3"),
  presetSelect: document.getElementById("presetSelect"),
  loadPresetButton: document.getElementById("loadPresetButton"),
  addLoadButton: document.getElementById("addLoadButton"),
  addConstraintButton: document.getElementById("addConstraintButton"),
  terminalOutput: document.getElementById("terminalOutput"),
  resultsGrid: document.getElementById("resultsGrid"),
  resultsSummary: document.getElementById("resultsSummary"),
  statusChip: document.getElementById("statusChip"),
  runButton: document.getElementById("runButton"),
  runError: document.getElementById("runError"),
  panelToggle: document.getElementById("panelToggle"),
  sidePanel: document.getElementById("sidePanel"),
  geometryWarning: document.getElementById("geometryWarning"),
  tabButtons: [...document.querySelectorAll(".output-surface .tab-button")],
  tabPanels: [...document.querySelectorAll(".output-surface .tab-panel")],
  visualizerTabButtons: [...document.querySelectorAll(".visualizer-tab-button")],
};

function toMillimeters(valueInMeters) {
  return valueInMeters * MM_PER_M;
}

function toMeters(valueInMillimeters) {
  return valueInMillimeters / MM_PER_M;
}

function numberValue(input, fallback) {
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerValue(input, fallback) {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function syncStateFromForm() {
  state.dimensions.lx = Math.max(1, numberValue(elements.dimX, state.dimensions.lx));
  state.dimensions.ly = Math.max(1, numberValue(elements.dimY, state.dimensions.ly));
  state.dimensions.lz = Math.max(1, numberValue(elements.dimZ, state.dimensions.lz));
  state.mesh.nx = Math.max(1, integerValue(elements.meshX, state.mesh.nx));
  state.mesh.ny = Math.max(1, integerValue(elements.meshY, state.mesh.ny));
  state.mesh.nz = Math.max(1, integerValue(elements.meshZ, state.mesh.nz));

  state.advanced.E_mod = Math.max(1, numberValue(elements.advE, state.advanced.E_mod));
  state.advanced.nu = numberValue(elements.advNu, state.advanced.nu);
  state.advanced.iterations = Math.max(1, integerValue(elements.advIterations, state.advanced.iterations));
  state.advanced.volume_fraction = numberValue(elements.advVolumeFraction, state.advanced.volume_fraction);
  state.advanced.initial_density = numberValue(elements.advInitialDensity, state.advanced.initial_density);
  state.advanced.penalty = numberValue(elements.advPenalty, state.advanced.penalty);
  state.advanced.filter_radius = numberValue(elements.advFilterRadius, state.advanced.filter_radius);
  state.advanced.thresholds = [
    numberValue(elements.advThreshold1, state.advanced.thresholds[0]),
    numberValue(elements.advThreshold2, state.advanced.thresholds[1]),
    numberValue(elements.advThreshold3, state.advanced.thresholds[2]),
  ];
}

function applyStateToForm() {
  elements.dimX.value = state.dimensions.lx;
  elements.dimY.value = state.dimensions.ly;
  elements.dimZ.value = state.dimensions.lz;
  elements.meshX.value = state.mesh.nx;
  elements.meshY.value = state.mesh.ny;
  elements.meshZ.value = state.mesh.nz;
  elements.advE.value = state.advanced.E_mod;
  elements.advNu.value = state.advanced.nu;
  elements.advIterations.value = state.advanced.iterations;
  elements.advVolumeFraction.value = state.advanced.volume_fraction;
  elements.advInitialDensity.value = state.advanced.initial_density;
  elements.advPenalty.value = state.advanced.penalty;
  elements.advFilterRadius.value = state.advanced.filter_radius;
  elements.advThreshold1.value = state.advanced.thresholds[0];
  elements.advThreshold2.value = state.advanced.thresholds[1];
  elements.advThreshold3.value = state.advanced.thresholds[2];
}

function updateMeshInfo() {
  const { nx, ny, nz } = state.mesh;
  const nodeCount = (nx + 1) * (ny + 1) * (nz + 1);
  elements.meshInfo.textContent = `Nodes: (${nx + 1}) x (${ny + 1}) x (${nz + 1}) = ${nodeCount}`;
}

function populateSelect(select, values, formatter = (value) => value) {
  const current = select.value;
  select.innerHTML = values
    .map((value) => `<option value="${value}">${formatter(value)}</option>`)
    .join("");
  if (values.some((value) => String(value) === current)) {
    select.value = current;
  }
}

function formatCoordinate(value) {
  return Number.parseFloat(Number(value).toFixed(4));
}

function refreshCoordinateLabels() {
  elements.loadPlaneCoordLabel.textContent = planeCoordinateLabel(elements.loadPlane.value, "mm");
  elements.constraintPlaneCoordLabel.textContent = planeCoordinateLabel(elements.constraintPlane.value, "mm");
}

function refreshCoordinateSelects() {
  populateSelect(elements.loadPointX, meshCoordinates.x, formatCoordinate);
  populateSelect(elements.loadPointY, meshCoordinates.y, formatCoordinate);
  populateSelect(elements.loadPointZ, meshCoordinates.z, formatCoordinate);

  const loadPlaneMap = {
    XY: meshCoordinates.z,
    XZ: meshCoordinates.y,
    YZ: meshCoordinates.x,
  };
  const constraintPlaneMap = {
    XY: meshCoordinates.z,
    XZ: meshCoordinates.y,
    YZ: meshCoordinates.x,
  };
  populateSelect(elements.loadPlaneCoord, loadPlaneMap[elements.loadPlane.value], formatCoordinate);
  populateSelect(elements.constraintPlaneCoord, constraintPlaneMap[elements.constraintPlane.value], formatCoordinate);
}

async function refreshMeshCoordinates() {
  syncStateFromForm();
  updateMeshInfo();
  const requestVersion = ++meshRequestVersion;
  const response = await fetch("/api/validate_mesh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lx: toMeters(state.dimensions.lx),
      ly: toMeters(state.dimensions.ly),
      lz: toMeters(state.dimensions.lz),
      nx: state.mesh.nx,
      ny: state.mesh.ny,
      nz: state.mesh.nz,
    }),
  });
  const data = await response.json();
  if (requestVersion !== meshRequestVersion) return;
  meshCoordinates.x = data.x.map(toMillimeters);
  meshCoordinates.y = data.y.map(toMillimeters);
  meshCoordinates.z = data.z.map(toMillimeters);
  refreshCoordinateLabels();
  refreshCoordinateSelects();
}

function updateLoadTypeUI() {
  const isPoint = elements.loadType.value === "point";
  elements.pointLoadFields.classList.toggle("hidden", !isPoint);
  elements.distributedLoadFields.classList.toggle("hidden", isPoint);
}

function updateConstraintTypeUI() {
  const type = elements.constraintType.value;
  elements.rollerField.classList.toggle("hidden", type !== "roller");
  elements.guidedField.classList.toggle("hidden", type !== "guided");
}

function renderLists() {
  elements.loadsList.innerHTML = state.loads
    .map((load) => {
      const palette = LOAD_PALETTE[load.colorIndex % LOAD_PALETTE.length];
      const badgeStyle = `background:${palette.color};color:${palette.label};border-color:${palette.color};`;
      return `
        <div class="item-pill load">
          <div class="item-copy">
            <strong style="${badgeStyle}">LOAD</strong>${describeLoad(load, "mm")}
          </div>
          <button class="delete-button" type="button" data-load-delete="${load.id}">x</button>
        </div>
      `;
    })
    .join("");

  elements.constraintsList.innerHTML = state.constraints
    .map((constraint) => {
      const palette = CONSTRAINT_PALETTE[constraint.colorIndex % CONSTRAINT_PALETTE.length];
      const badgeStyle = `background:${palette.color};color:${palette.label};border-color:${palette.color};`;
      return `
        <div class="item-pill constraint">
          <div class="item-copy">
            <strong style="${badgeStyle}">FIX</strong>${describeConstraint(constraint, "mm")}
          </div>
          <button class="delete-button" type="button" data-constraint-delete="${constraint.id}">x</button>
        </div>
      `;
    })
    .join("");
}

function renderVisualizer() {
  visualizer.setState({
    dimensions: state.dimensions,
    mesh: state.mesh,
    loads: state.loads,
    constraints: state.constraints,
    viewMode: state.viewMode,
    unitLabel: "mm",
  });
}

function renderAll() {
  renderLists();
  renderVisualizer();
}

function clearGeometryWarningTimers() {
  if (geometryWarningTimer) clearTimeout(geometryWarningTimer);
  if (geometryFadeTimer) clearTimeout(geometryFadeTimer);
}

function showGeometryWarning() {
  clearGeometryWarningTimers();
  elements.geometryWarning.hidden = false;
  elements.geometryWarning.classList.remove("fade");
  geometryFadeTimer = setTimeout(() => elements.geometryWarning.classList.add("fade"), 4400);
  geometryWarningTimer = setTimeout(() => {
    elements.geometryWarning.hidden = true;
    elements.geometryWarning.classList.remove("fade");
  }, 5000);
}

async function handleGeometryChange() {
  const hadAssignments = state.loads.length > 0 || state.constraints.length > 0;
  syncStateFromForm();
  if (hadAssignments) {
    state.loads = [];
    state.constraints = [];
    showGeometryWarning();
  }
  await refreshMeshCoordinates();
  renderAll();
}

function addLoad() {
  const type = elements.loadType.value;
  const load = {
    id: loadId++,
    colorIndex: loadColorIndex++,
    type,
    direction: elements.loadDirection.value,
    magnitude: Math.max(0, numberValue(elements.loadMagnitude, 0)),
  };

  if (type === "point") {
    load.px = numberValue(elements.loadPointX, 0);
    load.py = numberValue(elements.loadPointY, 0);
    load.pz = numberValue(elements.loadPointZ, 0);
  } else {
    load.plane = elements.loadPlane.value;
    load.planeCoord = numberValue(elements.loadPlaneCoord, 0);
  }

  state.loads.push(load);
  renderAll();
}

function addConstraint() {
  const type = elements.constraintType.value;
  const constraint = {
    id: constraintId++,
    colorIndex: constraintColorIndex++,
    type,
    plane: elements.constraintPlane.value,
    planeCoord: numberValue(elements.constraintPlaneCoord, 0),
  };

  if (type === "roller") {
    constraint.fixedDOF = elements.constraintFixedDof.value;
  } else if (type === "guided") {
    constraint.freeDOF = elements.constraintFreeDof.value;
  }

  state.constraints.push(constraint);
  renderAll();
}

function buildPresetOptions() {
  elements.presetSelect.innerHTML = presets
    .map((preset, index) => `<option value="${index}">${preset.name}</option>`)
    .join("");
}

function applyPreset(preset) {
  state.dimensions.lx = toMillimeters(preset.dimensions.lx);
  state.dimensions.ly = toMillimeters(preset.dimensions.ly);
  state.dimensions.lz = toMillimeters(preset.dimensions.lz);
  state.mesh = { ...preset.mesh };
  state.advanced = {
    ...preset.advanced,
    thresholds: [...preset.advanced.thresholds],
  };
  state.loads = preset.loads.map((load) => ({
    ...load,
    id: loadId++,
    colorIndex: loadColorIndex++,
    px: load.px !== undefined ? toMillimeters(load.px) : undefined,
    py: load.py !== undefined ? toMillimeters(load.py) : undefined,
    pz: load.pz !== undefined ? toMillimeters(load.pz) : undefined,
    planeCoord: load.planeCoord !== undefined ? toMillimeters(load.planeCoord) : undefined,
  }));
  state.constraints = preset.constraints.map((constraint) => ({
    ...constraint,
    id: constraintId++,
    colorIndex: constraintColorIndex++,
    planeCoord: toMillimeters(constraint.planeCoord),
  }));
  applyStateToForm();
}

function serializeStateForApi() {
  syncStateFromForm();
  return {
    dimensions: {
      lx: toMeters(state.dimensions.lx),
      ly: toMeters(state.dimensions.ly),
      lz: toMeters(state.dimensions.lz),
    },
    mesh: { ...state.mesh },
    advanced: {
      ...state.advanced,
      thresholds: [...state.advanced.thresholds],
    },
    loads: state.loads.map((load) => {
      if (load.type === "point") {
        return {
          type: "point",
          px: toMeters(load.px),
          py: toMeters(load.py),
          pz: toMeters(load.pz),
          direction: load.direction,
          magnitude: load.magnitude,
        };
      }
      return {
        type: "distributed",
        plane: load.plane,
        planeCoord: toMeters(load.planeCoord),
        direction: load.direction,
        magnitude: load.magnitude,
      };
    }),
    constraints: state.constraints.map((constraint) => {
      const base = {
        type: constraint.type,
        plane: constraint.plane,
        planeCoord: toMeters(constraint.planeCoord),
      };
      if (constraint.type === "roller") return { ...base, fixedDOF: constraint.fixedDOF };
      if (constraint.type === "guided") return { ...base, freeDOF: constraint.freeDOF };
      return base;
    }),
  };
}

function setStatus(text, kind) {
  elements.statusChip.textContent = text;
  elements.statusChip.className = `status-chip ${kind}`;
}

function setRunButtonState(running) {
  elements.runButton.textContent = running ? "■ Stop" : "▶ Run Optimization";
  elements.runButton.classList.toggle("stop", running);
}

function setControlsDisabled(disabled) {
  for (const element of elements.sidePanel.querySelectorAll("input, select, button")) {
    if (element === elements.panelToggle) continue;
    element.disabled = disabled;
  }
  elements.runButton.disabled = false;
  elements.panelToggle.disabled = false;
}

function clearRunError() {
  elements.runError.hidden = true;
  elements.runError.textContent = "";
}

function setRunError(message) {
  elements.runError.hidden = false;
  elements.runError.textContent = message;
}

function openTab(tabName) {
  for (const button of elements.tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }
  for (const panel of elements.tabPanels) {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  }
}

function openVisualizerTab(viewMode) {
  state.viewMode = viewMode;
  for (const button of elements.visualizerTabButtons) {
    button.classList.toggle("active", button.dataset.visualizerTab === viewMode);
  }
  renderVisualizer();
}

function clearTerminal() {
  elements.terminalOutput.innerHTML = '<div class="terminal-placeholder">Waiting for run...</div>';
}

function appendTerminalLine(text, className = "") {
  const placeholder = elements.terminalOutput.querySelector(".terminal-placeholder");
  if (placeholder) placeholder.remove();
  const line = document.createElement("div");
  line.className = `terminal-line ${className}`.trim();
  line.textContent = text;
  elements.terminalOutput.appendChild(line);
  elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

function createChart(canvasId, label, color, logarithmic = false) {
  const context = document.getElementById(canvasId).getContext("2d");
  return new window.Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: color,
          pointRadius: 2,
          tension: 0.18,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: "#c8d8e8" } },
      },
      scales: {
        x: {
          title: { display: true, text: "Iteration", color: "#8ca2b8" },
          ticks: { color: "#8ca2b8" },
          grid: { color: "rgba(140,162,184,0.14)" },
        },
        y: {
          type: logarithmic ? "logarithmic" : "linear",
          title: { display: true, text: label, color: "#8ca2b8" },
          ticks: { color: "#8ca2b8" },
          grid: { color: "rgba(140,162,184,0.14)" },
        },
      },
    },
  });
}

function resetCharts() {
  for (const chart of [complianceChart, volumeChart, densityChangeChart]) {
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.update();
  }
}

function pushChartPoint(iteration, compliance, volume, densityChange) {
  complianceChart.data.labels.push(iteration);
  complianceChart.data.datasets[0].data.push(compliance);
  complianceChart.update();

  volumeChart.data.labels.push(iteration);
  volumeChart.data.datasets[0].data.push(volume);
  volumeChart.update();

  densityChangeChart.data.labels.push(iteration);
  densityChangeChart.data.datasets[0].data.push(Math.max(densityChange, 1e-9));
  densityChangeChart.update();
}

function renderResults(doneMessage) {
  const stamp = Date.now();
  elements.resultsGrid.innerHTML = doneMessage.results.images
    .map((image) => {
      const label = `rho > ${image.threshold}`;
      if (!image.has_data) {
        return `
          <div class="result-card">
            <h3>${label}</h3>
            <div class="result-placeholder">No elements exceed this threshold.</div>
          </div>
        `;
      }
      return `
        <div class="result-card">
          <h3>${label}</h3>
          <img src="${image.url}?t=${stamp}" alt="${label}">
        </div>
      `;
    })
    .join("");

  const summary = doneMessage.summary;
  elements.resultsSummary.innerHTML = `
    <table>
      <tbody>
        <tr><th>Initial compliance</th><td>${summary.initial_compliance.toExponential(6)}</td></tr>
        <tr><th>Final compliance</th><td>${summary.final_compliance.toExponential(6)}</td></tr>
        <tr><th>Improvement</th><td>${summary.improvement_pct.toFixed(2)}%</td></tr>
        <tr><th>Final volume fraction</th><td>${summary.final_volume_fraction.toFixed(4)}</td></tr>
      </tbody>
    </table>
  `;
}

function finishRun(statusText, kind) {
  activeRun = null;
  setStatus(statusText, kind);
  setRunButtonState(false);
  setControlsDisabled(false);
}

async function stopActiveRun() {
  if (!activeRun) return;
  const runToStop = activeRun;
  activeRun = null;
  if (runToStop.runId) {
    try {
      await fetch(`/api/stop/${runToStop.runId}`, { method: "POST" });
    } catch (_) {
      // The stream abort below is the important fallback.
    }
  }
  runToStop.controller.abort();
  appendTerminalLine("Stop requested. Ending stream...", "error");
  finishRun("Stopped", "idle");
}

function handleStreamMessage(message) {
  if (message.iteration !== undefined) {
    const terminalLine = `Iter ${String(message.iteration).padStart(2, "0")} | C: ${message.compliance.toExponential(6)} | V: ${message.volume.toFixed(4)} | dRhoMax: ${message.density_change.toExponential(6)}`;
    appendTerminalLine(terminalLine);
    pushChartPoint(message.iteration, message.compliance, message.volume, message.density_change);
    return;
  }

  if (message.error) {
    appendTerminalLine(`ERROR: ${message.error}`, "error");
    finishRun("Error", "error");
    return;
  }

  if (message.stopped) {
    appendTerminalLine("Optimization stopped.", "error");
    finishRun("Stopped", "idle");
    return;
  }

  if (message.done) {
    appendTerminalLine("Optimization complete", "complete");
    renderResults(message);
    openTab("results");
    finishRun("Completed", "success");
  }
}

async function consumeSseResponse(response, runContext) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const rawEvent of events) {
      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      const parsed = JSON.parse(dataLines.join("\n"));
      if (activeRun !== runContext) return;
      handleStreamMessage(parsed);
    }
  }
}

async function runOptimization() {
  clearRunError();
  if (state.loads.length === 0 || state.constraints.length === 0) {
    setRunError("Add at least one load and one constraint before running.");
    return;
  }

  openTab("terminal");
  clearTerminal();
  resetCharts();
  elements.resultsGrid.innerHTML = "";
  elements.resultsSummary.innerHTML = "";
  setStatus("Running", "running");
  setRunButtonState(true);
  setControlsDisabled(true);
  appendTerminalLine("Submitting optimization job...");

  const controller = new AbortController();
  const runContext = { controller, runId: null };
  activeRun = runContext;

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeStateForApi()),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    runContext.runId = response.headers.get("X-Run-Id");
    appendTerminalLine(`Run started. ID: ${runContext.runId || "stream"}`);
    await consumeSseResponse(response, runContext);

    if (activeRun === runContext) {
      appendTerminalLine("Stream closed before completion.", "error");
      finishRun("Error", "error");
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    appendTerminalLine(`ERROR: ${error.message}`, "error");
    finishRun("Error", "error");
  }
}

function registerListDelegation() {
  elements.loadsList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-load-delete]");
    if (!target) return;
    const id = Number.parseInt(target.dataset.loadDelete, 10);
    state.loads = state.loads.filter((load) => load.id !== id);
    renderAll();
  });

  elements.constraintsList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-constraint-delete]");
    if (!target) return;
    const id = Number.parseInt(target.dataset.constraintDelete, 10);
    state.constraints = state.constraints.filter((constraint) => constraint.id !== id);
    renderAll();
  });
}

async function loadPresets() {
  const response = await fetch("/api/presets");
  const data = await response.json();
  presets.splice(0, presets.length, ...data);
  buildPresetOptions();
}

function bindEvents() {
  for (const input of [elements.dimX, elements.dimY, elements.dimZ, elements.meshX, elements.meshY, elements.meshZ]) {
    input.addEventListener("change", handleGeometryChange);
  }

  for (const input of [
    elements.advE,
    elements.advNu,
    elements.advIterations,
    elements.advVolumeFraction,
    elements.advInitialDensity,
    elements.advPenalty,
    elements.advFilterRadius,
    elements.advThreshold1,
    elements.advThreshold2,
    elements.advThreshold3,
  ]) {
    input.addEventListener("change", () => {
      syncStateFromForm();
    });
  }

  elements.loadType.addEventListener("change", updateLoadTypeUI);
  elements.loadPlane.addEventListener("change", () => {
    refreshCoordinateLabels();
    refreshCoordinateSelects();
  });
  elements.constraintType.addEventListener("change", updateConstraintTypeUI);
  elements.constraintPlane.addEventListener("change", () => {
    refreshCoordinateLabels();
    refreshCoordinateSelects();
  });

  elements.addLoadButton.addEventListener("click", addLoad);
  elements.addConstraintButton.addEventListener("click", addConstraint);

  elements.loadPresetButton.addEventListener("click", async () => {
    const preset = presets[Number.parseInt(elements.presetSelect.value, 10)];
    if (!preset) return;
    applyPreset(preset);
    await refreshMeshCoordinates();
    renderAll();
  });

  elements.runButton.addEventListener("click", () => {
    if (activeRun) {
      stopActiveRun();
    } else {
      runOptimization();
    }
  });

  elements.panelToggle.addEventListener("click", () => {
    const collapsed = elements.sidePanel.classList.toggle("collapsed");
    elements.panelToggle.textContent = collapsed ? "▶" : "◀";
    setTimeout(() => renderVisualizer(), 240);
  });

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => openTab(button.dataset.tab));
  }

  for (const button of elements.visualizerTabButtons) {
    button.addEventListener("click", () => openVisualizerTab(button.dataset.visualizerTab));
  }
}

async function init() {
  visualizer = new BeamVisualizer({
    grid: document.getElementById("visualizerGrid"),
    svgTop: document.getElementById("svgTop"),
    svgFront: document.getElementById("svgFront"),
    svgRight: document.getElementById("svgRight"),
  });

  complianceChart = createChart("complianceChart", "Compliance", "#4a9edd", true);
  volumeChart = createChart("volumeChart", "Volume Fraction", "#56c271", false);
  densityChangeChart = createChart("densityChangeChart", "Max Density Change", "#f57f63", true);

  bindEvents();
  registerListDelegation();
  updateLoadTypeUI();
  updateConstraintTypeUI();
  applyStateToForm();
  await loadPresets();
  await refreshMeshCoordinates();
  renderAll();
}

window.addEventListener("load", init);
