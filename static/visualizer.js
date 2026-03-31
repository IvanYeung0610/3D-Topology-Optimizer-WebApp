const PAD = 60;

const COLORS = {
  beam: "#b0c8e8",
  beamStroke: "#2a5a8a",
  meshEdge: "rgba(42,90,138,0.25)",
  node: "#2a5a8a",
};

// Five warm colors for loads (sufficiently distinct, legible on dark backgrounds)
export const LOAD_PALETTE = [
  { color: "#e03c2a", label: "#fff" },  // red-orange
  { color: "#e87d1e", label: "#fff" },  // amber-orange
  { color: "#d4b800", label: "#1a1200" }, // golden yellow — dark text for contrast
  { color: "#c4453e", label: "#fff" },  // crimson
  { color: "#b35c00", label: "#fff" },  // burnt sienna
];

// Five cool colors for constraints (sufficiently distinct)
export const CONSTRAINT_PALETTE = [
  { color: "#1a7a9a", label: "#fff" },  // teal
  { color: "#3a5fc8", label: "#fff" },  // cobalt blue
  { color: "#2e9e6e", label: "#fff" },  // sea green
  { color: "#6b3fc8", label: "#fff" },  // violet
  { color: "#1a6e5a", label: "#fff" },  // deep jade
];

function loadColor(colorIndex) {
  return LOAD_PALETTE[(colorIndex ?? 0) % LOAD_PALETTE.length].color;
}

function constraintColor(colorIndex) {
  return CONSTRAINT_PALETTE[(colorIndex ?? 0) % CONSTRAINT_PALETTE.length].color;
}

const WALL_LEN = 10;
const WALL_OFF = 8;
const HATCH_LEN = 6;
const HATCH_N = 5;
const LOAD_LENGTH = {
  point: 36,
  distributed: 36,
};

function el(tag, attrs, inner) {
  let out = `<${tag}`;
  for (const [key, value] of Object.entries(attrs)) {
    out += ` ${key}="${value}"`;
  }
  return inner !== undefined ? `${out}>${inner}</${tag}>` : `${out}/>`;
}

const line = (x1, y1, x2, y2, attrs = {}) => el("line", { x1, y1, x2, y2, ...attrs });
const rect = (x, y, width, height, attrs = {}) => el("rect", { x, y, width, height, ...attrs });
const text = (x, y, content, attrs = {}) => el("text", { x, y, ...attrs }, content);
const polygon = (points, attrs = {}) =>
  el(
    "polygon",
    {
      points: points.map(([x, y]) => `${x},${y}`).join(" "),
      ...attrs,
    }
  );

function toFixedNumber(value, digits = 4) {
  return Number.parseFloat(Number(value).toFixed(digits));
}

function axisLabel(direction) {
  return {
    "+X": "+X",
    "-X": "-X",
    "+Y": "+Y",
    "-Y": "-Y",
    "+Z": "+Z",
    "-Z": "-Z",
  }[direction] || direction;
}

function normalizeDirection(direction) {
  if (!direction) return "+x";
  return `${direction[0]}${direction.slice(1).toLowerCase()}`;
}

function planeAxis(plane) {
  return { XY: "Z", XZ: "Y", YZ: "X" }[plane];
}

function defaultState() {
  return {
    dimensions: { lx: 1000, ly: 200, lz: 100 },
    mesh: { nx: 20, ny: 6, nz: 4 },
    loads: [],
    constraints: [],
    viewMode: "all",
    unitLabel: "mm",
  };
}

export class BeamVisualizer {
  constructor({ grid, svgTop, svgFront, svgRight }) {
    this.grid = grid;
    this.svgTop = svgTop;
    this.svgFront = svgFront;
    this.svgRight = svgRight;
    this.state = defaultState();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.grid);
  }

  setState(state) {
    this.state = {
      dimensions: { ...state.dimensions },
      mesh: { ...state.mesh },
      loads: state.loads.map((load) => ({ ...load })),
      constraints: state.constraints.map((constraint) => ({ ...constraint })),
      viewMode: state.viewMode || "all",
      unitLabel: state.unitLabel || "mm",
    };
    this.render();
  }

  getViewMode() {
    return ["all", "top", "front", "right"].includes(this.state.viewMode) ? this.state.viewMode : "all";
  }

  destroy() {
    this.resizeObserver.disconnect();
  }

  getNodeCoords() {
    const { lx, ly, lz } = this.state.dimensions;
    const { nx, ny, nz } = this.state.mesh;
    const xs = Array.from({ length: nx + 1 }, (_, index) => toFixedNumber((index * lx) / nx, 6));
    const ys = Array.from({ length: ny + 1 }, (_, index) => toFixedNumber((index * ly) / ny, 6));
    const zs = Array.from({ length: nz + 1 }, (_, index) => toFixedNumber((index * lz) / nz, 6));
    return { xs, ys, zs };
  }

  computeLayout() {
    const totalWidth = this.grid.clientWidth || 700;
    const totalHeight = this.grid.clientHeight || 500;
    const { lx, ly, lz } = this.state.dimensions;
    const mode = this.getViewMode();
    if (mode !== "all") {
      const singleViewDimensions = {
        top: { width: lx, height: ly },
        front: { width: lx, height: lz },
        right: { width: ly, height: lz },
      }[mode];
      const scaleWidth = (totalWidth - 2 * PAD) / singleViewDimensions.width;
      const scaleHeight = (totalHeight - 2 * PAD) / singleViewDimensions.height;
      const scale = Math.max(0.005, Math.min(scaleWidth, scaleHeight));
      return {
        mode,
        scale,
        col0: totalWidth,
        col1: totalWidth,
        row0: totalHeight,
        row1: totalHeight,
      };
    }
    const scaleWidth = (totalWidth - 4 * PAD) / (lx + ly);
    const scaleHeight = (totalHeight - 4 * PAD) / (ly + lz);
    const scale = Math.max(0.005, Math.min(scaleWidth, scaleHeight));
    return {
      mode,
      scale,
      col0: 2 * PAD + lx * scale,
      col1: 2 * PAD + ly * scale,
      row0: 2 * PAD + ly * scale,
      row1: 2 * PAD + lz * scale,
    };
  }

  applyLayout(layout) {
    this.grid.dataset.viewMode = layout.mode;
    if (layout.mode === "all") {
      this.grid.style.gridTemplateColumns = `${Math.round(layout.col0)}px ${Math.round(layout.col1)}px`;
      this.grid.style.gridTemplateRows = `${Math.round(layout.row0)}px ${Math.round(layout.row1)}px`;
      return;
    }
    this.grid.style.gridTemplateColumns = "minmax(0, 1fr)";
    this.grid.style.gridTemplateRows = "minmax(0, 1fr)";
  }

  getDefs() {
    return "";
  }

  arrowHead(tipX, tipY, orientation, size, fill) {
    if (orientation === "right") {
      return polygon(
        [
          [tipX, tipY],
          [tipX - size, tipY - size * 0.55],
          [tipX - size, tipY + size * 0.55],
        ],
        { fill }
      );
    }
    if (orientation === "left") {
      return polygon(
        [
          [tipX, tipY],
          [tipX + size, tipY - size * 0.55],
          [tipX + size, tipY + size * 0.55],
        ],
        { fill }
      );
    }
    if (orientation === "up") {
      return polygon(
        [
          [tipX, tipY],
          [tipX - size * 0.55, tipY + size],
          [tipX + size * 0.55, tipY + size],
        ],
        { fill }
      );
    }
    return polygon(
      [
        [tipX, tipY],
        [tipX - size * 0.55, tipY - size],
        [tipX + size * 0.55, tipY - size],
      ],
      { fill }
    );
  }

  arrowLine(x1, y1, x2, y2, orientation, stroke, strokeWidth = 1.8, headSize = 7) {
    return (
      line(x1, y1, x2, y2, {
        stroke,
        "stroke-width": strokeWidth,
      }) + this.arrowHead(x2, y2, orientation, headSize, stroke)
    );
  }

  dimLine(x1, y1, x2, y2, label, offset, horizontal) {
    let dx = 0;
    let dy = 0;
    let labelX;
    let labelY;
    if (horizontal) {
      dy = offset;
      labelX = (x1 + x2) / 2;
      labelY = y1 + dy + (dy > 0 ? 10 : -3);
    } else {
      dx = offset;
      labelX = x1 + dx + (dx > 0 ? 13 : -13);
      labelY = (y1 + y2) / 2 + 4;
    }
    return (
      line(x1 + dx, y1 + dy, x2 + dx, y2 + dy, {
        stroke: "#91a2b3",
        "stroke-width": 0.8,
        "stroke-dasharray": "3,2",
      }) +
      line(x1, y1, x1 + dx, y1 + dy, { stroke: "#91a2b3", "stroke-width": 0.8 }) +
      line(x2, y2, x2 + dx, y2 + dy, { stroke: "#91a2b3", "stroke-width": 0.8 }) +
      text(labelX, labelY, label, {
        "font-size": 9,
        fill: "#7b8d9f",
        "text-anchor": "middle",
        "font-family": "JetBrains Mono",
      })
    );
  }

  axes(x0, y0, x1, y1, xLabel, yLabel) {
    return (
      this.arrowLine(x0 - 15, y1 + 20, x1 + 10, y1 + 20, "right", "#96a7b8", 1, 5) +
      text(x1 + 13, y1 + 23, xLabel, {
        "font-size": 9,
        fill: "#8798aa",
        "font-family": "JetBrains Mono",
      }) +
      this.arrowLine(x0 - 15, y1 + 20, x0 - 15, y0 - 10, "up", "#96a7b8", 1, 5) +
      text(x0 - 13, y0 - 13, yLabel, {
        "font-size": 9,
        fill: "#8798aa",
        "font-family": "JetBrains Mono",
      })
    );
  }

  // loadFill: color string or null; constraintStroke: color string or null
  nodeDot(sx, sy, loadFill, constraintStroke) {
    const hasLoad = loadFill !== null && loadFill !== undefined;
    const hasConstraint = constraintStroke !== null && constraintStroke !== undefined;
    let out = el("circle", {
      cx: sx,
      cy: sy,
      r: hasLoad ? 4 : 2.5,
      fill: hasLoad ? loadFill : COLORS.node,
      stroke: "#f4fbff",
      "stroke-width": hasLoad ? 1 : 0.8,
    });
    if (hasConstraint) {
      out += el("circle", {
        cx: sx,
        cy: sy,
        r: 5.2,
        fill: "none",
        stroke: constraintStroke,
        "stroke-width": 1.5,
      });
    }
    return out;
  }

  wallHatch(sx, sy, orientation, color) {
    let out = "";
    if (orientation === "left") {
      const wallX = sx - WALL_OFF;
      out += line(wallX, sy - WALL_LEN, wallX, sy + WALL_LEN, {
        stroke: color,
        "stroke-width": 1.8,
      });
      for (let index = 0; index <= HATCH_N; index += 1) {
        const hatchY = sy - WALL_LEN + (index / HATCH_N) * WALL_LEN * 2;
        out += line(wallX, hatchY, wallX - HATCH_LEN, hatchY + HATCH_LEN, {
          stroke: color,
          "stroke-width": 1,
        });
      }
      out += line(sx, sy, wallX, sy, {
        stroke: color,
        "stroke-width": 1.2,
        "stroke-dasharray": "2,1.5",
      });
    } else {
      const wallY = sy - WALL_OFF;
      out += line(sx - WALL_LEN, wallY, sx + WALL_LEN, wallY, {
        stroke: color,
        "stroke-width": 1.8,
      });
      for (let index = 0; index <= HATCH_N; index += 1) {
        const hatchX = sx - WALL_LEN + (index / HATCH_N) * WALL_LEN * 2;
        out += line(hatchX, wallY, hatchX - HATCH_LEN, wallY - HATCH_LEN, {
          stroke: color,
          "stroke-width": 1,
        });
      }
      out += line(sx, sy, sx, wallY, {
        stroke: color,
        "stroke-width": 1.2,
        "stroke-dasharray": "2,1.5",
      });
    }
    return out;
  }

  nodeConstraintSymbol(sx, sy, fixedSet, axisA, axisB, color) {
    let out = "";
    if (fixedSet.has(axisA)) out += this.wallHatch(sx, sy, "left", color);
    if (fixedSet.has(axisB)) out += this.wallHatch(sx, sy, "above", color);
    return out;
  }

  fixedDofs(constraint) {
    if (constraint.type === "fixed") return new Set(["X", "Y", "Z"]);
    if (constraint.type === "roller") return new Set([constraint.fixedDOF]);
    if (constraint.type === "guided") {
      return new Set(["X", "Y", "Z"].filter((axis) => axis !== constraint.freeDOF));
    }
    return new Set();
  }

  resolveLoadNodes(load) {
    const { xs, ys, zs } = this.getNodeCoords();
    if (load.type === "point") {
      return [{ wx: load.px, wy: load.py, wz: load.pz }];
    }

    const nodes = [];
    if (load.plane === "XY") {
      for (const wx of xs) {
        for (const wy of ys) nodes.push({ wx, wy, wz: load.planeCoord });
      }
    } else if (load.plane === "XZ") {
      for (const wx of xs) {
        for (const wz of zs) nodes.push({ wx, wy: load.planeCoord, wz });
      }
    } else {
      for (const wy of ys) {
        for (const wz of zs) nodes.push({ wx: load.planeCoord, wy, wz });
      }
    }
    return nodes;
  }

  resolveConstraintNodes(constraint) {
    const { xs, ys, zs } = this.getNodeCoords();
    const nodes = [];
    if (constraint.plane === "XY") {
      for (const wx of xs) {
        for (const wy of ys) nodes.push({ wx, wy, wz: constraint.planeCoord });
      }
    } else if (constraint.plane === "XZ") {
      for (const wx of xs) {
        for (const wz of zs) nodes.push({ wx, wy: constraint.planeCoord, wz });
      }
    } else {
      for (const wy of ys) {
        for (const wz of zs) nodes.push({ wx: constraint.planeCoord, wy, wz });
      }
    }
    return nodes;
  }

  drawConstraintInView(constraint, axisA, axisB, mapA, mapB) {
    const fixed = this.fixedDofs(constraint);
    if (!fixed.has(axisA) && !fixed.has(axisB)) return "";
    const color = constraintColor(constraint.colorIndex);
    const seen = new Set();
    let out = "";
    for (const node of this.resolveConstraintNodes(constraint)) {
      const worldA = node[`w${axisA.toLowerCase()}`];
      const worldB = node[`w${axisB.toLowerCase()}`];
      const key = `${worldA},${worldB}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out += this.nodeConstraintSymbol(mapA(worldA), mapB(worldB), fixed, axisA, axisB, color);
    }
    return out;
  }

  drawMeshGrid(horizontalValues, verticalValues, mapH, mapV) {
    let out = "";
    for (const horizontalValue of horizontalValues) {
      out += line(
        mapH(horizontalValue),
        mapV(verticalValues[0]),
        mapH(horizontalValue),
        mapV(verticalValues[verticalValues.length - 1]),
        { stroke: COLORS.meshEdge, "stroke-width": 0.8 }
      );
    }
    for (const verticalValue of verticalValues) {
      out += line(
        mapH(horizontalValues[0]),
        mapV(verticalValue),
        mapH(horizontalValues[horizontalValues.length - 1]),
        mapV(verticalValue),
        { stroke: COLORS.meshEdge, "stroke-width": 0.8 }
      );
    }
    return out;
  }

  drawMeshNodes(horizontalValues, verticalValues, mapH, mapV, loadColorMap, constraintColorMap) {
    let out = "";
    for (const horizontalValue of horizontalValues) {
      for (const verticalValue of verticalValues) {
        const key = `${toFixedNumber(horizontalValue, 6)},${toFixedNumber(verticalValue, 6)}`;
        out += this.nodeDot(
          mapH(horizontalValue),
          mapV(verticalValue),
          loadColorMap.get(key) ?? null,
          constraintColorMap.get(key) ?? null
        );
      }
    }
    return out;
  }

  loadLabel(load, showLabel) {
    if (!showLabel) return "";
    return load.type === "distributed" ? `${load.magnitude}N` : `${load.magnitude}N`;
  }

  nodeArrow(sx, sy, viewDirection, load, showLabel) {
    const arrowLength = LOAD_LENGTH[load.type] || LOAD_LENGTH.point;
    const label = this.loadLabel(load, showLabel);
    const color = loadColor(load.colorIndex);
    let out = "";
    if (viewDirection === "+z") {
      out += this.arrowLine(sx, sy + arrowLength, sx, sy, "up", color);
      if (label) out += text(sx + 4, sy + arrowLength + 10, label, this.loadTextAttrs(color));
    } else if (viewDirection === "-z") {
      out += this.arrowLine(sx, sy - arrowLength, sx, sy, "down", color);
      if (label) out += text(sx + 4, sy - arrowLength - 4, label, this.loadTextAttrs(color));
    } else if (viewDirection === "+x") {
      out += this.arrowLine(sx - arrowLength, sy, sx, sy, "right", color);
      if (label) out += text(sx - arrowLength - 2, sy - 4, label, { ...this.loadTextAttrs(color), "text-anchor": "end" });
    } else if (viewDirection === "-x") {
      out += this.arrowLine(sx + arrowLength, sy, sx, sy, "left", color);
      if (label) out += text(sx + arrowLength + 2, sy - 4, label, this.loadTextAttrs(color));
    } else if (viewDirection === "+y") {
      out += this.arrowLine(sx, sy + arrowLength, sx, sy, "up", color);
      if (label) out += text(sx + 4, sy + arrowLength + 10, label, this.loadTextAttrs(color));
    } else if (viewDirection === "-y") {
      out += this.arrowLine(sx, sy - arrowLength, sx, sy, "down", color);
      if (label) out += text(sx + 4, sy - arrowLength - 4, label, this.loadTextAttrs(color));
    }
    return out;
  }

  loadTextAttrs(color) {
    return {
      "font-size": 9,
      fill: color,
      "font-family": "JetBrains Mono",
    };
  }

  outOfPlane(sx, sy, comingOut, load, showLabel) {
    const color = loadColor(load.colorIndex);
    let out = el("circle", {
      cx: sx,
      cy: sy,
      r: 5,
      fill: "none",
      stroke: color,
      "stroke-width": 1.5,
    });
    if (comingOut) {
      out += el("circle", { cx: sx, cy: sy, r: 2, fill: color });
    } else {
      out +=
        line(sx - 3.5, sy - 3.5, sx + 3.5, sy + 3.5, { stroke: color, "stroke-width": 1.5 }) +
        line(sx + 3.5, sy - 3.5, sx - 3.5, sy + 3.5, { stroke: color, "stroke-width": 1.5 });
    }
    if (showLabel) out += text(sx + 8, sy + 4, `${load.magnitude}N`, this.loadTextAttrs(color));
    return out;
  }

  // Returns a Map<key, color> — first item wins if multiple overlap
  buildProjectedColorMap(axisA, axisB, sourceItems, resolver, colorFn) {
    const map = new Map();
    for (const item of sourceItems) {
      const color = colorFn(item.colorIndex);
      for (const node of resolver.call(this, item)) {
        const a = toFixedNumber(node[`w${axisA.toLowerCase()}`], 6);
        const b = toFixedNumber(node[`w${axisB.toLowerCase()}`], 6);
        const key = `${a},${b}`;
        if (!map.has(key)) map.set(key, color);
      }
    }
    return map;
  }

  renderFront(layout) {
    const { lx, lz } = this.state.dimensions;
    const { xs, zs } = this.getNodeCoords();
    const width = layout.col0;
    const height = layout.row1;
    const beamWidth = lx * layout.scale;
    const beamHeight = lz * layout.scale;
    const x0 = (width - beamWidth) / 2;
    const y0 = (height - beamHeight) / 2;
    const x1 = x0 + beamWidth;
    const y1 = y0 + beamHeight;
    const mapX = (wx) => x0 + (wx / lx) * beamWidth;
    const mapZ = (wz) => y1 - (wz / lz) * beamHeight;

    const loaded = this.buildProjectedColorMap("X", "Z", this.state.loads, this.resolveLoadNodes, loadColor);
    const constrained = this.buildProjectedColorMap("X", "Z", this.state.constraints, this.resolveConstraintNodes, constraintColor);

    let out = this.getDefs();
    out += this.axes(x0, y0, x1, y1, "X", "Z");
    out += rect(x0, y0, beamWidth, beamHeight, {
      fill: COLORS.beam,
      stroke: COLORS.beamStroke,
      "stroke-width": 1.5,
    });
    out += this.drawMeshGrid(xs, zs, mapX, mapZ);
    out += this.dimLine(x0, y0, x1, y0, `${toFixedNumber(lx, 2)} ${this.state.unitLabel}`, -22, true);
    out += this.dimLine(x1, y0, x1, y1, `${toFixedNumber(lz, 2)} ${this.state.unitLabel}`, 22, false);
    out += this.drawMeshNodes(xs, zs, mapX, mapZ, loaded, constrained);

    for (const load of this.state.loads) {
      const seen = new Set();
      let first = true;
      for (const { wx, wz } of this.resolveLoadNodes(load)) {
        const key = `${wx},${wz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sx = mapX(wx);
        const sz = mapZ(wz);
        const direction = normalizeDirection(load.direction);
        if (direction === "+y" || direction === "-y") {
          out += this.outOfPlane(sx, sz, direction === "+y", load, first);
        } else {
          out += this.nodeArrow(sx, sz, direction, load, first);
        }
        first = false;
      }
    }

    for (const constraint of this.state.constraints) {
      out += this.drawConstraintInView(constraint, "X", "Z", mapX, mapZ);
    }

    this.svgFront.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svgFront.innerHTML = out;
  }

  renderTop(layout) {
    const { lx, ly } = this.state.dimensions;
    const { xs, ys } = this.getNodeCoords();
    const width = layout.col0;
    const height = layout.row0;
    const beamWidth = lx * layout.scale;
    const beamHeight = ly * layout.scale;
    const x0 = (width - beamWidth) / 2;
    const y0 = (height - beamHeight) / 2;
    const x1 = x0 + beamWidth;
    const y1 = y0 + beamHeight;
    const mapX = (wx) => x0 + (wx / lx) * beamWidth;
    const mapY = (wy) => y1 - (wy / ly) * beamHeight;

    const loaded = this.buildProjectedColorMap("X", "Y", this.state.loads, this.resolveLoadNodes, loadColor);
    const constrained = this.buildProjectedColorMap("X", "Y", this.state.constraints, this.resolveConstraintNodes, constraintColor);

    let out = this.getDefs();
    out += this.axes(x0, y0, x1, y1, "X", "Y");
    out += rect(x0, y0, beamWidth, beamHeight, {
      fill: COLORS.beam,
      stroke: COLORS.beamStroke,
      "stroke-width": 1.5,
    });
    out += this.drawMeshGrid(xs, ys, mapX, mapY);
    out += this.dimLine(x0, y0, x1, y0, `${toFixedNumber(lx, 2)} ${this.state.unitLabel}`, -22, true);
    out += this.dimLine(x1, y0, x1, y1, `${toFixedNumber(ly, 2)} ${this.state.unitLabel}`, 22, false);
    out += this.drawMeshNodes(xs, ys, mapX, mapY, loaded, constrained);

    for (const load of this.state.loads) {
      const seen = new Set();
      let first = true;
      for (const { wx, wy } of this.resolveLoadNodes(load)) {
        const key = `${wx},${wy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sx = mapX(wx);
        const sy = mapY(wy);
        const direction = normalizeDirection(load.direction);
        if (direction === "+z" || direction === "-z") {
          out += this.outOfPlane(sx, sy, direction === "-z", load, first);
        } else {
          out += this.nodeArrow(sx, sy, direction, load, first);
        }
        first = false;
      }
    }

    for (const constraint of this.state.constraints) {
      out += this.drawConstraintInView(constraint, "X", "Y", mapX, mapY);
    }

    this.svgTop.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svgTop.innerHTML = out;
  }

  renderRight(layout) {
    const { ly, lz } = this.state.dimensions;
    const { ys, zs } = this.getNodeCoords();
    const width = layout.col1;
    const height = layout.row1;
    const beamWidth = ly * layout.scale;
    const beamHeight = lz * layout.scale;
    const x0 = (width - beamWidth) / 2;
    const y0 = (height - beamHeight) / 2;
    const x1 = x0 + beamWidth;
    const y1 = y0 + beamHeight;
    const mapY = (wy) => x0 + (wy / ly) * beamWidth;
    const mapZ = (wz) => y1 - (wz / lz) * beamHeight;

    const loaded = this.buildProjectedColorMap("Y", "Z", this.state.loads, this.resolveLoadNodes, loadColor);
    const constrained = this.buildProjectedColorMap("Y", "Z", this.state.constraints, this.resolveConstraintNodes, constraintColor);

    let out = this.getDefs();
    out += this.axes(x0, y0, x1, y1, "Y", "Z");
    out += rect(x0, y0, beamWidth, beamHeight, {
      fill: COLORS.beam,
      stroke: COLORS.beamStroke,
      "stroke-width": 1.5,
    });
    out += this.drawMeshGrid(ys, zs, mapY, mapZ);
    out += this.dimLine(x0, y0, x1, y0, `${toFixedNumber(ly, 2)} ${this.state.unitLabel}`, -22, true);
    out += this.dimLine(x1, y0, x1, y1, `${toFixedNumber(lz, 2)} ${this.state.unitLabel}`, 22, false);
    out += this.drawMeshNodes(ys, zs, mapY, mapZ, loaded, constrained);

    for (const load of this.state.loads) {
      const seen = new Set();
      let first = true;
      for (const { wy, wz } of this.resolveLoadNodes(load)) {
        const key = `${wy},${wz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sy = mapY(wy);
        const sz = mapZ(wz);
        const direction = normalizeDirection(load.direction);
        if (direction === "+x" || direction === "-x") {
          out += this.outOfPlane(sy, sz, direction === "+x", load, first);
        } else if (direction === "+y") {
          out += this.nodeArrow(sy, sz, "+x", load, first);
        } else if (direction === "-y") {
          out += this.nodeArrow(sy, sz, "-x", load, first);
        } else {
          out += this.nodeArrow(sy, sz, direction, load, first);
        }
        first = false;
      }
    }

    for (const constraint of this.state.constraints) {
      out += this.drawConstraintInView(constraint, "Y", "Z", mapY, mapZ);
    }

    this.svgRight.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svgRight.innerHTML = out;
  }

  render() {
    if (!this.grid.isConnected) return;
    const layout = this.computeLayout();
    this.applyLayout(layout);
    this.renderTop(layout);
    this.renderFront(layout);
    this.renderRight(layout);
  }
}

export function describeLoad(load, unitLabel = "mm") {
  if (load.type === "point") {
    return `${load.magnitude}N ${axisLabel(load.direction)} @ (${toFixedNumber(load.px)}, ${toFixedNumber(load.py)}, ${toFixedNumber(load.pz)}) ${unitLabel}`;
  }
  return `${load.magnitude}N ${axisLabel(load.direction)} on ${load.plane} @ ${toFixedNumber(load.planeCoord)} ${unitLabel}`;
}

export function describeConstraint(constraint, unitLabel = "mm") {
  if (constraint.type === "fixed") {
    return `Fixed on ${constraint.plane} @ ${toFixedNumber(constraint.planeCoord)} ${unitLabel}`;
  }
  if (constraint.type === "roller") {
    return `Roller (${constraint.fixedDOF} fixed) on ${constraint.plane} @ ${toFixedNumber(constraint.planeCoord)} ${unitLabel}`;
  }
  return `Guided (${constraint.freeDOF} free) on ${constraint.plane} @ ${toFixedNumber(constraint.planeCoord)} ${unitLabel}`;
}

export function planeCoordinateLabel(plane, unitLabel = "mm") {
  const axis = planeAxis(plane);
  return `${axis} (${unitLabel})`;
}
