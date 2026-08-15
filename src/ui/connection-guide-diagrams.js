// Continuous, low-resolution infrastructure cross-sections. The Beamline
// Designer draws machinery as one physical section rather than a row of UI
// pictograms; these guides use the same language so the connections read as
// part of the hardware instead of arrows between unrelated icons.

const W = 226;
const H = 82;
const FLOOR_Y = 70;

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
    void: '#070812',
    wall: '#101321',
    grid: '#191d2d',
    floor: '#202431',
    floorHi: '#343948',
    ink: '#626b80',
    metalDk: '#343a4d',
    metal: '#858fa4',
    metalHi: '#c0cadc',
    copper: '#b86c3f',
    copperHi: '#e39a63',
    accent,
    accentDk: mix(accent, '#070812', 0.56),
    accentHi: mix(accent, '#ffffff', 0.42),
    beam: '#e7f6ff',
    beamDim: '#7799ba',
    hot: '#ff8a55',
    return: '#e46e55',
  };
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function dot(ctx, x, y, color, size = 1) {
  rect(ctx, x, y, size, size, color);
}

function hDash(ctx, x1, x2, y, color, dash = 3, gap = 3, thickness = 1) {
  for (let x = x1; x <= x2; x += dash + gap) {
    rect(ctx, x, y, Math.min(dash, x2 - x + 1), thickness, color);
  }
}

function vDash(ctx, x, y1, y2, color, dash = 2, gap = 2) {
  for (let y = y1; y <= y2; y += dash + gap) {
    rect(ctx, x, y, 1, Math.min(dash, y2 - y + 1), color);
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

function frame(ctx, x, y, w, h, p, fill = null) {
  rect(ctx, x, y, w, h, p.metalDk);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, fill || p.void);
  rect(ctx, x + 2, y + 2, w - 4, 1, p.metal);
  rect(ctx, x + 2, y + h - 3, w - 4, 1, p.ink);
  rect(ctx, x + w - 2, y + 2, 1, h - 4, p.ink);
}

function arrow(ctx, x, y, direction, color) {
  const dx = direction === 'left' ? -1 : 1;
  rect(ctx, x - dx * 4, y, 5, 1, color);
  dot(ctx, x, y - 2, color);
  dot(ctx, x + dx, y - 1, color);
  dot(ctx, x + dx, y + 1, color);
  dot(ctx, x, y + 2, color);
}

function backdrop(ctx, p) {
  rect(ctx, 0, 0, W, H, p.wall);
  for (let x = 7; x < W; x += 18) rect(ctx, x, 0, 1, FLOOR_Y, p.grid);
  for (let y = 11; y < FLOOR_Y; y += 14) rect(ctx, 0, y, W, 1, p.grid);
  rect(ctx, 0, FLOOR_Y, W, H - FLOOR_Y, p.floor);
  rect(ctx, 0, FLOOR_Y, W, 1, p.floorHi);
  for (let x = 0; x < W; x += 16) rect(ctx, x, FLOOR_Y, 8, 2, p.accentDk);
}

function feet(ctx, x1, x2, y, p) {
  for (const x of [x1, x2]) {
    rect(ctx, x, y, 3, FLOOR_Y - y, p.metalDk);
    rect(ctx, x - 2, FLOOR_Y - 2, 7, 2, p.ink);
  }
}

function beamPipe(ctx, x1, x2, y, p, beam = true) {
  rect(ctx, x1, y - 4, x2 - x1 + 1, 1, p.metal);
  rect(ctx, x1, y + 4, x2 - x1 + 1, 1, p.ink);
  rect(ctx, x1, y - 3, x2 - x1 + 1, 7, p.void);
  if (beam) hDash(ctx, x1 + 2, x2 - 2, y, p.beam, 3, 2);
}

function flange(ctx, x, y, p) {
  rect(ctx, x, y - 7, 3, 15, p.metal);
  rect(ctx, x + 1, y - 5, 1, 11, p.metalHi);
}

function drawPower(ctx, p) {
  backdrop(ctx, p);

  // Transformer cutaway: tank, laminated core, and paired windings.
  frame(ctx, 6, 11, 51, 54, p, '#151a27');
  for (const x of [12, 48]) {
    rect(ctx, x, 5, 3, 7, p.metal);
    dot(ctx, x - 1, 4, p.metalHi, 5);
  }
  rect(ctx, 18, 17, 27, 39, p.ink);
  rect(ctx, 22, 21, 19, 31, p.void);
  for (const x of [23, 29, 35]) {
    rect(ctx, x, 23, 4, 27, p.copper);
    for (let y = 24; y < 49; y += 4) rect(ctx, x, y, 4, 1, p.copperHi);
  }
  rect(ctx, 14, 59, 35, 2, p.accentDk);
  feet(ctx, 13, 48, 65, p);

  // Armoured HV feeder into the distribution cabinet.
  rect(ctx, 57, 43, 35, 6, '#090a0f');
  rect(ctx, 57, 44, 35, 1, p.metalDk);
  hDash(ctx, 60, 89, 46, p.accentHi, 2, 3);
  arrow(ctx, 87, 46, 'right', p.accentHi);

  // Panel / MCC cross-section with one incomer and four real branch outlets.
  frame(ctx, 92, 9, 52, 58, p);
  rect(ctx, 98, 15, 40, 3, p.accentDk);
  rect(ctx, 101, 18, 3, 39, p.metal);
  for (const y of [22, 32, 42, 52]) {
    rect(ctx, 108, y, 21, 6, p.metalDk);
    rect(ctx, 111, y + 2, 9, 2, p.ink);
    dot(ctx, 124, y + 1, y === 32 ? p.accentHi : p.accentDk, 3);
    rect(ctx, 130, y + 2, 9, 1, p.metal);
  }
  feet(ctx, 99, 135, 67, p);

  // A single branch circuit reaches a beamline load. The other sockets are
  // visible in the cabinet instead of implying that a cable can fan out.
  rect(ctx, 144, 45, 25, 3, p.accentDk);
  hDash(ctx, 146, 166, 46, p.accentHi, 3, 2);
  arrow(ctx, 165, 46, 'right', p.accentHi);
  beamPipe(ctx, 168, 225, 36, p);
  flange(ctx, 168, 36, p);
  flange(ctx, 222, 36, p);
  rect(ctx, 178, 20, 35, 33, p.metalDk);
  rect(ctx, 182, 23, 27, 27, p.void);
  for (const x of [184, 202]) {
    rect(ctx, x, 24, 6, 25, p.accentDk);
    for (let y = 25; y < 48; y += 4) rect(ctx, x + 1, y, 4, 1, p.accentHi);
  }
  feet(ctx, 181, 208, 53, p);
}

function drawRfPower(ctx, p) {
  backdrop(ctx, p);

  // Compact transformer secondary and its HV launch.
  frame(ctx, 3, 18, 31, 45, p);
  rect(ctx, 10, 25, 5, 30, p.ink);
  rect(ctx, 21, 25, 5, 30, p.ink);
  for (const x of [11, 22]) {
    for (let y = 27; y < 54; y += 4) rect(ctx, x, y, 3, 2, p.copperHi);
  }
  rect(ctx, 34, 43, 13, 6, '#090a0f');
  hDash(ctx, 35, 45, 46, p.accentHi, 2, 2);
  arrow(ctx, 44, 46, 'right', p.accentHi);
  feet(ctx, 8, 27, 63, p);

  // Klystron/SSA shown as a cutaway beam device, not a generic source icon.
  frame(ctx, 47, 10, 78, 56, p);
  rect(ctx, 52, 15, 68, 45, p.void);
  disc(ctx, 58, 37, 6, p.copper);
  rect(ctx, 58, 35, 14, 5, p.metalDk);
  for (const cx of [76, 88, 100, 112]) {
    ring(ctx, cx, 37, 9, 2, p.copper, p.void);
    rect(ctx, cx - 1, 29, 3, 17, p.copperHi);
  }
  rect(ctx, 53, 23, 66, 2, p.ink);
  rect(ctx, 53, 50, 66, 2, p.ink);
  hDash(ctx, 60, 117, 37, p.beam, 2, 2);
  for (const x of [77, 89, 101, 113]) dot(ctx, x, 37, p.accentHi, 2);
  feet(ctx, 53, 117, 66, p);

  // Rectangular guide rises from the output cavity and lands on the coupler.
  rect(ctx, 125, 25, 33, 11, p.copper);
  rect(ctx, 125, 28, 30, 5, p.void);
  rect(ctx, 154, 28, 7, 12, p.copper);
  rect(ctx, 156, 30, 3, 9, p.void);
  for (const x of [132, 143, 153]) arrow(ctx, x, 30, 'right', p.accentHi);

  // Warm accelerating-cavity cross-section on the common beam axis.
  beamPipe(ctx, 159, 225, 40, p);
  flange(ctx, 160, 40, p);
  flange(ctx, 222, 40, p);
  for (const cx of [171, 184, 197, 210]) {
    ring(ctx, cx, 40, 11, 3, p.copper, p.void);
    rect(ctx, cx - 1, 30, 3, 21, p.copperHi);
  }
  hDash(ctx, 162, 222, 40, p.beam, 2, 2);
  feet(ctx, 168, 211, 52, p);
}

function drawVacuum(ctx, p) {
  backdrop(ctx, p);

  // The evacuated beam volume is one continuous section across the plant.
  beamPipe(ctx, 74, 225, 25, p, false);
  for (const x of [75, 126, 222]) flange(ctx, x, 25, p);
  for (const x of [83, 108, 143, 194, 215]) arrow(ctx, x, 25, 'left', p.accentHi);
  feet(ctx, 81, 217, 30, p);

  // Turbo inlet opens directly into the high-vacuum side.
  rect(ctx, 99, 29, 8, 8, p.metal);
  rect(ctx, 101, 29, 4, 10, p.void);
  frame(ctx, 88, 37, 31, 31, p);
  rect(ctx, 92, 40, 23, 24, p.void);
  for (let y = 41; y < 63; y += 3) {
    rect(ctx, 94, y, 9, 1, p.accentHi);
    rect(ctx, 104, y + 1, 9, 1, p.ink);
  }
  rect(ctx, 102, 40, 2, 24, p.metal);

  // Foreline to the mechanical roughing pump: a real staged cross-section.
  rect(ctx, 57, 53, 31, 4, p.metalDk);
  rect(ctx, 58, 54, 30, 2, p.accentDk);
  arrow(ctx, 61, 55, 'left', p.accentHi);
  frame(ctx, 8, 43, 49, 25, p);
  ring(ctx, 23, 55, 9, 3, p.metal, p.void);
  ring(ctx, 41, 55, 8, 2, p.accentDk, p.void);
  rect(ctx, 22, 48, 20, 3, p.ink);
  rect(ctx, 22, 60, 20, 3, p.ink);
  feet(ctx, 12, 51, 68, p);

  // UHV pump and pressure gauge are shown as taps, never downstream loads.
  rect(ctx, 140, 29, 5, 10, p.metal);
  frame(ctx, 132, 39, 21, 29, p);
  rect(ctx, 137, 42, 11, 22, p.accentDk);
  for (let y = 45; y < 63; y += 4) rect(ctx, 139, y, 7, 1, p.accentHi);

  rect(ctx, 184, 10, 3, 12, p.metal);
  ring(ctx, 185, 9, 9, 2, p.metal, p.void);
  rect(ctx, 185, 3, 1, 7, p.accentHi);
  rect(ctx, 185, 9, 5, 1, p.accent);
  for (const [x, y] of [[179, 4], [183, 1], [188, 1], [192, 5]]) dot(ctx, x, y, p.ink);
}

function drawCooling(ctx, p) {
  backdrop(ctx, p);

  // Storage tank with visible water line.
  rect(ctx, 8, 15, 31, 48, p.metalDk);
  rect(ctx, 10, 12, 27, 4, p.metal);
  rect(ctx, 10, 16, 27, 44, p.void);
  rect(ctx, 10, 39, 27, 21, p.accentDk);
  hDash(ctx, 11, 36, 39, p.accentHi, 4, 2);
  rect(ctx, 13, 19, 2, 15, p.metal);
  dot(ctx, 30, 20, p.accentHi, 3);
  feet(ctx, 12, 33, 63, p);

  // Chiller cutaway: compressor and finned heat exchanger.
  frame(ctx, 48, 10, 55, 53, p);
  ring(ctx, 65, 36, 12, 3, p.accentDk, p.void);
  for (const [x, y] of [[65, 25], [76, 36], [65, 47], [54, 36]]) {
    rect(ctx, x - 1, y - 4, 3, 9, p.accentHi);
  }
  for (let x = 82; x < 97; x += 3) rect(ctx, x, 18, 1, 34, p.metal);
  feet(ctx, 54, 95, 63, p);

  // The heat load is drawn as a beamline magnet cross-section.
  beamPipe(ctx, 108, 164, 31, p);
  flange(ctx, 108, 31, p);
  flange(ctx, 161, 31, p);
  rect(ctx, 118, 17, 36, 29, p.metalDk);
  rect(ctx, 122, 20, 28, 23, p.void);
  rect(ctx, 123, 20, 7, 23, p.accentDk);
  rect(ctx, 142, 20, 7, 23, p.accentDk);
  for (let y = 22; y < 42; y += 4) {
    rect(ctx, 124, y, 5, 1, p.accentHi);
    rect(ctx, 143, y, 5, 1, p.accentHi);
  }
  for (const x of [126, 136, 146]) {
    dot(ctx, x, 12, p.hot);
    dot(ctx, x + 1, 9, p.hot);
  }
  feet(ctx, 120, 151, 47, p);

  // Air-side heat rejector with fan and coil bank.
  frame(ctx, 178, 9, 43, 48, p);
  ring(ctx, 193, 32, 13, 2, p.metal, p.void);
  rect(ctx, 191, 20, 4, 25, p.accentDk);
  rect(ctx, 181, 30, 25, 4, p.accentDk);
  rect(ctx, 191, 30, 4, 4, p.accentHi);
  for (let x = 210; x < 217; x += 2) rect(ctx, x, 15, 1, 34, p.ink);
  for (const x of [187, 199, 213]) arrow(ctx, x, 5, 'right', p.accentHi);
  feet(ctx, 182, 216, 57, p);

  // Paired loop: cold supply runs right; warm return comes back left. Every
  // plant role taps the same network, matching the cooling solver.
  rect(ctx, 34, 59, 151, 3, p.accentDk);
  rect(ctx, 34, 65, 151, 3, mix(p.return, '#070812', 0.38));
  hDash(ctx, 36, 182, 60, p.accentHi, 4, 3);
  hDash(ctx, 36, 182, 66, p.return, 4, 3);
  for (const x of [38, 51, 100, 114, 157, 181]) rect(ctx, x, 53, 2, 14, p.metal);
  for (const x of [77, 131, 170]) arrow(ctx, x, 60, 'right', p.accentHi);
  for (const x of [158, 109, 61]) arrow(ctx, x, 66, 'left', p.return);
}

function drawDataControls(ctx, p) {
  backdrop(ctx, p);

  // Powered controls rack with recognizable blades, patching, and activity.
  frame(ctx, 8, 7, 55, 61, p);
  for (const y of [13, 22, 31, 40, 49, 58]) {
    rect(ctx, 13, y, 44, 7, p.metalDk);
    rect(ctx, 16, y + 2, 22, 2, p.ink);
    for (const x of [45, 50, 54]) dot(ctx, x, y + 2, x === 50 ? p.accentHi : p.accentDk, 2);
  }
  feet(ctx, 13, 56, 68, p);

  // Fiber leaves the patch field as a thin, explicit point-to-point run.
  rect(ctx, 63, 53, 77, 3, p.accentDk);
  hDash(ctx, 65, 138, 54, p.accentHi, 2, 3);
  for (const x of [76, 93, 111, 130]) arrow(ctx, x, 54, 'right', p.accentHi);
  frame(ctx, 87, 43, 24, 20, p);
  for (const y of [47, 51, 55]) {
    for (const x of [92, 97, 102, 107]) dot(ctx, x, y, p.accentHi, 2);
  }

  // A beamline device with two instrument pickups feeding one data port.
  beamPipe(ctx, 139, 225, 33, p);
  flange(ctx, 140, 33, p);
  flange(ctx, 222, 33, p);
  rect(ctx, 157, 20, 45, 29, p.metalDk);
  rect(ctx, 161, 23, 37, 23, p.void);
  ring(ctx, 173, 33, 9, 2, p.accentDk, p.void);
  ring(ctx, 190, 33, 7, 2, p.metal, p.void);
  rect(ctx, 171, 13, 4, 12, p.metal);
  rect(ctx, 188, 14, 4, 13, p.metal);
  vDash(ctx, 173, 7, 13, p.accentHi);
  vDash(ctx, 190, 8, 14, p.accentHi);
  rect(ctx, 140, 53, 40, 3, p.accentDk);
  rect(ctx, 178, 47, 3, 9, p.metal);
  feet(ctx, 159, 199, 49, p);
}

function drawOps(ctx, p) {
  backdrop(ctx, p);

  // Shielding is a cutaway around the dump, leaving the beam aperture open.
  rect(ctx, 102, 6, 67, 13, '#3b3d49');
  rect(ctx, 102, 19, 13, 48, '#3b3d49');
  rect(ctx, 156, 19, 13, 48, '#3b3d49');
  rect(ctx, 115, 55, 41, 12, '#3b3d49');
  for (let y = 7; y < 67; y += 4) {
    for (let x = 103 + ((y / 4) % 2) * 3; x < 168; x += 7) {
      if ((y < 19) || x < 115 || x >= 156 || y >= 55) dot(ctx, x, y, p.ink);
    }
  }

  // Full beam enters a layered, water-cooled copper/graphite dump.
  beamPipe(ctx, 0, 121, 35, p);
  flange(ctx, 95, 35, p);
  for (const x of [22, 51, 79, 106]) arrow(ctx, x, 35, 'right', p.beam);
  rect(ctx, 116, 24, 38, 23, p.metalDk);
  rect(ctx, 119, 27, 31, 17, p.copper);
  for (let x = 121; x < 149; x += 5) {
    rect(ctx, x, 28, 2, 15, x % 2 ? p.copperHi : p.ink);
  }
  for (const [x, y] of [[146, 23], [151, 19], [152, 49], [146, 53]]) dot(ctx, x, y, p.hot, 2);

  // Cooling-water supply and return are the one real utility connection on
  // the Ops disposal hardware.
  rect(ctx, 124, 47, 3, 13, p.accentDk);
  rect(ctx, 143, 47, 3, 18, p.return);
  rect(ctx, 124, 59, 81, 3, p.accentDk);
  rect(ctx, 143, 64, 62, 3, mix(p.return, '#070812', 0.35));
  hDash(ctx, 127, 202, 60, p.accentHi, 3, 3);
  hDash(ctx, 146, 202, 65, p.return, 3, 3);
  arrow(ctx, 197, 60, 'left', p.accentHi);
  arrow(ctx, 198, 65, 'right', p.return);

  // Remote manipulator reaches through the shielding wall to service targets.
  frame(ctx, 181, 45, 28, 23, p);
  rect(ctx, 193, 38, 4, 8, p.metal);
  rect(ctx, 190, 35, 10, 5, p.metalDk);
  rect(ctx, 184, 25, 5, 13, p.metal);
  rect(ctx, 164, 22, 24, 5, p.metal);
  rect(ctx, 161, 24, 5, 13, p.metalHi);
  dot(ctx, 186, 37, p.accentHi, 4);
  dot(ctx, 195, 38, p.accentHi, 4);
  rect(ctx, 157, 34, 7, 2, p.metalHi);
  dot(ctx, 156, 32, p.metalHi, 2);
  dot(ctx, 156, 37, p.metalHi, 2);
  feet(ctx, 185, 204, 68, p);
}

export const CONNECTION_GUIDE_DIAGRAMS = Object.freeze({
  power: drawPower,
  vacuum: drawVacuum,
  rfPower: drawRfPower,
  cooling: drawCooling,
  dataControls: drawDataControls,
  ops: drawOps,
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
