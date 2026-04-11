const svg = document.querySelector("#board");
const form = document.querySelector("#game-form");
const sideLengthInput = document.querySelector("#side-length-input");
const tilePalette = document.querySelector("#tile-palette");
const rotateLeftButton = document.querySelector("#rotate-left-button");
const rotateRightButton = document.querySelector("#rotate-right-button");
const boardRotateLeftButton = document.querySelector("#board-rotate-left-button");
const boardRotateRightButton = document.querySelector("#board-rotate-right-button");
const rotationReadout = document.querySelector("#rotation-readout");
const snapToggle = document.querySelector("#snap-toggle");
const pointsToggle = document.querySelector("#points-toggle");
const saveButton = document.querySelector("#save-button");
const forkButton = document.querySelector("#fork-button");

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_SIZE = 1000;
const VIEW_CENTER = VIEWBOX_SIZE / 2;
const STEP_ANGLE = Math.PI / 5;
const EPSILON = 1e-8;
const SNAP_DISTANCE_PX = 24;
const POINTER_ANCHOR_INDEX = 0;
const TILE_VARIANTS = [
  { id: "thin-acute", rhombType: "thin", curveType: "acute", label: "Thin Acute" },
  { id: "thin-obtuse", rhombType: "thin", curveType: "obtuse", label: "Thin Obtuse" },
  { id: "thin-across_1", rhombType: "thin", curveType: "across_1", label: "Thin Across 1" },
  { id: "thin-across_2", rhombType: "thin", curveType: "across_2", label: "Thin Across 2" },
  { id: "thick-acute", rhombType: "thick", curveType: "acute", label: "Thick Acute" },
  { id: "thick-obtuse", rhombType: "thick", curveType: "obtuse", label: "Thick Obtuse" },
  { id: "thick-across_1", rhombType: "thick", curveType: "across_1", label: "Thick Across 1" },
  { id: "thick-across_2", rhombType: "thick", curveType: "across_2", label: "Thick Across 2" },
];

const state = {
  sideLength: 2,
  selectedTileVariantId: "thin-acute",
  orientationIndex: 0,
  boardRotationSteps: 0,
  snapEnabled: true,
  showPoints: true,
  board: null,
  tiles: [],
  pointerWorld: null,
  preview: null,
  suppressPlacementClick: false,
};

function point(x, y) {
  return { x, y };
}

function add(a, b) {
  return point(a.x + b.x, a.y + b.y);
}

function subtract(a, b) {
  return point(a.x - b.x, a.y - b.y);
}

function scale(value, factor) {
  return point(value.x * factor, value.y * factor);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function rotate(value, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return point(
    value.x * cosine - value.y * sine,
    value.x * sine + value.y * cosine
  );
}

function encodeBoardState(value) {
  return btoa(JSON.stringify(value));
}

function decodeBoardState(value) {
  return JSON.parse(atob(value));
}

function average(points) {
  const total = points.reduce((sum, current) => add(sum, current), point(0, 0));
  return scale(total, 1 / points.length);
}

function lerp(a, b, amount) {
  return point(
    a.x + (b.x - a.x) * amount,
    a.y + (b.y - a.y) * amount
  );
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointKey(value) {
  return `${value.x.toFixed(6)},${value.y.toFixed(6)}`;
}

function polygonArea(vertices) {
  let total = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    total += current.x * next.y - next.x * current.y;
  }

  return Math.abs(total) / 2;
}

function polygonCentroid(vertices) {
  return average(vertices);
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

function normalize(value) {
  const length = Math.hypot(value.x, value.y);

  if (length <= EPSILON) {
    return point(0, 0);
  }

  return point(value.x / length, value.y / length);
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
}

function fitTransform(points, padding = 90) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const value of points) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x);
    maxY = Math.max(maxY, value.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const scaleFactor = Math.min(
    (VIEWBOX_SIZE - padding * 2) / width,
    (VIEWBOX_SIZE - padding * 2) / height
  );

  return {
    scale: scaleFactor,
    center: point((minX + maxX) / 2, (minY + maxY) / 2),
  };
}

function toViewPoint(value) {
  const rotated = rotate(value, boardRotationAngle());
  return point(
    VIEW_CENTER + (rotated.x - state.board.transform.center.x) * state.board.transform.scale,
    VIEW_CENTER - (rotated.y - state.board.transform.center.y) * state.board.transform.scale
  );
}

function toWorldPoint(viewValue) {
  const rotatedPoint = point(
    (viewValue.x - VIEW_CENTER) / state.board.transform.scale + state.board.transform.center.x,
    (VIEW_CENTER - viewValue.y) / state.board.transform.scale + state.board.transform.center.y
  );
  return rotate(rotatedPoint, -boardRotationAngle());
}

function pointsToString(points) {
  return points
    .map((value) => {
      const viewValue = toViewPoint(value);
      return `${viewValue.x.toFixed(2)},${viewValue.y.toFixed(2)}`;
    })
    .join(" ");
}

function pathToString(commands) {
  return commands
    .map((command) => {
      if (command.type === "M") {
        const target = toViewPoint(command.point);
        return `M ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
      }

      const controlA = toViewPoint(command.controlA);
      const controlB = toViewPoint(command.controlB);
      const target = toViewPoint(command.point);
      return `C ${controlA.x.toFixed(2)} ${controlA.y.toFixed(2)} ${controlB.x.toFixed(2)} ${controlB.y.toFixed(2)} ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
    })
    .join(" ");
}

function pathToStringWithTransform(commands, transformPoint) {
  return commands
    .map((command) => {
      if (command.type === "M") {
        const target = transformPoint(command.point);
        return `M ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
      }

      const controlA = transformPoint(command.controlA);
      const controlB = transformPoint(command.controlB);
      const target = transformPoint(command.point);
      return `C ${controlA.x.toFixed(2)} ${controlA.y.toFixed(2)} ${controlB.x.toFixed(2)} ${controlB.y.toFixed(2)} ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
    })
    .join(" ");
}

function uniquePoints(points) {
  const seen = new Map();

  for (const value of points) {
    seen.set(pointKey(value), value);
  }

  return [...seen.values()];
}

function buildRegularDecagon(sideLength) {
  const circumradius = sideLength / (2 * Math.sin(Math.PI / 10));
  const startAngle = -Math.PI / 2 - Math.PI / 10;
  const vertices = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = startAngle + index * STEP_ANGLE;
    vertices.push(point(circumradius * Math.cos(angle), circumradius * Math.sin(angle)));
  }

  const unitBoundaryPoints = [];

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const edgeVector = subtract(next, current);

    for (let step = 0; step <= sideLength; step += 1) {
      unitBoundaryPoints.push(add(current, scale(edgeVector, step / sideLength)));
    }
  }

  return {
    sideLength,
    vertices,
    area: polygonArea(vertices),
    transform: fitTransform(vertices),
    unitBoundaryPoints: uniquePoints(unitBoundaryPoints),
  };
}

function tilePrototype(type) {
  const acuteAngle = type === "thin" ? Math.PI / 5 : (2 * Math.PI) / 5;
  const vertices = [
    point(0, 0),
    point(1, 0),
    point(1 + Math.cos(acuteAngle), Math.sin(acuteAngle)),
    point(Math.cos(acuteAngle), Math.sin(acuteAngle)),
  ];

  return {
    vertices,
    area: Math.sin(acuteAngle),
    center: polygonCentroid(vertices),
  };
}

function selectedVariant() {
  return TILE_VARIANTS.find((variant) => variant.id === state.selectedTileVariantId) ?? TILE_VARIANTS[0];
}

function boardRotationAngle() {
  return state.boardRotationSteps * STEP_ANGLE;
}

function transformPrototype(vertices, orientationIndex) {
  const angle = orientationIndex * STEP_ANGLE;
  return vertices.map((value) => rotate(value, angle));
}

function polygonFromCenter(type, orientationIndex, center) {
  const prototype = tilePrototype(type);
  const rotated = transformPrototype(prototype.vertices, orientationIndex);
  const rotatedCenter = rotate(prototype.center, orientationIndex);
  const offset = subtract(center, rotatedCenter);
  return rotated.map((value) => add(value, offset));
}

function polygonFromAnchor(type, orientationIndex, anchorIndex, anchorPoint) {
  const prototype = tilePrototype(type);
  const rotated = transformPrototype(prototype.vertices, orientationIndex);
  const offset = subtract(anchorPoint, rotated[anchorIndex]);
  return rotated.map((value) => add(value, offset));
}

function pointInsideConvexPolygon(testPoint, polygon) {
  let sign = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const turn = cross(subtract(next, current), subtract(testPoint, current));

    if (Math.abs(turn) <= EPSILON) {
      continue;
    }

    const nextSign = Math.sign(turn);
    if (sign === 0) {
      sign = nextSign;
      continue;
    }

    if (sign !== nextSign) {
      return false;
    }
  }

  return true;
}

function inwardEdgeNormal(points, edgeIndex, center) {
  const start = points[edgeIndex];
  const end = points[(edgeIndex + 1) % points.length];
  const edge = subtract(end, start);
  const midpointValue = midpoint(start, end);
  const candidate = normalize(point(-edge.y, edge.x));
  const toCenter = subtract(center, midpointValue);
  return dot(candidate, toCenter) >= 0 ? candidate : scale(candidate, -1);
}

function symmetricCurveCommands(points, startEdge, endEdge, pullRatio = 0.58) {
  const edgeMidpoints = [
    midpoint(points[0], points[1]),
    midpoint(points[1], points[2]),
    midpoint(points[2], points[3]),
    midpoint(points[3], points[0]),
  ];
  const center = polygonCentroid(points);
  const start = edgeMidpoints[startEdge];
  const end = edgeMidpoints[endEdge];
  const startNormal = inwardEdgeNormal(points, startEdge, center);
  const endNormal = inwardEdgeNormal(points, endEdge, center);
  const pull = Math.hypot(end.x - start.x, end.y - start.y) * pullRatio;

  return [
    { type: "M", point: start },
    {
      type: "C",
      controlA: add(start, scale(startNormal, pull)),
      controlB: add(end, scale(endNormal, pull)),
      point: end,
    },
  ];
}

function curvePathCommands(points, curveType, rhombType) {
  if (curveType === "acute") {
    return symmetricCurveCommands(points, 3, 0, rhombType === "thin" ? 0.6 : 0.59);
  }

  if (curveType === "obtuse") {
    return symmetricCurveCommands(points, 0, 1, rhombType === "thin" ? 0.54 : 0.68);
  }

  if (curveType === "across_1") {
    return symmetricCurveCommands(points, 0, 2, 0.42);
  }

  return symmetricCurveCommands(points, 1, 3, 0.42);
}

function projectPolygon(axis, polygon) {
  let min = Infinity;
  let max = -Infinity;

  for (const value of polygon) {
    const projection = dot(axis, value);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  return { min, max };
}

function axesForPolygon(polygon) {
  const axes = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const edge = subtract(next, current);
    const normal = point(-edge.y, edge.x);
    const length = Math.hypot(normal.x, normal.y);
    axes.push(point(normal.x / length, normal.y / length));
  }

  return axes;
}

function polygonsOverlapWithArea(a, b) {
  const axes = [...axesForPolygon(a), ...axesForPolygon(b)];

  for (const axis of axes) {
    const projectionA = projectPolygon(axis, a);
    const projectionB = projectPolygon(axis, b);

    if (projectionA.max <= projectionB.min + EPSILON || projectionB.max <= projectionA.min + EPSILON) {
      return false;
    }
  }

  return true;
}

function validatePlacement(polygon) {
  if (!polygon.every((value) => pointInsideConvexPolygon(value, state.board.vertices))) {
    return { valid: false, reason: "The tile extends beyond the decagon boundary." };
  }

  for (const tile of state.tiles) {
    if (polygonsOverlapWithArea(polygon, tile.points)) {
      return { valid: false, reason: "The tile overlaps a rhomb that is already placed." };
    }
  }

  return { valid: true, reason: "Valid placement." };
}

function getSnapCandidates() {
  const placedVertices = state.tiles.flatMap((tile) => tile.points);
  return uniquePoints([...state.board.unitBoundaryPoints, ...placedVertices]);
}

function createPreview(pointerWorld) {
  if (!pointerWorld) {
    return null;
  }

  const variant = selectedVariant();
  const freePolygon = polygonFromAnchor(
    variant.rhombType,
    state.orientationIndex,
    POINTER_ANCHOR_INDEX,
    pointerWorld
  );
  const freeValidation = validatePlacement(freePolygon);
  const freePreview = {
    points: freePolygon,
    center: polygonCentroid(freePolygon),
    anchor: pointerWorld,
    snapped: false,
    ...freeValidation,
  };

  if (!state.snapEnabled) {
    return freePreview;
  }

  const pointerView = toViewPoint(pointerWorld);
  let bestSnap = null;

  for (const candidate of getSnapCandidates()) {
    const candidateView = toViewPoint(candidate);
    const candidateDistance = Math.hypot(candidateView.x - pointerView.x, candidateView.y - pointerView.y);

    if (candidateDistance > SNAP_DISTANCE_PX) {
      continue;
    }

    for (let anchorIndex = 0; anchorIndex < 4; anchorIndex += 1) {
      const polygon = polygonFromAnchor(variant.rhombType, state.orientationIndex, anchorIndex, candidate);
      const validation = validatePlacement(polygon);

      if (!validation.valid) {
        continue;
      }

      const center = polygonCentroid(polygon);
      const score = distanceSquared(pointerView, candidateView);

      if (!bestSnap || score < bestSnap.score) {
        bestSnap = {
          points: polygon,
          center,
          anchor: candidate,
          snapped: true,
          score,
          ...validation,
        };
      }
    }
  }

  return bestSnap ?? freePreview;
}

function makeTile(type, points) {
  return {
    id: crypto.randomUUID(),
    type,
    curveType: selectedVariant().curveType,
    points,
    area: polygonArea(points),
  };
}

function totalCoveredArea() {
  return state.tiles.reduce((total, tile) => total + tile.area, 0);
}

function tileTotals() {
  return state.tiles.reduce(
    (totals, tile) => {
      totals[tile.type] += 1;
      return totals;
    },
    { thin: 0, thick: 0 }
  );
}

function setStatus(message) {
  return message;
}

function rotationDegrees() {
  return ((state.orientationIndex % 10) + 10) % 10 * 36;
}

function updateRotationReadout() {
  rotationReadout.textContent = `${rotationDegrees()}°`;
}

function renderBoard() {
  svg.replaceChildren();
  const variant = selectedVariant();

  const outline = createSvgElement("polygon", {
    class: "board-outline",
    points: pointsToString(state.board.vertices),
  });
  svg.append(outline);

  if (state.showPoints) {
    const pointLayer = createSvgElement("g");

    for (const value of state.board.unitBoundaryPoints) {
      const viewValue = toViewPoint(value);
      pointLayer.append(
        createSvgElement("circle", {
          class: "boundary-unit",
          cx: viewValue.x.toFixed(2),
          cy: viewValue.y.toFixed(2),
          r: "2.6",
        })
      );
    }

    for (const value of uniquePoints(state.tiles.flatMap((tile) => tile.points))) {
      const viewValue = toViewPoint(value);
      pointLayer.append(
        createSvgElement("circle", {
          class: "snap-point",
          cx: viewValue.x.toFixed(2),
          cy: viewValue.y.toFixed(2),
          r: "3.2",
        })
      );
    }

    svg.append(pointLayer);
  }

  const tilesLayer = createSvgElement("g");
  for (const tile of state.tiles) {
    const tilePolygon = createSvgElement("polygon", {
      class: `placed-tile ${tile.type}`,
      points: pointsToString(tile.points),
      "data-tile-id": tile.id,
    });
    tilePolygon.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      if (state.preview?.valid) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      removeTile(tile.id);
    });
    tilesLayer.append(tilePolygon);
    tilesLayer.append(
      createSvgElement("path", {
        class: "tile-curve placed-curve",
        d: pathToString(curvePathCommands(tile.points, tile.curveType, tile.type)),
      })
    );
  }
  svg.append(tilesLayer);

  if (state.preview) {
    svg.append(
      createSvgElement("polygon", {
        class: `preview ${state.preview.valid ? "valid" : "invalid"} ${variant.rhombType}`,
        points: pointsToString(state.preview.points),
      })
    );
    svg.append(
      createSvgElement("path", {
        class: "tile-curve preview-curve",
        d: pathToString(curvePathCommands(state.preview.points, variant.curveType, variant.rhombType)),
      })
    );

    if (state.preview.anchor) {
      const anchorView = toViewPoint(state.preview.anchor);
      svg.append(
        createSvgElement("circle", {
          class: "preview-anchor",
          cx: anchorView.x.toFixed(2),
          cy: anchorView.y.toFixed(2),
          r: "5",
        })
      );
    }
  }
}

function refreshPreview(updateMessage = true) {
  state.preview = createPreview(state.pointerWorld);
  renderBoard();
  const variant = selectedVariant();

  if (!updateMessage) {
    return;
  }

  if (!state.preview) {
    setStatus("Move the pointer into the decagon to position the current rhomb.");
    return;
  }

  if (state.preview.valid) {
    const snapMessage = state.preview.snapped ? " Snapped to a nearby vertex." : "";
    setStatus(`Valid ${variant.label.toLowerCase()} placement at ${rotationDegrees()}°.${snapMessage}`);
  } else {
    setStatus(state.preview.reason);
  }
}

function rebuildBoard(sideLength) {
  state.sideLength = sideLength;
  state.board = buildRegularDecagon(sideLength);
  state.tiles = [];
  state.pointerWorld = null;
  state.preview = null;
  updateRotationReadout();
  renderTilePalette();
  renderBoard();
  setStatus(`New regular decagon created with side length ${sideLength}.`);
  syncUrlToBoardState();
}

function serializeBoardState() {
  return {
    sideLength: state.sideLength,
    selectedTileVariantId: state.selectedTileVariantId,
    orientationIndex: state.orientationIndex,
    boardRotationSteps: state.boardRotationSteps,
    snapEnabled: state.snapEnabled,
    showPoints: state.showPoints,
    tiles: state.tiles.map((tile) => ({
      id: tile.id,
      type: tile.type,
      curveType: tile.curveType,
      points: tile.points.map((value) => [value.x, value.y]),
    })),
  };
}

function syncUrlToBoardState() {
  const url = new URL(window.location.href);
  url.hash = `board=${encodeBoardState(serializeBoardState())}`;
  window.history.replaceState(null, "", url);
}

function applySerializedBoardState(serialized) {
  state.sideLength = Math.max(1, Math.min(10, serialized.sideLength ?? 2));
  state.selectedTileVariantId = TILE_VARIANTS.some((variant) => variant.id === serialized.selectedTileVariantId)
    ? serialized.selectedTileVariantId
    : TILE_VARIANTS[0].id;
  state.orientationIndex = ((serialized.orientationIndex ?? 0) % 10 + 10) % 10;
  state.boardRotationSteps = ((serialized.boardRotationSteps ?? 0) % 10 + 10) % 10;
  state.snapEnabled = serialized.snapEnabled ?? true;
  state.showPoints = serialized.showPoints ?? true;
  sideLengthInput.value = String(state.sideLength);
  snapToggle.checked = state.snapEnabled;
  pointsToggle.checked = state.showPoints;
  state.board = buildRegularDecagon(state.sideLength);
  state.tiles = (serialized.tiles ?? []).map((tile) => {
    const points = tile.points.map(([x, y]) => point(x, y));
    return {
      id: tile.id ?? crypto.randomUUID(),
      type: tile.type,
      curveType: tile.curveType,
      points,
      area: polygonArea(points),
    };
  });
  state.pointerWorld = null;
  state.preview = null;
  state.suppressPlacementClick = false;
  updateRotationReadout();
  renderTilePalette();
  renderBoard();
  syncUrlToBoardState();
}

function placePreview() {
  if (!state.preview || !state.preview.valid) {
    return;
  }

  const placementWasSnapped = state.preview.snapped;
  state.tiles.push(makeTile(selectedVariant().rhombType, state.preview.points));
  renderTilePalette();
  state.preview = createPreview(state.pointerWorld);
  renderBoard();
  syncUrlToBoardState();

  const remaining = state.board.area - totalCoveredArea();
  if (remaining <= 1e-4) {
    setStatus(`Board covered. You filled the decagon with ${state.tiles.length} rhombs.`);
  } else {
    const snapMessage = placementWasSnapped ? " with snapping" : "";
    setStatus(`Placed one ${selectedVariant().label.toLowerCase()} tile${snapMessage}.`);
  }
}

function undoPlacement() {
  if (state.tiles.length === 0) {
    setStatus("Nothing to undo.");
    return;
  }

  const removed = state.tiles.pop();
  renderTilePalette();
  refreshPreview(false);
  setStatus(`Removed one ${removed.type} rhomb.`);
  syncUrlToBoardState();
}

function clearBoard() {
  state.tiles = [];
  renderTilePalette();
  refreshPreview(false);
  setStatus("Board cleared.");
  syncUrlToBoardState();
}

function removeTile(tileId) {
  const tileIndex = state.tiles.findIndex((tile) => tile.id === tileId);

  if (tileIndex === -1) {
    return;
  }

  const [removed] = state.tiles.splice(tileIndex, 1);
  state.suppressPlacementClick = true;
  renderTilePalette();
  refreshPreview(false);
  setStatus(`Removed one ${removed.type} rhomb.`);
  syncUrlToBoardState();
}

function renderTilePalette() {
  tilePalette.replaceChildren();
  const variantCounts = new Map(TILE_VARIANTS.map((variant) => [variant.id, 0]));

  for (const tile of state.tiles) {
    const variantId = `${tile.type}-${tile.curveType}`;
    variantCounts.set(variantId, (variantCounts.get(variantId) ?? 0) + 1);
  }

  for (const variant of TILE_VARIANTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tile-option${variant.id === state.selectedTileVariantId ? " active" : ""}`;
    button.dataset.tileVariantId = variant.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", variant.id === state.selectedTileVariantId ? "true" : "false");

    const previewPoints = polygonFromAnchor(variant.rhombType, 0, 0, point(0, 0));
    const minX = Math.min(...previewPoints.map((value) => value.x));
    const maxX = Math.max(...previewPoints.map((value) => value.x));
    const minY = Math.min(...previewPoints.map((value) => value.y));
    const maxY = Math.max(...previewPoints.map((value) => value.y));
    const width = maxX - minX;
    const height = maxY - minY;
    const scaleFactor = Math.min(54 / width, 38 / height);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const transformPoint = (value) => point(
      27 + (value.x - centerX) * scaleFactor,
      24 - (value.y - centerY) * scaleFactor
    );

    const polygonPoints = previewPoints.map((value) => {
      const transformed = transformPoint(value);
      return `${transformed.x.toFixed(2)},${transformed.y.toFixed(2)}`;
    }).join(" ");
    const curvePath = pathToStringWithTransform(
      curvePathCommands(previewPoints, variant.curveType, variant.rhombType),
      transformPoint
    );

    button.innerHTML = `
      <svg viewBox="0 0 54 54" aria-hidden="true">
        <polygon class="tile-option-shape ${variant.rhombType}" points="${polygonPoints}"></polygon>
        <path class="tile-option-curve" d="${curvePath}"></path>
      </svg>
      <span class="tile-option-meta">
        <span class="tile-option-count ${variant.rhombType}">${variantCounts.get(variant.id) ?? 0}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      setTileVariant(variant.id);
    });
    tilePalette.append(button);
  }
}

function setTileVariant(tileVariantId) {
  state.selectedTileVariantId = tileVariantId;
  renderTilePalette();
  refreshPreview();
  syncUrlToBoardState();
}

function rotateCurrent(delta) {
  state.orientationIndex = (state.orientationIndex + delta + 10) % 10;
  updateRotationReadout();
  refreshPreview();
  syncUrlToBoardState();
}

function pointerPositionFromEvent(event) {
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = event.clientX;
  svgPoint.y = event.clientY;
  const transform = svg.getScreenCTM();

  if (!transform) {
    return point(0, 0);
  }

  const localPoint = svgPoint.matrixTransform(transform.inverse());
  const viewPoint = point(localPoint.x, localPoint.y);
  return toWorldPoint(viewPoint);
}

function readSideLength() {
  const numericValue = Number.parseInt(sideLengthInput.value, 10);

  if (!Number.isFinite(numericValue)) {
    return 2;
  }

  return Math.max(1, Math.min(10, numericValue));
}

function saveBoardAsPng() {
  const exportSvg = svg.cloneNode(true);
  inlineComputedStyles(svg, exportSvg);
  exportSvg.setAttribute("xmlns", SVG_NS);
  const serializer = new XMLSerializer();
  const svgMarkup = serializer.serializeToString(exportSvg);
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const image = new Image();

  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = VIEWBOX_SIZE;
    canvas.height = VIEWBOX_SIZE;
    const context = canvas.getContext("2d");

    if (!context) {
      URL.revokeObjectURL(svgUrl);
      return;
    }

    context.drawImage(image, 0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE);
    URL.revokeObjectURL(svgUrl);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = "decagon.png";
    document.body.append(link);
    link.click();
    link.remove();
  };

  image.src = svgUrl;
}

function inlineComputedStyles(sourceNode, targetNode) {
  if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) {
    return;
  }

  const computed = window.getComputedStyle(sourceNode);
  const style = Array.from(computed)
    .map((property) => `${property}:${computed.getPropertyValue(property)};`)
    .join("");

  if (style) {
    targetNode.setAttribute("style", style);
  }

  const sourceChildren = Array.from(sourceNode.children);
  const targetChildren = Array.from(targetNode.children);

  for (let index = 0; index < sourceChildren.length; index += 1) {
    inlineComputedStyles(sourceChildren[index], targetChildren[index]);
  }
}

function forkBoard() {
  const url = new URL(window.location.href);
  url.hash = `board=${encodeBoardState(serializeBoardState())}`;
  window.open(url.toString(), "_blank", "noopener");
}

function rotateBoard(delta) {
  state.boardRotationSteps = (state.boardRotationSteps + delta + 10) % 10;
  refreshPreview(false);
  syncUrlToBoardState();
}

let touchActive = false;

svg.addEventListener("pointermove", (event) => {
  state.pointerWorld = pointerPositionFromEvent(event);
  refreshPreview();
});

svg.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") {
    return;
  }

  touchActive = true;
  state.pointerWorld = pointerPositionFromEvent(event);
  refreshPreview();
});

svg.addEventListener("pointerleave", () => {
  if (touchActive) {
    return;
  }
  state.pointerWorld = null;
  state.preview = null;
  renderBoard();
  setStatus("Move the pointer into the decagon to position the current rhomb.");
});

svg.addEventListener("touchend", () => {
  touchActive = false;
  if (state.suppressPlacementClick) {
    state.suppressPlacementClick = false;
  } else {
    placePreview();
  }
  state.pointerWorld = null;
  state.preview = null;
  renderBoard();
});

svg.addEventListener("touchcancel", () => {
  touchActive = false;
  state.pointerWorld = null;
  state.preview = null;
  state.suppressPlacementClick = false;
  renderBoard();
});

svg.addEventListener("click", () => {
  if (state.suppressPlacementClick) {
    state.suppressPlacementClick = false;
    return;
  }

  placePreview();
});

svg.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  state.pointerWorld = pointerPositionFromEvent(event);
  rotateCurrent(1);
});

rotateLeftButton.addEventListener("click", () => rotateCurrent(-1));
rotateRightButton.addEventListener("click", () => rotateCurrent(1));
boardRotateLeftButton.addEventListener("click", () => rotateBoard(-1));
boardRotateRightButton.addEventListener("click", () => rotateBoard(1));

snapToggle.addEventListener("change", () => {
  state.snapEnabled = snapToggle.checked;
  refreshPreview();
  syncUrlToBoardState();
});

pointsToggle.addEventListener("change", () => {
  state.showPoints = pointsToggle.checked;
  renderBoard();
  syncUrlToBoardState();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sideLengthInput.value = String(readSideLength());
  rebuildBoard(readSideLength());
});

saveButton.addEventListener("click", saveBoardAsPng);
forkButton.addEventListener("click", forkBoard);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (key === "q") {
    rotateCurrent(-1);
  }

  if (key === "e") {
    rotateCurrent(1);
  }

  if (key === "t") {
    const currentIndex = TILE_VARIANTS.findIndex((variant) => variant.id === state.selectedTileVariantId);
    const nextIndex = (currentIndex + 1) % TILE_VARIANTS.length;
    setTileVariant(TILE_VARIANTS[nextIndex].id);
  }
});

if (window.location.hash.startsWith("#board=")) {
  try {
    applySerializedBoardState(decodeBoardState(window.location.hash.slice(7)));
  } catch (_error) {
    rebuildBoard(state.sideLength);
  }
} else {
  rebuildBoard(state.sideLength);
}
