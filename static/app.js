const presetSelect = document.getElementById("preset-select");
const presetDescription = document.getElementById("preset-description");
const applyPresetButton = document.getElementById("apply-preset");
const resetDefaultsButton = document.getElementById("reset-defaults");
const form = document.getElementById("optimizer-form");
const supportsList = document.getElementById("supports-list");
const loadsList = document.getElementById("loads-list");
const supportTemplate = document.getElementById("support-template");
const loadTemplate = document.getElementById("load-template");
const statusPill = document.getElementById("status-pill");
const progressLabel = document.getElementById("progress-label");
const progressStats = document.getElementById("progress-stats");
const progressFill = document.getElementById("progress-fill");
const liveLog = document.getElementById("live-log");
const summaryGrid = document.getElementById("summary-grid");
const imagesGrid = document.getElementById("images-grid");

let uiConfig = null;
let activeRunId = null;
let pollHandle = null;

function setStatus(status) {
  statusPill.textContent = status[0].toUpperCase() + status.slice(1);
  statusPill.className = `status ${status}`;
}

function updatePresetDescription() {
  if (!uiConfig) return;
  presetDescription.textContent = uiConfig.presets[presetSelect.value].description;
}

function createSupportCard(data = { mode: "face", face: "xmin" }) {
  const node = supportTemplate.content.firstElementChild.cloneNode(true);
  const modeSelect = node.querySelector('[data-field="mode"]');
  const faceSection = node.querySelector(".support-face");
  const positionSection = node.querySelector(".support-position");

  function syncSupportMode() {
    const isPosition = modeSelect.value === "position";
    faceSection.hidden = isPosition;
    positionSection.hidden = !isPosition;
  }

  modeSelect.value = data.mode || "face";
  node.querySelector('[data-field="face"]').value = data.face || "xmin";
  node.querySelector('[data-field="axis"]').value = data.axis || "x";
  node.querySelector('[data-field="position"]').value = data.position ?? 0;
  node.querySelector('[data-action="remove"]').addEventListener("click", () => node.remove());
  modeSelect.addEventListener("change", syncSupportMode);
  syncSupportMode();
  supportsList.appendChild(node);
}

function createLoadCard(data = { type: "distributed", face: "xmax", direction: "y", magnitude: -1000 }) {
  const node = loadTemplate.content.firstElementChild.cloneNode(true);
  const typeSelect = node.querySelector('[data-field="type"]');
  const faceSection = node.querySelector(".load-face");
  const pointSection = node.querySelector(".load-point");

  function syncLoadMode() {
    const isPoint = typeSelect.value === "point";
    faceSection.hidden = isPoint;
    pointSection.hidden = !isPoint;
  }

  typeSelect.value = data.type || "distributed";
  node.querySelector('[data-field="face"]').value = data.face || "xmax";
  node.querySelector('[data-field="direction"]').value = data.direction || "y";
  node.querySelector('[data-field="magnitude"]').value = data.magnitude ?? -1000;
  node.querySelector('[data-field="location-x"]').value = data.location?.x ?? "";
  node.querySelector('[data-field="location-y"]').value = data.location?.y ?? "";
  node.querySelector('[data-field="location-z"]').value = data.location?.z ?? "";
  node.querySelector('[data-action="remove"]').addEventListener("click", () => node.remove());
  typeSelect.addEventListener("change", syncLoadMode);
  syncLoadMode();
  loadsList.appendChild(node);
}

function populateForm(config, presetKey) {
  presetSelect.value = presetKey;
  updatePresetDescription();

  form.Lx.value = config.geometry.Lx;
  form.Ly.value = config.geometry.Ly;
  form.Lz.value = config.geometry.Lz;
  form.nx.value = config.geometry.nx;
  form.ny.value = config.geometry.ny;
  form.nz.value = config.geometry.nz;
  form.E_mod.value = config.material.E_mod;
  form.nu.value = config.material.nu;
  form.n_iterations.value = config.optimization.n_iterations;
  form.volume_fraction.value = config.optimization.volume_fraction;
  form.initial_density.value = config.optimization.initial_density;
  form.penalty.value = config.optimization.penalty;
  form.filter_radius.value = config.optimization.filter_radius;
  form.threshold_1.value = config.optimization.thresholds[0] ?? 0.2;
  form.threshold_2.value = config.optimization.thresholds[1] ?? 0.4;
  form.threshold_3.value = config.optimization.thresholds[2] ?? 0.6;

  supportsList.innerHTML = "";
  loadsList.innerHTML = "";
  config.boundary_conditions.supports.forEach((support) => createSupportCard(support));
  config.boundary_conditions.loads.forEach((load) => createLoadCard(load));
}

function collectPayload() {
  return {
    preset_key: presetSelect.value,
    geometry: {
      Lx: Number(form.Lx.value),
      Ly: Number(form.Ly.value),
      Lz: Number(form.Lz.value),
      nx: Number(form.nx.value),
      ny: Number(form.ny.value),
      nz: Number(form.nz.value),
    },
    material: {
      E_mod: Number(form.E_mod.value),
      nu: Number(form.nu.value),
    },
    optimization: {
      n_iterations: Number(form.n_iterations.value),
      volume_fraction: Number(form.volume_fraction.value),
      initial_density: Number(form.initial_density.value),
      penalty: Number(form.penalty.value),
      filter_radius: Number(form.filter_radius.value),
      thresholds: [
        Number(form.threshold_1.value),
        Number(form.threshold_2.value),
        Number(form.threshold_3.value),
      ],
    },
    boundary_conditions: {
      supports: [...supportsList.children].map((node) => {
        const mode = node.querySelector('[data-field="mode"]').value;
        if (mode === "position") {
          return {
            mode,
            axis: node.querySelector('[data-field="axis"]').value,
            position: Number(node.querySelector('[data-field="position"]').value),
          };
        }
        return {
          mode,
          face: node.querySelector('[data-field="face"]').value,
        };
      }),
      loads: [...loadsList.children].map((node) => {
        const type = node.querySelector('[data-field="type"]').value;
        const common = {
          type,
          direction: node.querySelector('[data-field="direction"]').value,
          magnitude: Number(node.querySelector('[data-field="magnitude"]').value),
        };
        if (type === "point") {
          return {
            ...common,
            location: {
              x: Number(node.querySelector('[data-field="location-x"]').value),
              y: Number(node.querySelector('[data-field="location-y"]').value),
              z: Number(node.querySelector('[data-field="location-z"]').value),
            },
          };
        }
        return {
          ...common,
          face: node.querySelector('[data-field="face"]').value,
        };
      }),
    },
  };
}

function validatePayload(payload) {
  if (!payload.boundary_conditions.supports.length) {
    throw new Error("Add at least one support.");
  }
  if (!payload.boundary_conditions.loads.length) {
    throw new Error("Add at least one load.");
  }
}

function renderSummary(result) {
  summaryGrid.innerHTML = "";
  imagesGrid.innerHTML = "";

  [
    ["Nodes", result.mesh.nodes],
    ["Elements", result.mesh.elements],
    ["Final compliance", Number(result.final_compliance).toExponential(3)],
    ["Final volume", result.final_volume.toFixed(3)],
    ["Improvement", `${result.compliance_improvement_percent.toFixed(1)}%`],
    ["Mean density", result.density.mean.toFixed(3)],
  ].forEach(([label, value]) => {
    const article = document.createElement("article");
    article.className = "summary-card";
    article.innerHTML = `<span class="subtle">${label}</span><strong>${value}</strong>`;
    summaryGrid.appendChild(article);
  });

  const images = [
    ["Convergence history", result.artifacts.images.convergence],
    ["Density histogram", result.artifacts.images.density_histogram],
    ...result.artifacts.images.thresholds.map((item) => [`3D density > ${item.threshold}`, item.file]),
  ];

  images.forEach(([caption, file]) => {
    const figure = document.createElement("figure");
    figure.className = "image-card";
    figure.innerHTML = `
      <img src="/runs/${result.run_id}/${file}" alt="${caption}">
      <figcaption>${caption}</figcaption>
    `;
    imagesGrid.appendChild(figure);
  });
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function pollRun() {
  if (!activeRunId) return;
  const response = await fetch(`/api/runs/${activeRunId}`);
  const payload = await response.json();

  setStatus(payload.status);
  const progress = payload.progress || {};
  const total = progress.total_iterations || 0;
  const iteration = progress.iteration || 0;
  const percent = total > 0 ? (iteration / total) * 100 : 0;
  progressFill.style.width = `${Math.min(percent, 100)}%`;

  if (payload.logs?.length) {
    liveLog.textContent = payload.logs.join("\n");
    liveLog.scrollTop = liveLog.scrollHeight;
  }

  if (payload.status === "running") {
    progressLabel.textContent = `Running iteration ${iteration} of ${total}`;
    const stats = [];
    if (progress.compliance !== undefined) stats.push(`C ${Number(progress.compliance).toExponential(3)}`);
    if (progress.volume !== undefined) stats.push(`V ${Number(progress.volume).toFixed(4)}`);
    if (progress.density_change !== undefined) stats.push(`dRho ${Number(progress.density_change).toExponential(3)}`);
    progressStats.textContent = stats.join("   ");
    return;
  }

  if (payload.status === "completed") {
    progressLabel.textContent = "Optimization finished.";
    progressStats.textContent = `Run ID ${payload.run_id}`;
    renderSummary(payload.result);
    stopPolling();
    return;
  }

  if (payload.status === "failed") {
    progressLabel.textContent = "Optimization failed.";
    progressStats.textContent = payload.error || "Unknown error";
    stopPolling();
  }
}

async function loadUiConfig() {
  const response = await fetch("/api/ui-config");
  uiConfig = await response.json();

  presetSelect.innerHTML = "";
  Object.entries(uiConfig.presets).forEach(([key, preset]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  });

  populateForm(uiConfig.defaults, uiConfig.default_preset);
}

document.getElementById("add-support").addEventListener("click", () => createSupportCard());
document.getElementById("add-load").addEventListener("click", () => createLoadCard());
presetSelect.addEventListener("change", updatePresetDescription);

applyPresetButton.addEventListener("click", () => {
  const preset = uiConfig.presets[presetSelect.value];
  populateForm(preset.config, presetSelect.value);
});

resetDefaultsButton.addEventListener("click", () => {
  populateForm(uiConfig.defaults, uiConfig.default_preset);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  summaryGrid.innerHTML = "";
  imagesGrid.innerHTML = "";
  liveLog.textContent = "Submitting run...";
  progressFill.style.width = "2%";

  try {
    const payload = collectPayload();
    validatePayload(payload);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to start run.");
    }
    activeRunId = data.run_id;
    setStatus("running");
    progressLabel.textContent = "Starting optimization...";
    progressStats.textContent = `Run ID ${activeRunId}`;
    stopPolling();
    await pollRun();
    pollHandle = setInterval(() => {
      pollRun().catch((error) => {
        stopPolling();
        setStatus("failed");
        progressLabel.textContent = "Polling failed.";
        progressStats.textContent = String(error);
      });
    }, 1000);
  } catch (error) {
    setStatus("failed");
    progressLabel.textContent = error.message;
    progressStats.textContent = "";
  }
});

loadUiConfig().catch((error) => {
  setStatus("failed");
  progressLabel.textContent = "Failed to load UI config.";
  progressStats.textContent = String(error);
});
