// Large, labeled infrastructure schematics for the one-shot connection guide.
//
// These deliberately describe topology rather than drawing literal machinery.
// Every important object is a named blueprint box and every utility run is a
// labeled dotted route, so the guide answers "what connects to what?" before a
// player has learned the silhouettes of the catalogue items.

const W = 640;
const H = 184;

function mix(hex, target, amount) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const to = Number.parseInt(target.replace('#', ''), 16);
  const channel = shift => Math.round(
    ((value >> shift) & 0xff) * (1 - amount) + ((to >> shift) & 0xff) * amount,
  );
  return `#${[16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

function palette(accent) {
  return {
    background: '#07101b',
    grid: mix(accent, '#07101b', 0.86),
    gridMajor: mix(accent, '#07101b', 0.72),
    panel: '#0b1928',
    panelHi: '#102439',
    ink: '#dcecff',
    muted: '#91a9c1',
    accent,
    accentDim: mix(accent, '#07101b', 0.52),
    accentSoft: mix(accent, '#dcecff', 0.28),
    returnLine: '#f18a70',
    boundary: '#75849b',
  };
}

function titleLines(title) {
  return Array.isArray(title) ? title : [title];
}

function node(title, detail, x, y, w, h, extra = {}) {
  return { title, detail, x, y, w, h, ...extra };
}

function connection(points, label, labelAt, extra = {}) {
  return { points, label, labelAt, ...extra };
}

// Kept declarative so topology-sensitive tests can pin the same boxes and
// branches the player sees instead of inspecting private drawing helpers.
export const CONNECTION_GUIDE_SCHEMATICS = Object.freeze({
  power: {
    code: 'PWR-01',
    nodes: [
      node('HV SUPPLY', 'CAPACITY SOURCE', 20, 55, 142, 74, { tag: '01' }),
      node(['DISTRIBUTION', 'PANEL'], 'BRANCH OUTLETS', 238, 44, 176, 96, { tag: '02' }),
      node(['EQUIPMENT', '01'], '', 520, 14, 100, 44, { compact: true }),
      node(['EQUIPMENT', '02'], '', 520, 70, 100, 44, { compact: true }),
      node(['EQUIPMENT', '03'], '', 520, 126, 100, 44, { compact: true }),
    ],
    connections: [
      connection([[162, 92], [238, 92]], 'HV FEEDER', [200, 28]),
      connection([[414, 92], [458, 92]], 'POWER CABLES', [466, 92], { arrow: false }),
      connection([[458, 92], [458, 36], [520, 36]], '', null),
      connection([[458, 92], [520, 92]], '', null),
      connection([[458, 92], [458, 148], [520, 148]], '', null),
    ],
  },
  vacuum: {
    code: 'VAC-02',
    nodes: [
      node('ROUGH PUMP', 'PUMP-DOWN', 20, 116, 142, 50, { tag: '01' }),
      node(['TURBO / UHV', 'PUMP'], 'HIGH VACUUM', 216, 105, 150, 61, { tag: '02' }),
      node('BEAM VOLUME', 'SHARED VACUUM', 366, 52, 254, 52, { tag: '03' }),
      node('PRESSURE GAUGE', 'LINE TAP', 462, 6, 158, 36, { compact: true }),
    ],
    connections: [
      connection([[162, 141], [216, 141]], 'BACKING LINE', [189, 91]),
      connection([[291, 105], [291, 78], [366, 78]], 'VACUUM PIPE', [323, 30]),
      connection([[541, 42], [541, 52]], 'GAUGE TAP', [410, 18]),
    ],
  },
  rfPower: {
    code: 'RF-03',
    nodes: [
      node('HV SUPPLY', 'TRANSFORMER', 20, 58, 142, 68, { tag: '01' }),
      node('RF SOURCE', 'MATCH FREQUENCY', 246, 47, 152, 90, { tag: '02' }),
      node('RF CAVITY', 'SAME BAND', 494, 58, 126, 68, { tag: '03' }),
    ],
    connections: [
      connection([[162, 92], [246, 92]], 'HV FEEDER', [204, 70]),
      connection([[398, 92], [494, 92]], 'RF WAVEGUIDE', [446, 70]),
    ],
  },
  cooling: {
    code: 'CLG-04',
    nodes: [
      node('STORAGE', 'WATER INVENTORY', 20, 67, 136, 60, { tag: '01' }),
      node('CHILLER', 'PROCESS COOLING', 216, 20, 140, 62, { tag: '02' }),
      node('EQUIPMENT', 'HEAT LOAD', 438, 20, 158, 62, { tag: '03' }),
      node(['HEAT', 'REJECTOR'], 'REJECTS HEAT', 438, 116, 158, 54, { tag: '04' }),
    ],
    connections: [
      connection([[156, 97], [186, 97], [186, 51], [216, 51]], 'COOLING WATER', [140, 34]),
      connection([[356, 51], [438, 51]], 'SUPPLY', [397, 29]),
      connection([[517, 82], [517, 116]], 'WARM WATER', [571, 99], { tone: 'return' }),
      connection([[438, 143], [186, 143], [186, 127], [156, 127]], 'RETURN LOOP', [297, 161], { tone: 'return' }),
    ],
  },
  dataControls: {
    code: 'DAT-05',
    nodes: [
      node(['CONTROL RACK', '/ SWITCH'], 'BANDWIDTH SOURCE', 20, 53, 168, 80, { tag: '01' }),
      node(['EQUIPMENT', '01'], '', 520, 14, 100, 44, { compact: true }),
      node(['EQUIPMENT', '02'], '', 520, 70, 100, 44, { compact: true }),
      node(['EQUIPMENT', '03'], '', 520, 126, 100, 44, { compact: true }),
    ],
    connections: [
      connection([[188, 93], [458, 93]], 'DATA FIBER', [323, 70], { arrow: false }),
      connection([[458, 93], [458, 36], [520, 36]], '', null),
      connection([[458, 93], [520, 93]], '', null),
      connection([[458, 93], [458, 148], [520, 148]], '', null),
    ],
  },
  ops: {
    code: 'OPS-06',
    boundaries: [
      { label: 'SHIELDED LOSS AREA', x: 224, y: 30, w: 220, h: 126 },
    ],
    nodes: [
      node('BEAMLINE', 'BEAM DELIVERY', 18, 67, 138, 60, { tag: '01' }),
      node(['COOLED', 'BEAM DUMP'], 'LOSS POINT', 264, 67, 142, 60, { tag: '02' }),
      node(['REMOTE', 'HANDLING'], 'SERVICE TARGETS', 482, 14, 138, 56, { tag: '03' }),
      node('COOLING', 'SUPPLY + RETURN', 482, 120, 138, 50, { tag: '04' }),
    ],
    connections: [
      connection([[156, 97], [264, 97]], 'FULL BEAM', [210, 75]),
      connection([[482, 42], [444, 42], [444, 80], [406, 80]], 'SERVICE ARM', [475, 94]),
      connection([[482, 145], [430, 145], [430, 165], [335, 165], [335, 127]], 'COOLING WATER', [382, 145]),
    ],
  },
});

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawGrid(ctx, p, code) {
  rect(ctx, 0, 0, W, H, p.background);
  for (let x = 16; x < W; x += 24) {
    rect(ctx, x, 0, 1, H, x % 96 === 16 ? p.gridMajor : p.grid);
  }
  for (let y = 8; y < H; y += 24) {
    rect(ctx, 0, y, W, 1, y % 96 === 8 ? p.gridMajor : p.grid);
  }

  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = p.muted;
  ctx.fillText(code, 12, 10);
}

function drawArrow(ctx, from, to, color) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(
    to[0] - Math.cos(angle - Math.PI / 6) * size,
    to[1] - Math.sin(angle - Math.PI / 6) * size,
  );
  ctx.lineTo(
    to[0] - Math.cos(angle + Math.PI / 6) * size,
    to[1] - Math.sin(angle + Math.PI / 6) * size,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function connectionColor(connectionDef, p) {
  return connectionDef.tone === 'return' ? p.returnLine : p.accentSoft;
}

function drawConnectionPath(ctx, connectionDef, p) {
  const { points } = connectionDef;
  const color = connectionColor(connectionDef, p);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();

  if (connectionDef.arrow !== false && points.length > 1) {
    drawArrow(ctx, points.at(-2), points.at(-1), color);
  }
}

function drawConnectionLabel(ctx, connectionDef, p) {
  if (!connectionDef.label || !connectionDef.labelAt) return;
  const [x, y] = connectionDef.labelAt;
  ctx.save();
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(connectionDef.label).width + 12;
  rect(ctx, x - width / 2, y - 10, width, 20, p.background);
  ctx.strokeStyle = connectionColor(connectionDef, p);
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x - width / 2), Math.round(y - 10), Math.round(width), 20);
  ctx.fillStyle = p.ink;
  ctx.fillText(connectionDef.label, x, y + 1);
  ctx.restore();
}

function drawBoundary(ctx, boundary, p) {
  ctx.save();
  ctx.strokeStyle = p.boundary;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(boundary.x, boundary.y, boundary.w, boundary.h);
  ctx.font = "11px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelWidth = ctx.measureText(boundary.label).width + 14;
  rect(ctx, boundary.x + boundary.w / 2 - labelWidth / 2, boundary.y - 10, labelWidth, 20, p.background);
  ctx.fillStyle = p.muted;
  ctx.fillText(boundary.label, boundary.x + boundary.w / 2, boundary.y);
  ctx.restore();
}

function drawNode(ctx, nodeDef, p) {
  const { x, y, w, h } = nodeDef;
  rect(ctx, x, y, w, h, p.panel);
  rect(ctx, x + 3, y + 3, w - 6, h - 6, p.panelHi);
  rect(ctx, x + 5, y + 5, w - 10, h - 10, p.panel);

  ctx.save();
  ctx.strokeStyle = p.accentSoft;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // BLT corner notches make these read as game-native schematic modules,
  // without turning them back into tiny illustrations of the hardware.
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 3;
  for (const [sx, sy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    const dx = sx === x ? 1 : -1;
    const dy = sy === y ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(sx, sy + dy * 11);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx + dx * 11, sy);
    ctx.stroke();
  }

  if (nodeDef.tag) {
    rect(ctx, x + 7, y + 7, 22, 16, p.accentDim);
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.ink;
    ctx.fillText(nodeDef.tag, x + 18, y + 15);
  }

  const lines = titleLines(nodeDef.title);
  const titleSize = nodeDef.compact ? 11 : 14;
  const lineHeight = nodeDef.compact ? 15 : 19;
  const detailSpace = nodeDef.detail ? 13 : 0;
  const blockHeight = lines.length * lineHeight + detailSpace;
  let textY = y + (h - blockHeight) / 2 + lineHeight / 2;
  ctx.font = `${titleSize}px 'Press Start 2P', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.ink;
  for (const line of lines) {
    ctx.fillText(line, x + w / 2, textY);
    textY += lineHeight;
  }
  if (nodeDef.detail) {
    ctx.font = "11px monospace";
    ctx.fillStyle = p.muted;
    ctx.fillText(nodeDef.detail, x + w / 2, textY + 2);
  }
  ctx.restore();
}

function drawSchematic(ctx, p, schematic) {
  drawGrid(ctx, p, schematic.code);
  for (const boundary of schematic.boundaries || []) drawBoundary(ctx, boundary, p);
  for (const connectionDef of schematic.connections) drawConnectionPath(ctx, connectionDef, p);
  for (const nodeDef of schematic.nodes) drawNode(ctx, nodeDef, p);
  for (const connectionDef of schematic.connections) drawConnectionLabel(ctx, connectionDef, p);
}

export const CONNECTION_GUIDE_DIAGRAMS = Object.freeze(
  Object.fromEntries(Object.entries(CONNECTION_GUIDE_SCHEMATICS).map(([key, schematic]) => [
    key,
    (ctx, p) => drawSchematic(ctx, p, schematic),
  ])),
);

export function drawConnectionGuideDiagram(canvas, diagram, accent) {
  const draw = CONNECTION_GUIDE_DIAGRAMS[diagram];
  const ctx = canvas?.getContext?.('2d');
  if (!draw || !ctx) return false;

  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  draw(ctx, palette(accent));
  return true;
}
