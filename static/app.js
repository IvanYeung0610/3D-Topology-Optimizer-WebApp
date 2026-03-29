const presetSelect = document.getElementById("preset-select");
const presetDescription = document.getElementById("preset-description");
const applyPresetButton = document.getElementById("apply-preset");
const resetDefaultsButton = document.getElementById("reset-defaults");
const form = document.getElementById("optimizer-form");
const supportsList = document.getElementById("supports-list");
const loadsList = document.getElementById("loads-list");
const supportTemplate = document.getElementById("support-template");
const loadTemplate = document.getElementById("load-template");
const workspace = document.querySelector(".workspace");
const drawerOpenButton = document.getElementById("drawer-open");
const drawerCloseButton = document.getElementById("drawer-close");
const statusPill = document.getElementById("status-pill");
const progressLabel = document.getElementById("progress-label");
const progressStats = document.getElementById("progress-stats");
const progressFill = document.getElementById("progress-fill");
const liveLog = document.getElementById("live-log");
const summaryGrid = document.getElementById("summary-grid");
const imagesGrid = document.getElementById("images-grid");
const visualizerSummary = document.getElementById("visualizer-summary");
const vizTop = document.getElementById("viz-top");
const vizFront = document.getElementById("viz-front");
const vizRight = document.getElementById("viz-right");

let uiConfig = null;
let activeRunId = null;
let pollHandle = null;
let vizFrame = null;

const SVG_NS = "http://www.w3.org/2000/svg";
const VISUALIZER_THEME = {
  beamFill: "#273240",
  beamStroke: "#51667d",
  mesh: "rgba(228, 235, 242, 0.12)",
  support: "#4ba3ff",
  supportFill: "rgba(75, 163, 255, 0.18)",
  load: "#d8a24c",
  point: "#dd6b6b",
  pointFill: "rgba(221, 107, 107, 0.14)",
  node: "#9ca8b7",
  text: "#dfe7ef",
  subtle: "#92a0b0",
};

function setDrawerOpen(isOpen) {
  workspace.dataset.drawerOpen = isOpen ? "true" : "false";
  drawerOpenButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  drawerCloseButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  requestAnimationFrame(() => scheduleVisualizerRender());
}

function setStatus(status) {
  statusPill.textContent = status[0].toUpperCase() + status.slice(1);
  statusPill.className = `status ${status}`;
}

function updatePresetDescription() {
  if (!uiConfig) return;
  presetDescription.textContent = uiConfig.presets[presetSelect.value].description;
}

function clamp(value, minValue) {
  return Math.max(Number.isFinite(value) ? value : minValue, minValue);
}

function axisLength(geometry, axis) {
  return geometry[`L${axis}`];
}

function sanitizeGeometry(geometry) {
  return {
    Lx: clamp(Number(geometry.Lx), 0.01),
    Ly: clamp(Number(geometry.Ly), 0.01),
    Lz: clamp(Number(geometry.Lz), 0.01),
    nx: Math.max(Math.round(Number(geometry.nx) || 1), 1),
    ny: Math.max(Math.round(Number(geometry.ny) || 1), 1),
    nz: Math.max(Math.round(Number(geometry.nz) || 1), 1),
  };
}

function getNodeCoordinates(geometry) {
  return {
    x: Array.from({ length: geometry.nx + 1 }, (_, index) => (index * geometry.Lx) / geometry.nx),
    y: Array.from({ length: geometry.ny + 1 }, (_, index) => (index * geometry.Ly) / geometry.ny),
    z: Array.from({ length: geometry.nz + 1 }, (_, index) => (index * geometry.Lz) / geometry.nz),
  };
}

function resolveFacePlane(face, geometry) {
  const planes = {
    xmin: { axis: "x", coord: 0 },
    xmax: { axis: "x", coord: geometry.Lx },
    ymin: { axis: "y", coord: 0 },
    ymax: { axis: "y", coord: geometry.Ly },
    zmin: { axis: "z", coord: 0 },
    zmax: { axis: "z", coord: geometry.Lz },
  };
  return planes[face] || planes.xmin;
}

function resolveSupportPlane(support, geometry) {
  if (support.mode === "position") {
    const axis = support.axis || "x";
    return {
      axis,
      coord: Math.min(Math.max(Number(support.position) || 0, 0), axisLength(geometry, axis)),
    };
  }
  return resolveFacePlane(support.face, geometry);
}

function resolveDistributedLoadPlane(load, geometry) {
  return resolveFacePlane(load.face, geometry);
}

function getSignedDirection(load) {
  const axis = load.direction || "y";
  return Number(load.magnitude) < 0 ? `-${axis}` : axis;
}

function samplePositions(values, count) {
  if (values.length <= count) {
    return values;
  }

  const sampled = [];
  const lastIndex = values.length - 1;
  for (let index = 0; index < count; index += 1) {
    sampled.push(values[Math.round((index / (count - 1)) * lastIndex)]);
  }
  return Array.from(new Set(sampled));
}

function formatNumber(value) {
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) {
    return Number(value).toExponential(2);
  }
  return Number(value)
    .toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function svgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function addText(svg, x, y, text, attributes = {}) {
  const label = svgEl("text", {
    x,
    y,
    fill: VISUALIZER_THEME.subtle,
    "font-size": 11,
    "font-family": "IBM Plex Mono, monospace",
    ...attributes,
  });
  label.textContent = text;
  svg.appendChild(label);
}

function buildViewState(svg, geometry, horizontalAxis, verticalAxis) {
  const width = 420;
  const height = 250;
  const margin = { top: 26, right: 18, bottom: 26, left: 18 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const horizontalLength = axisLength(geometry, horizontalAxis);
  const verticalLength = axisLength(geometry, verticalAxis);
  const scale = Math.min(innerWidth / horizontalLength, innerHeight / verticalLength);
  const beamWidth = horizontalLength * scale;
  const beamHeight = verticalLength * scale;
  const left = (width - beamWidth) / 2;
  const top = (height - beamHeight) / 2;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: `${svg.id}-arrow`,
    markerWidth: 8,
    markerHeight: 8,
    refX: 7,
    refY: 4,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.appendChild(svgEl("path", { d: "M0,0 L8,4 L0,8 z", fill: VISUALIZER_THEME.load }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  return {
    svg,
    geometry,
    horizontalAxis,
    verticalAxis,
    hiddenAxis: ["x", "y", "z"].find((axis) => axis !== horizontalAxis && axis !== verticalAxis),
    left,
    top,
    beamWidth,
    beamHeight,
    markerId: `${svg.id}-arrow`,
    mapX(value) {
      return left + (value / horizontalLength) * beamWidth;
    },
    mapY(value) {
      return top + (value / verticalLength) * beamHeight;
    },
  };
}

function drawViewBase(state, nodeCoords) {
  const { svg, left, top, beamWidth, beamHeight, horizontalAxis, verticalAxis, mapX, mapY } = state;

  svg.appendChild(
    svgEl("rect", {
      x: left,
      y: top,
      width: beamWidth,
      height: beamHeight,
      rx: 14,
      fill: VISUALIZER_THEME.beamFill,
      stroke: VISUALIZER_THEME.beamStroke,
      "stroke-width": 1.5,
    })
  );

  nodeCoords[horizontalAxis].forEach((value) => {
    svg.appendChild(
      svgEl("line", {
        x1: mapX(value),
        y1: top,
        x2: mapX(value),
        y2: top + beamHeight,
        stroke: VISUALIZER_THEME.mesh,
        "stroke-width": 1,
      })
    );
  });

  nodeCoords[verticalAxis].forEach((value) => {
    svg.appendChild(
      svgEl("line", {
        x1: left,
        y1: mapY(value),
        x2: left + beamWidth,
        y2: mapY(value),
        stroke: VISUALIZER_THEME.mesh,
        "stroke-width": 1,
      })
    );
  });

  nodeCoords[horizontalAxis].forEach((hValue) => {
    nodeCoords[verticalAxis].forEach((vValue) => {
      svg.appendChild(
        svgEl("circle", {
          cx: mapX(hValue),
          cy: mapY(vValue),
          r: 1.8,
          fill: VISUALIZER_THEME.node,
          opacity: 0.5,
        })
      );
    });
  });

  addText(svg, left, top - 8, horizontalAxis.toUpperCase(), { fill: VISUALIZER_THEME.text, "font-size": 10 });
  addText(svg, left + beamWidth - 8, top + beamHeight + 18, verticalAxis.toUpperCase(), {
    fill: VISUALIZER_THEME.text,
    "font-size": 10,
    "text-anchor": "end",
  });
}

function drawSupportPlane(state, plane) {
  const { svg, left, top, beamWidth, beamHeight, horizontalAxis, hiddenAxis, mapX, mapY } = state;
  if (plane.axis === hiddenAxis) {
    svg.appendChild(
      svgEl("rect", {
        x: left + 4,
        y: top + 4,
        width: beamWidth - 8,
        height: beamHeight - 8,
        rx: 12,
        fill: VISUALIZER_THEME.supportFill,
        stroke: VISUALIZER_THEME.support,
        "stroke-width": 1.2,
        "stroke-dasharray": "6 6",
      })
    );
    return;
  }

  const isVertical = plane.axis === horizontalAxis;
  const linePos = isVertical ? mapX(plane.coord) : mapY(plane.coord);
  const bandThickness = 8;

  if (isVertical) {
    svg.appendChild(
      svgEl("rect", {
        x: Math.max(left, linePos - bandThickness / 2),
        y: top,
        width: bandThickness,
        height: beamHeight,
        fill: VISUALIZER_THEME.supportFill,
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: linePos,
        y1: top,
        x2: linePos,
        y2: top + beamHeight,
        stroke: VISUALIZER_THEME.support,
        "stroke-width": 2.2,
      })
    );
  } else {
    svg.appendChild(
      svgEl("rect", {
        x: left,
        y: Math.max(top, linePos - bandThickness / 2),
        width: beamWidth,
        height: bandThickness,
        fill: VISUALIZER_THEME.supportFill,
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: left,
        y1: linePos,
        x2: left + beamWidth,
        y2: linePos,
        stroke: VISUALIZER_THEME.support,
        "stroke-width": 2.2,
      })
    );
  }
}

function drawArrow(state, x, y, direction, label = "") {
  const { svg, markerId } = state;
  const arrowLength = 26;
  const delta = {
    x: [arrowLength, 0],
    "-x": [-arrowLength, 0],
    y: [0, arrowLength],
    "-y": [0, -arrowLength],
    z: [0, arrowLength],
    "-z": [0, -arrowLength],
  }[direction] || [0, -arrowLength];
  const startX = x - delta[0];
  const startY = y - delta[1];

  svg.appendChild(
    svgEl("line", {
      x1: startX,
      y1: startY,
      x2: x,
      y2: y,
      stroke: VISUALIZER_THEME.load,
      "stroke-width": 2.2,
      "marker-end": `url(#${markerId})`,
    })
  );

  if (label) {
    addText(svg, startX + 4, startY - 4, label, { fill: VISUALIZER_THEME.load, "font-size": 10 });
  }
}

function drawOutOfPlaneMarker(state, x, y, direction, label = "") {
  const { svg } = state;
  svg.appendChild(
    svgEl("circle", {
      cx: x,
      cy: y,
      r: 8,
      fill: "white",
      stroke: VISUALIZER_THEME.load,
      "stroke-width": 1.8,
    })
  );

  if (direction.startsWith("-")) {
    svg.appendChild(
      svgEl("line", {
        x1: x - 4,
        y1: y - 4,
        x2: x + 4,
        y2: y + 4,
        stroke: VISUALIZER_THEME.load,
        "stroke-width": 1.8,
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: x + 4,
        y1: y - 4,
        x2: x - 4,
        y2: y + 4,
        stroke: VISUALIZER_THEME.load,
        "stroke-width": 1.8,
      })
    );
  } else {
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 2.5, fill: VISUALIZER_THEME.load }));
  }

  if (label) {
    addText(svg, x + 12, y + 4, label, { fill: VISUALIZER_THEME.load, "font-size": 10 });
  }
}

function drawPointLoad(state, load, geometry) {
  const { svg, horizontalAxis, verticalAxis, hiddenAxis, mapX, mapY } = state;
  const coords = {
    x: Math.min(Math.max(Number(load.location?.x) || 0, 0), geometry.Lx),
    y: Math.min(Math.max(Number(load.location?.y) || 0, 0), geometry.Ly),
    z: Math.min(Math.max(Number(load.location?.z) || 0, 0), geometry.Lz),
  };
  const direction = getSignedDirection(load);
  const directionAxis = direction.replace("-", "");
  const x = mapX(coords[horizontalAxis]);
  const y = mapY(coords[verticalAxis]);

  svg.appendChild(
    svgEl("circle", {
      cx: x,
      cy: y,
      r: 6,
      fill: VISUALIZER_THEME.pointFill,
      stroke: VISUALIZER_THEME.point,
      "stroke-width": 1.5,
    })
  );

  if (directionAxis === hiddenAxis) {
    drawOutOfPlaneMarker(state, x, y, direction, `${formatNumber(Math.abs(Number(load.magnitude)))} N`);
  } else {
    drawArrow(state, x, y, direction, `${formatNumber(Math.abs(Number(load.magnitude)))} N`);
  }
}

function drawDistributedLoad(state, load, geometry, nodeCoords) {
  const { svg, left, top, beamWidth, beamHeight, horizontalAxis, verticalAxis, hiddenAxis, mapX, mapY } = state;
  const plane = resolveDistributedLoadPlane(load, geometry);
  const direction = getSignedDirection(load);
  const directionAxis = direction.replace("-", "");

  if (plane.axis === hiddenAxis) {
    svg.appendChild(
      svgEl("rect", {
        x: left + 10,
        y: top + 10,
        width: beamWidth - 20,
        height: beamHeight - 20,
        rx: 10,
        fill: "rgba(221, 107, 51, 0.08)",
        stroke: VISUALIZER_THEME.load,
        "stroke-width": 1.2,
        "stroke-dasharray": "7 6",
      })
    );

    const samplesH = samplePositions(nodeCoords[horizontalAxis], Math.min(4, nodeCoords[horizontalAxis].length));
    const samplesV = samplePositions(nodeCoords[verticalAxis], Math.min(3, nodeCoords[verticalAxis].length));
    let isFirst = true;
    samplesH.forEach((hValue) => {
      samplesV.forEach((vValue) => {
        const x = mapX(hValue);
        const y = mapY(vValue);
        if (directionAxis === hiddenAxis) {
          drawOutOfPlaneMarker(
            state,
            x,
            y,
            direction,
            isFirst ? `${formatNumber(Math.abs(Number(load.magnitude)))} N total` : ""
          );
        } else {
          drawArrow(
            state,
            x,
            y,
            direction,
            isFirst ? `${formatNumber(Math.abs(Number(load.magnitude)))} N total` : ""
          );
        }
        isFirst = false;
      });
    });
    return;
  }

  const planeFollowsHorizontal = plane.axis === horizontalAxis;
  const linePos = planeFollowsHorizontal ? mapX(plane.coord) : mapY(plane.coord);
  const spreadValues = samplePositions(
    nodeCoords[planeFollowsHorizontal ? verticalAxis : horizontalAxis],
    Math.min(5, nodeCoords[planeFollowsHorizontal ? verticalAxis : horizontalAxis].length)
  );

  spreadValues.forEach((value, index) => {
    const x = planeFollowsHorizontal ? linePos : mapX(value);
    const y = planeFollowsHorizontal ? mapY(value) : linePos;
    if (directionAxis === hiddenAxis) {
      drawOutOfPlaneMarker(
        state,
        x,
        y,
        direction,
        index === 0 ? `${formatNumber(Math.abs(Number(load.magnitude)))} N total` : ""
      );
    } else {
      drawArrow(
        state,
        x,
        y,
        direction,
        index === 0 ? `${formatNumber(Math.abs(Number(load.magnitude)))} N total` : ""
      );
    }
  });
}

function updateVisualizerSummary(geometry, supports, loads) {
  visualizerSummary.innerHTML = [
    `<span class="summary-chip">Beam ${formatNumber(geometry.Lx)} x ${formatNumber(geometry.Ly)} x ${formatNumber(geometry.Lz)}</span>`,
    `<span class="summary-chip">Mesh ${geometry.nx} x ${geometry.ny} x ${geometry.nz}</span>`,
    `<span class="summary-chip">${supports.length} support${supports.length === 1 ? "" : "s"}</span>`,
    `<span class="summary-chip">${loads.length} load${loads.length === 1 ? "" : "s"}</span>`,
  ].join("");
}

function renderProjection(svg, geometry, supports, loads, horizontalAxis, verticalAxis, nodeCoords) {
  const state = buildViewState(svg, geometry, horizontalAxis, verticalAxis);
  drawViewBase(state, nodeCoords);
  supports
    .map((support) => resolveSupportPlane(support, geometry))
    .forEach((plane) => drawSupportPlane(state, plane));
  loads.forEach((load) => {
    if (load.type === "point") {
      drawPointLoad(state, load, geometry);
    } else {
      drawDistributedLoad(state, load, geometry, nodeCoords);
    }
  });
}

function renderLiveVisualization() {
  vizFrame = null;
  if (!uiConfig) return;

  const payload = collectPayload();
  const geometry = sanitizeGeometry(payload.geometry);
  const supports = payload.boundary_conditions.supports || [];
  const loads = payload.boundary_conditions.loads || [];
  const nodeCoords = getNodeCoordinates(geometry);

  updateVisualizerSummary(geometry, supports, loads);
  renderProjection(vizTop, geometry, supports, loads, "x", "y", nodeCoords);
  renderProjection(vizFront, geometry, supports, loads, "x", "z", nodeCoords);
  renderProjection(vizRight, geometry, supports, loads, "y", "z", nodeCoords);
}

function scheduleVisualizerRender() {
  if (vizFrame !== null) {
    cancelAnimationFrame(vizFrame);
  }
  vizFrame = requestAnimationFrame(renderLiveVisualization);
}

function bindLivePreview(node) {
  node.querySelectorAll("input, select").forEach((element) => {
    element.addEventListener("input", scheduleVisualizerRender);
    element.addEventListener("change", scheduleVisualizerRender);
  });
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
    scheduleVisualizerRender();
  }

  modeSelect.value = data.mode || "face";
  node.querySelector('[data-field="face"]').value = data.face || "xmin";
  node.querySelector('[data-field="axis"]').value = data.axis || "x";
  node.querySelector('[data-field="position"]').value = data.position ?? 0;
  node.querySelector('[data-action="remove"]').addEventListener("click", () => {
    node.remove();
    scheduleVisualizerRender();
  });
  bindLivePreview(node);
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
    scheduleVisualizerRender();
  }

  typeSelect.value = data.type || "distributed";
  node.querySelector('[data-field="face"]').value = data.face || "xmax";
  node.querySelector('[data-field="direction"]').value = data.direction || "y";
  node.querySelector('[data-field="magnitude"]').value = data.magnitude ?? -1000;
  node.querySelector('[data-field="location-x"]').value = data.location?.x ?? "";
  node.querySelector('[data-field="location-y"]').value = data.location?.y ?? "";
  node.querySelector('[data-field="location-z"]').value = data.location?.z ?? "";
  node.querySelector('[data-action="remove"]').addEventListener("click", () => {
    node.remove();
    scheduleVisualizerRender();
  });
  bindLivePreview(node);
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
  scheduleVisualizerRender();
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
  scheduleVisualizerRender();
}

document.getElementById("add-support").addEventListener("click", () => createSupportCard());
document.getElementById("add-load").addEventListener("click", () => createLoadCard());
presetSelect.addEventListener("change", updatePresetDescription);
form.addEventListener("input", scheduleVisualizerRender);
form.addEventListener("change", scheduleVisualizerRender);
drawerOpenButton.addEventListener("click", () => setDrawerOpen(true));
drawerCloseButton.addEventListener("click", () => setDrawerOpen(false));

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

window.addEventListener("resize", scheduleVisualizerRender);
