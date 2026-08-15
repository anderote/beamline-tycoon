// Pixel cutaways for the infrastructure connection guide. These use the same
// deliberately low-resolution, hard-edged drawing language as the Beamline
// Designer schematics, but depict the utility plant that sits around a line.

const W = 78;
const H = 50;
const AXIS_Y = 24;

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
    void: '#050611',
    ink: '#69728b',
    metal: '#8993aa',
    hi: '#c0cae0',
    dark: '#292e43',
    darker: '#15182a',
    accent,
    accentHi: mix(accent, '#ffffff', 0.42),
    accentDk: mix(accent, '#070812', 0.54),
    beam: '#e7f6ff',
    hot: '#ff9a62',
  };
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function dot(ctx, x, y, color, size = 1) {
  rect(ctx, x, y, size, size, color);
}

function dashed(ctx, x1, x2, y, color, dash = 3, gap = 3) {
  for (let x = x1; x <= x2; x += dash + gap) {
    rect(ctx, x, y, Math.min(dash, x2 - x + 1), 1, color);
  }
}

function disc(ctx, cx, cy, radius, color) {
  for (let y = -radius; y <= radius; y++) {
    const half = Math.floor(Math.sqrt(radius * radius - y * y));
    rect(ctx, cx - half, cy + y, half * 2 + 1, 1, color);
  }
}

function ring(ctx, cx, cy, radius, thickness, outer, inner) {
  disc(ctx, cx, cy, radius, outer);
  disc(ctx, cx, cy, Math.max(0, radius - thickness), inner);
}

function frame(ctx, x, y, w, h, p) {
  rect(ctx, x, y, w, h, p.dark);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, p.darker);
  rect(ctx, x + 2, y + 2, w - 4, 1, p.metal);
  rect(ctx, x + 2, y + h - 3, w - 4, 1, p.ink);
}

function port(ctx, side, y, p) {
  const x = side === 'left' ? 0 : W - 3;
  rect(ctx, x, y - 4, 3, 9, p.metal);
  rect(ctx, side === 'left' ? 3 : W - 4, y - 2, 1, 5, p.accentDk);
}

function pipe(ctx, x1, x2, y, p, beam = false) {
  rect(ctx, x1, y - 3, x2 - x1 + 1, 1, p.metal);
  rect(ctx, x1, y + 3, x2 - x1 + 1, 1, p.ink);
  rect(ctx, x1, y - 2, x2 - x1 + 1, 5, p.void);
  if (beam) dashed(ctx, x1, x2, y, p.beam, 2, 2);
}

function coil(ctx, x, y, w, h, p) {
  rect(ctx, x, y, w, h, p.accentDk);
  for (let ix = x + 1; ix < x + w - 1; ix += 3) rect(ctx, ix, y + 1, 1, h - 2, p.accentHi);
}

function arrow(ctx, x, y, direction, color) {
  const dx = direction === 'left' ? -1 : 1;
  rect(ctx, x - dx * 3, y, 4, 1, color);
  dot(ctx, x, y - 2, color);
  dot(ctx, x + dx, y - 1, color);
  dot(ctx, x + dx, y + 1, color);
  dot(ctx, x, y + 2, color);
}

function drawTransformer(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 18, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 59, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 18, 8, 42, 34, p);
  rect(ctx, 28, 13, 5, 23, p.ink);
  rect(ctx, 45, 13, 5, 23, p.ink);
  for (const x of [22, 35, 52]) {
    coil(ctx, x, 15, 5, 19, p);
    rect(ctx, x + 1, 10, 3, 5, p.metal);
  }
  rect(ctx, 21, 37, 36, 2, p.accentDk);
  dot(ctx, 56, 11, p.accentHi, 2);
}

function drawSwitchgear(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 13, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 65, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 13, 6, 52, 38, p);
  rect(ctx, 17, 11, 44, 3, p.accentDk);
  for (const x of [20, 31, 42, 53]) {
    rect(ctx, x, 14, 2, 19, p.metal);
    rect(ctx, x - 2, 20, 6, 6, p.accent);
    rect(ctx, x - 1, 21, 4, 2, p.void);
    dot(ctx, x, 36, x === 42 ? p.accentHi : p.ink, 2);
  }
  rect(ctx, 17, 40, 44, 1, p.ink);
}

function drawLoad(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  frame(ctx, 18, 8, 42, 33, p);
  rect(ctx, 21, 11, 36, 27, p.void);
  coil(ctx, 23, 12, 32, 8, p);
  coil(ctx, 23, 29, 32, 8, p);
  rect(ctx, 28, 20, 3, 9, p.metal);
  rect(ctx, 47, 20, 3, 9, p.metal);
  rect(ctx, 32, 22, 14, 5, p.darker);
  dashed(ctx, 32, 46, AXIS_Y, p.beam, 2, 2);
}

function drawVacuumPump(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  rect(ctx, 33, 27, 12, 3, p.metal);
  frame(ctx, 24, 30, 30, 18, p);
  rect(ctx, 27, 32, 24, 13, p.void);
  rect(ctx, 38, 32, 2, 13, p.accentDk);
  for (let y = 33; y <= 43; y += 3) {
    rect(ctx, 29, y, 9, 1, p.accentHi);
    rect(ctx, 40, y + 1, 9, 1, p.ink);
  }
  rect(ctx, 30, 48, 18, 2, p.metal);
}

function drawBeamline(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  rect(ctx, 14, 14, 3, 21, p.metal);
  rect(ctx, 61, 14, 3, 21, p.metal);
  rect(ctx, 18, 17, 42, 1, p.ink);
  rect(ctx, 18, 31, 42, 1, p.ink);
  for (const x of [24, 32, 40, 48, 56]) {
    dot(ctx, x, 20, p.accentDk);
    dot(ctx, x + 2, 28, p.accentDk);
  }
  dashed(ctx, 7, 71, AXIS_Y, p.beam, 2, 2);
}

function drawGauge(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  rect(ctx, 37, 19, 4, 6, p.metal);
  ring(ctx, 39, 10, 10, 2, p.metal, p.void);
  rect(ctx, 38, 9, 2, 2, p.accentHi);
  rect(ctx, 39, 5, 1, 5, p.accent);
  rect(ctx, 40, 10, 5, 1, p.accent);
  for (const [x, y] of [[33, 7], [36, 3], [42, 3], [46, 7]]) dot(ctx, x, y, p.ink);
  rect(ctx, 32, 39, 14, 2, p.ink);
}

function drawModulator(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 12, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 66, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 12, 5, 54, 40, p);
  for (const x of [17, 26, 35]) {
    rect(ctx, x, 11, 6, 18, p.accentDk);
    rect(ctx, x + 1, 12, 4, 2, p.accentHi);
    rect(ctx, x + 1, 26, 4, 2, p.ink);
  }
  coil(ctx, 47, 10, 12, 21, p);
  rect(ctx, 17, 34, 42, 2, p.metal);
  arrow(ctx, 56, 40, 'right', p.accentHi);
}

function drawRfSource(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  frame(ctx, 12, 8, 54, 33, p);
  rect(ctx, 16, 11, 46, 27, p.void);
  for (const x of [22, 31, 40, 49]) {
    ring(ctx, x, AXIS_Y, 7, 2, p.accentDk, p.void);
    rect(ctx, x - 1, 17, 3, 15, p.accentHi);
  }
  rect(ctx, 16, 14, 46, 2, p.ink);
  rect(ctx, 16, 34, 46, 2, p.ink);
  dashed(ctx, 5, 73, AXIS_Y, p.beam, 2, 2);
}

function drawRfCavity(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  pipe(ctx, 3, 75, AXIS_Y, p, true);
  for (const cx of [24, 34, 44, 54]) {
    ring(ctx, cx, AXIS_Y, 9, 3, p.metal, p.void);
    rect(ctx, cx - 1, 15, 3, 19, p.accentDk);
  }
  rect(ctx, 15, 12, 2, 25, p.ink);
  rect(ctx, 62, 12, 2, 25, p.ink);
  dashed(ctx, 4, 74, AXIS_Y, p.beam, 2, 2);
}

function drawWaterTank(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 17, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 61, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 17, 6, 44, 38, p);
  rect(ctx, 20, 10, 38, 29, p.void);
  rect(ctx, 20, 22, 38, 17, p.accentDk);
  for (let x = 20; x < 58; x += 6) {
    rect(ctx, x, 20 + ((x / 6) % 2), 4, 1, p.accentHi);
  }
  rect(ctx, 25, 13, 2, 6, p.metal);
  rect(ctx, 51, 13, 2, 6, p.metal);
  dot(ctx, 53, 11, p.accentHi, 2);
}

function drawChiller(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 12, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 66, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 12, 6, 54, 38, p);
  ring(ctx, 27, 25, 10, 3, p.accentDk, p.void);
  for (const [x, y] of [[27, 16], [35, 25], [27, 34], [19, 25]]) rect(ctx, x - 1, y - 3, 3, 7, p.accentHi);
  for (let x = 44; x <= 59; x += 3) rect(ctx, x, 12, 1, 25, x % 2 ? p.ink : p.metal);
  arrow(ctx, 57, 40, 'right', p.accentHi);
}

function drawHeatLoad(ctx, p) {
  drawLoad(ctx, p);
  for (const x of [29, 39, 49]) {
    dot(ctx, x, 7, p.hot);
    dot(ctx, x - 1, 5, p.hot);
    dot(ctx, x + 1, 3, p.hot);
  }
}

function drawDryCooler(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 11, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 67, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 11, 7, 56, 36, p);
  ring(ctx, 31, 25, 13, 2, p.metal, p.void);
  rect(ctx, 29, 12, 4, 26, p.accentDk);
  rect(ctx, 18, 23, 26, 4, p.accentDk);
  rect(ctx, 29, 23, 4, 4, p.accentHi);
  for (let x = 50; x <= 61; x += 3) rect(ctx, x, 11, 1, 28, p.ink);
  for (const x of [52, 58]) arrow(ctx, x, 4, 'right', p.accentHi);
}

function drawControlRack(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 12, AXIS_Y, p.accent, 2, 2);
  dashed(ctx, 66, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 12, 5, 54, 40, p);
  for (const y of [10, 18, 26, 34]) {
    rect(ctx, 17, y, 44, 6, p.dark);
    rect(ctx, 19, y + 2, 22, 2, p.ink);
    dot(ctx, 52, y + 2, p.accentHi, 2);
    dot(ctx, 57, y + 2, y === 26 ? p.hot : p.accentDk, 2);
  }
}

function drawControlledEquipment(ctx, p) {
  drawLoad(ctx, p);
  dashed(ctx, 6, 71, 44, p.accent, 2, 2);
  rect(ctx, 37, 38, 3, 7, p.metal);
  for (const x of [9, 67]) rect(ctx, x, 41, 3, 7, p.accentDk);
}

function drawSafety(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  port(ctx, 'right', AXIS_Y, p);
  dashed(ctx, 3, 75, AXIS_Y, p.accent, 2, 2);
  frame(ctx, 10, 7, 37, 36, p);
  rect(ctx, 14, 11, 29, 9, p.dark);
  rect(ctx, 17, 14, 15, 3, p.accentDk);
  dot(ctx, 37, 13, p.accentHi, 3);
  for (const y of [25, 31, 37]) {
    rect(ctx, 16, y, 19, 2, p.ink);
    dot(ctx, 39, y - 1, p.accentHi, 3);
  }
  disc(ctx, 61, 14, 4, p.hi);
  rect(ctx, 58, 19, 7, 13, p.metal);
  rect(ctx, 54, 21, 4, 3, p.metal);
  rect(ctx, 65, 21, 4, 3, p.metal);
  rect(ctx, 58, 32, 2, 10, p.ink);
  rect(ctx, 63, 32, 2, 10, p.ink);
}

function drawEndstation(ctx, p) {
  port(ctx, 'left', AXIS_Y, p);
  pipe(ctx, 3, 24, AXIS_Y, p, true);
  frame(ctx, 23, 7, 43, 36, p);
  rect(ctx, 26, 10, 37, 30, p.void);
  rect(ctx, 38, 13, 3, 23, p.accentDk);
  rect(ctx, 41, 17, 4, 15, p.accentHi);
  for (const radius of [7, 11]) {
    for (let y = -radius; y <= radius; y += Math.max(2, radius - 4)) {
      const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - y * y)));
      dot(ctx, 45 + half, AXIS_Y + y, p.metal);
      dot(ctx, 45 - half, AXIS_Y + y, p.metal);
    }
  }
  dashed(ctx, 4, 40, AXIS_Y, p.beam, 2, 2);
  for (const [x, y] of [[49, 17], [54, 21], [52, 29], [58, 33]]) dot(ctx, x, y, p.hot, 2);
}

export const CONNECTION_GUIDE_DIAGRAMS = Object.freeze({
  transformer: drawTransformer,
  switchgear: drawSwitchgear,
  load: drawLoad,
  vacuumPump: drawVacuumPump,
  beamline: drawBeamline,
  gauge: drawGauge,
  modulator: drawModulator,
  rfSource: drawRfSource,
  rfCavity: drawRfCavity,
  waterTank: drawWaterTank,
  chiller: drawChiller,
  heatLoad: drawHeatLoad,
  dryCooler: drawDryCooler,
  controlRack: drawControlRack,
  controlledEquipment: drawControlledEquipment,
  safety: drawSafety,
  endstation: drawEndstation,
});

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
