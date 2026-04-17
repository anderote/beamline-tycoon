#!/usr/bin/env node
// Procedural 64×64 door-panel textures.
// Run: node tools/asset-gen/gen-door-textures.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 64;
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng() {
  return new PNG({ width: SIZE, height: SIZE, colorType: 6 });
}

function setPx(png, x, y, r, g, b, a = 255) {
  const xx = ((x % SIZE) + SIZE) % SIZE;
  const yy = ((y % SIZE) + SIZE) % SIZE;
  const idx = (yy * SIZE + xx) * 4;
  png.data[idx] = Math.max(0, Math.min(255, r | 0));
  png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
  png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
  png.data[idx + 3] = a;
}

function getPx(png, x, y) {
  const idx = (y * SIZE + x) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

function fill(png, r, g, b, a = 255) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) setPx(png, x, y, r, g, b, a);
}

function rect(png, x0, y0, w, h, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) setPx(png, x0 + dx, y0 + dy, r, g, b, a);
}

function rectOutline(png, x0, y0, w, h, r, g, b, thick = 1) {
  for (let t = 0; t < thick; t++) {
    for (let dx = 0; dx < w; dx++) {
      setPx(png, x0 + dx, y0 + t, r, g, b);
      setPx(png, x0 + dx, y0 + h - 1 - t, r, g, b);
    }
    for (let dy = 0; dy < h; dy++) {
      setPx(png, x0 + t, y0 + dy, r, g, b);
      setPx(png, x0 + w - 1 - t, y0 + dy, r, g, b);
    }
  }
}

function noiseLayer(png, rng, intensity) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [cr, cg, cb, ca] = getPx(png, x, y);
      const n = (rng() - 0.5) * intensity;
      setPx(png, x, y, cr + n, cg + n, cb + n, ca);
    }
  }
}

function writePng(png, name) {
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// ── Double Door (one panel — mirrored for the other) ──────────────────
// Commercial glass double-door panel: metal frame with glass insets.
function genDoubleDoor() {
  const png = makePng();
  const rng = mulberry32(4001);
  // Metal frame base
  fill(png, 0x66, 0x77, 0x88);
  // Glass pane - upper
  for (let y = 6; y < 44; y++)
    for (let x = 5; x < 59; x++) {
      const tint = 0xaa + (rng() * 16 - 8) | 0;
      setPx(png, x, y, tint - 0x22, tint, tint + 0x10, 230);
    }
  // Glass pane - lower
  for (let y = 48; y < 58; y++)
    for (let x = 5; x < 59; x++) {
      const tint = 0xaa + (rng() * 16 - 8) | 0;
      setPx(png, x, y, tint - 0x22, tint, tint + 0x10, 230);
    }
  // Mullion divider between panes
  rect(png, 5, 44, 54, 4, 0x55, 0x66, 0x77);
  // Frame border
  rectOutline(png, 0, 0, 64, 64, 0x50, 0x60, 0x70, 3);
  // Handle — horizontal push bar
  rect(png, 8, 38, 48, 3, 0xcc, 0xcc, 0xbb);
  rect(png, 8, 37, 48, 1, 0xdd, 0xdd, 0xcc);
  // Kickplate
  rect(png, 3, 58, 58, 6, 0x55, 0x60, 0x6a);
  noiseLayer(png, rng, 6);
  writePng(png, 'door_double');
}

// ── Security Door ─────────────────────────────────────────────────────
// Heavy reinforced steel door with badge reader.
function genSecurityDoor() {
  const png = makePng();
  const rng = mulberry32(4002);
  fill(png, 0x55, 0x66, 0x77);
  noiseLayer(png, rng, 8);
  // Recessed panel
  rectOutline(png, 6, 6, 52, 52, 0x44, 0x55, 0x66, 2);
  rectOutline(png, 8, 8, 48, 48, 0x66, 0x77, 0x88, 1);
  // Badge reader (small black rectangle, right side)
  rect(png, 44, 28, 8, 12, 0x22, 0x22, 0x22);
  rect(png, 46, 30, 4, 3, 0x00, 0xaa, 0x00); // green LED
  rect(png, 46, 34, 4, 4, 0x33, 0x33, 0x33); // sensor area
  // Handle - lever style
  rect(png, 44, 42, 8, 2, 0x99, 0x99, 0x88);
  rect(png, 48, 42, 4, 6, 0x99, 0x99, 0x88);
  // Reinforcement rivets at corners
  for (const [rx, ry] of [[10, 10], [10, 52], [52, 10], [52, 52]]) {
    setPx(png, rx, ry, 0x88, 0x88, 0x88);
    setPx(png, rx + 1, ry, 0x88, 0x88, 0x88);
    setPx(png, rx, ry + 1, 0x88, 0x88, 0x88);
    setPx(png, rx + 1, ry + 1, 0x88, 0x88, 0x88);
  }
  // Heavy frame
  rectOutline(png, 0, 0, 64, 64, 0x44, 0x50, 0x5c, 3);
  writePng(png, 'door_security');
}

// ── Office Door ───────────────────────────────────────────────────────
// Classic 6-panel wood door.
function genOfficeDoor() {
  const png = makePng();
  const rng = mulberry32(4003);
  // Wood base
  fill(png, 0xaa, 0x99, 0x77);
  // Vertical wood grain
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const grain = Math.sin(x * 0.8 + rng() * 0.4) * 8;
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + grain, cg + grain - 2, cb + grain - 4);
    }
  }
  // Frame stiles and rails
  rect(png, 0, 0, 8, 64, 0x99, 0x88, 0x66);  // left stile
  rect(png, 56, 0, 8, 64, 0x99, 0x88, 0x66);  // right stile
  rect(png, 0, 0, 64, 5, 0x99, 0x88, 0x66);   // top rail
  rect(png, 0, 59, 64, 5, 0x99, 0x88, 0x66);  // bottom rail
  rect(png, 0, 21, 64, 4, 0x99, 0x88, 0x66);  // mid rail 1
  rect(png, 0, 41, 64, 4, 0x99, 0x88, 0x66);  // mid rail 2
  rect(png, 30, 0, 4, 64, 0x99, 0x88, 0x66);  // center stile
  // Recessed panels (6 = 3 rows × 2 cols)
  const panels = [
    [10, 7, 18, 12], [35, 7, 18, 12],
    [10, 27, 18, 12], [35, 27, 18, 12],
    [10, 47, 18, 10], [35, 47, 18, 10],
  ];
  for (const [px, py, pw, ph] of panels) {
    rect(png, px, py, pw, ph, 0x9a, 0x88, 0x66);
    rectOutline(png, px, py, pw, ph, 0x88, 0x77, 0x55, 1);
    // Highlight on top-left edge
    for (let dx = 0; dx < pw; dx++) setPx(png, px + dx, py, 0xbb, 0xaa, 0x88);
    for (let dy = 0; dy < ph; dy++) setPx(png, px, py + dy, 0xbb, 0xaa, 0x88);
  }
  // Doorknob
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (dx * dx + dy * dy <= 5)
        setPx(png, 50 + dx, 34 + dy, 0xcc, 0xbb, 0x55);
  noiseLayer(png, rng, 5);
  rectOutline(png, 0, 0, 64, 64, 0x88, 0x77, 0x55, 1);
  writePng(png, 'door_office');
}

// ── Fire Door ─────────────────────────────────────────────────────────
// Red fire-rated door with push bar and small wire-glass window.
function genFireDoor() {
  const png = makePng();
  const rng = mulberry32(4004);
  fill(png, 0xcc, 0x55, 0x44);
  noiseLayer(png, rng, 10);
  // Heavy frame
  rectOutline(png, 0, 0, 64, 64, 0xaa, 0x40, 0x33, 3);
  // Small wire-glass window (upper area)
  rect(png, 20, 8, 24, 16, 0xcc, 0xdd, 0xcc, 200);
  rectOutline(png, 20, 8, 24, 16, 0x88, 0x33, 0x28, 2);
  // Wire pattern in glass
  for (let gy = 10; gy < 22; gy += 4)
    for (let gx = 22; gx < 42; gx++) setPx(png, gx, gy, 0x99, 0xaa, 0x99);
  for (let gx = 22; gx < 42; gx += 4)
    for (let gy = 10; gy < 22; gy++) setPx(png, gx, gy, 0x99, 0xaa, 0x99);
  // Push bar
  rect(png, 6, 36, 52, 4, 0xdd, 0xdd, 0xcc);
  rect(png, 6, 35, 52, 1, 0xee, 0xee, 0xdd);
  // Push bar brackets
  rect(png, 8, 33, 4, 8, 0xbb, 0xbb, 0xaa);
  rect(png, 52, 33, 4, 8, 0xbb, 0xbb, 0xaa);
  // Hazard stripe at bottom
  for (let y = 58; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const stripe = ((x + y) >> 2) & 1;
      if (stripe) setPx(png, x, y, 0x22, 0x22, 0x22);
      else setPx(png, x, y, 0xee, 0xcc, 0x00);
    }
  }
  writePng(png, 'door_fire');
}

// ── Lab Door ──────────────────────────────────────────────────────────
// Sealed lab door with large observation window, clean look.
function genLabDoor() {
  const png = makePng();
  const rng = mulberry32(4005);
  fill(png, 0x99, 0xaa, 0xcc);
  noiseLayer(png, rng, 5);
  // Seal/gasket border
  rectOutline(png, 0, 0, 64, 64, 0x77, 0x88, 0xaa, 2);
  rectOutline(png, 2, 2, 60, 60, 0x55, 0x66, 0x88, 1);
  // Large observation window (upper half)
  rect(png, 12, 6, 40, 28, 0xbb, 0xcc, 0xdd, 220);
  rectOutline(png, 12, 6, 40, 28, 0x66, 0x77, 0x99, 2);
  // Slight reflection in window
  for (let dy = 0; dy < 6; dy++)
    for (let dx = 0; dx < 12; dx++)
      setPx(png, 16 + dx, 10 + dy, 0xcc, 0xdd, 0xee, 180);
  // Handle - lever style
  rect(png, 46, 40, 8, 2, 0xbb, 0xbb, 0xaa);
  rect(png, 50, 40, 4, 8, 0xbb, 0xbb, 0xaa);
  // Access indicator (small LED)
  setPx(png, 48, 38, 0x00, 0xcc, 0x00);
  setPx(png, 49, 38, 0x00, 0xcc, 0x00);
  // Clean lower panel
  rectOutline(png, 8, 38, 32, 20, 0x88, 0x99, 0xbb, 1);
  writePng(png, 'door_lab');
}

// ── Chain Link Gate ───────────────────────────────────────────────────
// Diamond mesh gate matching chain link fence.
function genChainLinkGate() {
  const png = makePng();
  const rng = mulberry32(4006);
  fill(png, 0x44, 0x55, 0x55, 0);  // transparent background
  // Metal frame
  rect(png, 0, 0, 64, 4, 0x88, 0x99, 0x99);   // top rail
  rect(png, 0, 60, 64, 4, 0x88, 0x99, 0x99);   // bottom rail
  rect(png, 0, 0, 4, 64, 0x88, 0x99, 0x99);    // left rail
  rect(png, 60, 0, 4, 64, 0x88, 0x99, 0x99);   // right rail
  // Diamond mesh pattern
  const meshColor = [0x99, 0xaa, 0xaa];
  for (let y = 4; y < 60; y++) {
    for (let x = 4; x < 60; x++) {
      const dx = (x + y) % 8;
      const dy = (x - y + 64) % 8;
      if (dx === 0 || dy === 0) {
        setPx(png, x, y, ...meshColor, 255);
      } else {
        // transparent/dark behind mesh
        setPx(png, x, y, 0x30, 0x40, 0x40, 80);
      }
    }
  }
  noiseLayer(png, rng, 4);
  writePng(png, 'door_chain_link');
}

// ── Wood Gate ─────────────────────────────────────────────────────────
// Vertical plank gate with horizontal braces.
function genWoodGate() {
  const png = makePng();
  const rng = mulberry32(4007);
  // Base warm wood
  fill(png, 0x99, 0x77, 0x55);
  // Vertical planks ~10px wide with slight color variation
  for (let px = 0; px < SIZE; px += 10) {
    const tint = (rng() - 0.5) * 20;
    for (let y = 0; y < SIZE; y++) {
      for (let x = px; x < Math.min(px + 10, SIZE); x++) {
        if (x === px || x === px + 9) {
          // Gap between planks
          setPx(png, x, y, 0x66, 0x50, 0x38);
        } else {
          const grain = Math.sin(y * 0.3 + rng() * 0.2) * 5;
          setPx(png, x, y, 0x99 + tint + grain, 0x77 + tint + grain - 2, 0x55 + tint + grain - 4);
        }
      }
    }
  }
  // Horizontal braces
  const braceColor = [0x88, 0x66, 0x44];
  rect(png, 2, 10, 60, 5, ...braceColor);
  rect(png, 2, 32, 60, 5, ...braceColor);
  rect(png, 2, 52, 60, 5, ...braceColor);
  // Nail dots
  for (const by of [12, 34, 54]) {
    for (let px = 5; px < SIZE; px += 10) {
      setPx(png, px, by, 0x55, 0x55, 0x55);
      setPx(png, px + 1, by, 0x55, 0x55, 0x55);
    }
  }
  noiseLayer(png, rng, 6);
  rectOutline(png, 0, 0, 64, 64, 0x77, 0x55, 0x33, 1);
  writePng(png, 'door_wood_gate');
}

// ── Security Gate ─────────────────────────────────────────────────────
// Heavy-duty industrial rolling/sliding gate with bars.
function genSecurityGate() {
  const png = makePng();
  const rng = mulberry32(4008);
  fill(png, 0x44, 0x55, 0x55, 60);  // mostly transparent
  // Heavy frame
  rect(png, 0, 0, 64, 5, 0x66, 0x77, 0x77);
  rect(png, 0, 59, 64, 5, 0x66, 0x77, 0x77);
  rect(png, 0, 0, 5, 64, 0x66, 0x77, 0x77);
  rect(png, 59, 0, 5, 64, 0x66, 0x77, 0x77);
  // Expanded metal mesh — diamond pattern, heavier than chain link
  for (let y = 5; y < 59; y++) {
    for (let x = 5; x < 59; x++) {
      const dx = (x + y) % 6;
      const dy = (x - y + 60) % 6;
      if (dx < 2 || dy < 2) {
        const n = rng() * 8;
        setPx(png, x, y, 0x66 + n, 0x77 + n, 0x77 + n, 255);
      } else {
        setPx(png, x, y, 0x33, 0x44, 0x44, 100);
      }
    }
  }
  // Horizontal reinforcement bars
  rect(png, 5, 20, 54, 3, 0x77, 0x88, 0x88);
  rect(png, 5, 40, 54, 3, 0x77, 0x88, 0x88);
  // Corner gussets
  for (const [cx, cy] of [[5, 5], [5, 56], [56, 5], [56, 56]]) {
    rect(png, cx, cy, 6, 6, 0x77, 0x88, 0x88);
  }
  noiseLayer(png, rng, 4);
  writePng(png, 'door_security_gate');
}

// ── Rolling Shutter ───────────────────────────────────────────────────
// Industrial corrugated horizontal slats.
function genRollingShutter() {
  const png = makePng();
  const rng = mulberry32(4009);
  fill(png, 0x88, 0x88, 0x88);
  // Horizontal slats — 4px each with corrugation shading
  for (let y = 0; y < SIZE; y++) {
    const slat = y % 4;
    for (let x = 0; x < SIZE; x++) {
      let base = 0x88;
      if (slat === 0) base = 0x99;       // top highlight
      else if (slat === 1) base = 0x90;   // upper face
      else if (slat === 2) base = 0x80;   // lower face
      else base = 0x70;                   // shadow crease
      const n = rng() * 6;
      setPx(png, x, y, base + n, base + n, base + n);
    }
  }
  // Subtle vertical guides on edges
  for (let y = 0; y < SIZE; y++) {
    for (let dx = 0; dx < 3; dx++) {
      setPx(png, dx, y, 0x66, 0x66, 0x66);
      setPx(png, 63 - dx, y, 0x66, 0x66, 0x66);
    }
  }
  // Handle/pull at bottom center
  rect(png, 26, 56, 12, 4, 0x55, 0x55, 0x55);
  rect(png, 28, 57, 8, 2, 0x99, 0x99, 0x99);
  noiseLayer(png, rng, 4);
  writePng(png, 'door_rolling_shutter');
}

// ── Run all generators ────────────────────────────────────────────────
genDoubleDoor();
genSecurityDoor();
genOfficeDoor();
genFireDoor();
genLabDoor();
genChainLinkGate();
genWoodGate();
genSecurityGate();
genRollingShutter();
console.log('Done – 9 door textures generated.');
