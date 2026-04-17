// src/renderer3d/builders/rf-builder.js
//
// Role-bucket builders for RF Power infrastructure components.
// Klystrons modeled after SLAC XL-4/XL-5 series. Floor-standing
// equipment — origin is footprint center at floor level (y = 0).
//
// Conventions match vacuum-builder.js / diagnostic-builder.js:
//   - 1 sub-tile = 0.5 m.
//   - THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

const SUB_UNIT = 0.5;
const SEGS     = 16;

function pushT(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}
function trans(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}
function rotX(angle) {
  return new THREE.Matrix4().makeRotationX(angle);
}
function rotY(angle) {
  return new THREE.Matrix4().makeRotationY(angle);
}
function rotZ(angle) {
  return new THREE.Matrix4().makeRotationZ(angle);
}

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

// ── Klystron helpers ───────────────────────────────────────────────

function _buildKlystronBase(b, {
  baseW, baseD, baseH = 0.15,
  solR, solH,
  capR, capH = 0.04,
  tubeR = 0.1, tubeH = 0.3,
  collR, collH,
  wgW = 0.12, wgH = 0.08, wgD = 0.15,
  wgHeightFrac = 0.7,
  dualWaveguide = false,
  numManifolds = 1,
}) {
  // Base frame
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  const solBase = baseH;

  // Focusing solenoid
  {
    const g = new THREE.CylinderGeometry(solR, solR, solH, SEGS);
    applyTiledCylinderUVs(g, solR, solH, SEGS);
    pushT(b.iron, g, trans(0, solBase + solH / 2, 0));
  }

  // Solenoid end caps
  for (const yOff of [0, solH]) {
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    pushT(b.iron, g, trans(0, solBase + yOff + (yOff === 0 ? capH / 2 : -capH / 2), 0));
  }

  // Klystron tube protruding above solenoid
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, SEGS);
    applyTiledCylinderUVs(g, tubeR, tubeH, SEGS);
    pushT(b.copper, g, trans(0, solBase + solH + tubeH / 2, 0));
  }

  // Collector dome at top
  {
    const g = new THREE.CylinderGeometry(collR, collR, collH, SEGS);
    applyTiledCylinderUVs(g, collR, collH, SEGS);
    pushT(b.accent, g, trans(0, solBase + solH + tubeH + collH / 2, 0));
  }

  // Output waveguide stub(s)
  const wgY = solBase + solH * wgHeightFrac;
  {
    const g = new THREE.BoxGeometry(wgD, wgH, wgW);
    applyTiledBoxUVs(g, wgD, wgH, wgW);
    pushT(b.copper, g, trans(solR + wgD / 2, wgY, 0));
  }
  if (dualWaveguide) {
    const g = new THREE.BoxGeometry(wgD, wgH, wgW);
    applyTiledBoxUVs(g, wgD, wgH, wgW);
    pushT(b.copper, g, trans(-(solR + wgD / 2), wgY, 0));
  }

  // Cooling manifold torus ring(s)
  for (let i = 0; i < numManifolds; i++) {
    const frac = numManifolds === 1 ? 0.5 : (0.35 + i * 0.3);
    const g = new THREE.TorusGeometry(solR + 0.01, 0.015, 8, SEGS);
    pushT(b.detail, g, trans(0, solBase + solH * frac, 0));
  }
}

// ── Klystron builders ──────────────────────────────────────────────

export function _buildPulsedKlystronRoles() {
  const b = makeBuckets();
  _buildKlystronBase(b, {
    baseW: 0.9, baseD: 1.8, solR: 0.35, solH: 1.5,
    capR: 0.37, collR: 0.18, collH: 0.15,
  });
  return b;
}

export function _buildCWKlystronRoles() {
  const b = makeBuckets();
  _buildKlystronBase(b, {
    baseW: 0.9, baseD: 1.8, solR: 0.35, solH: 1.5,
    capR: 0.37, collR: 0.22, collH: 0.25, numManifolds: 2,
  });
  return b;
}

export function _buildMultibeamKlystronRoles() {
  const b = makeBuckets();
  _buildKlystronBase(b, {
    baseW: 1.3, baseD: 1.8, solR: 0.45, solH: 1.5,
    capR: 0.47, collR: 0.25, collH: 0.2, dualWaveguide: true,
  });
  return b;
}

// ── Magnetron ──────────────────────────────────────────────────────

export function _buildMagnetronRoles() {
  const b = makeBuckets();

  // Base plate (bigger footprint: 1m × 1.5m)
  const baseH = 0.1;
  {
    const g = new THREE.BoxGeometry(0.9, baseH, 1.3);
    applyTiledBoxUVs(g, 0.9, baseH, 1.3);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // H-frame magnet yoke — two vertical pillars
  const pillarW = 0.15, pillarH = 1.4, pillarD = 0.15;
  const pillarSpacing = 0.25;
  for (const sign of [-1, 1]) {
    const g = new THREE.BoxGeometry(pillarW, pillarH, pillarD);
    applyTiledBoxUVs(g, pillarW, pillarH, pillarD);
    pushT(b.iron, g, trans(sign * pillarSpacing, baseH + pillarH / 2, 0));
  }

  // Cross-piece at top of yoke
  const crossW = pillarSpacing * 2 + pillarW;
  {
    const g = new THREE.BoxGeometry(crossW, 0.15, pillarD);
    applyTiledBoxUVs(g, crossW, 0.15, pillarD);
    pushT(b.iron, g, trans(0, baseH + pillarH - 0.075, 0));
  }

  // Bottom cross-piece connecting pillars
  {
    const g = new THREE.BoxGeometry(crossW, 0.12, pillarD);
    applyTiledBoxUVs(g, crossW, 0.12, pillarD);
    pushT(b.iron, g, trans(0, baseH + 0.06, 0));
  }

  // Anode block — copper cylinder between poles
  const anodeR = 0.2, anodeH = 0.4;
  const anodeY = baseH + pillarH * 0.45;
  {
    const g = new THREE.CylinderGeometry(anodeR, anodeR, anodeH, SEGS);
    applyTiledCylinderUVs(g, anodeR, anodeH, SEGS);
    pushT(b.copper, g, trans(0, anodeY, 0));
  }

  // Cooling fins around anode
  const finR = 0.24;
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(finR, finR, 0.01, SEGS);
    applyTiledCylinderUVs(g, finR, 0.01, SEGS);
    pushT(b.detail, g, trans(0, anodeY - anodeH / 2 + 0.06 + i * 0.07, 0));
  }

  // Output waveguide stub
  {
    const g = new THREE.BoxGeometry(0.15, 0.08, 0.1);
    applyTiledBoxUVs(g, 0.15, 0.08, 0.1);
    pushT(b.copper, g, trans(pillarSpacing + pillarW / 2 + 0.075, anodeY, 0));
  }

  return b;
}

// ── Traveling Wave Tube ────────────────────────────────────────────

export function _buildTWTRoles() {
  const b = makeBuckets();

  // Support rails with base feet
  const railW = 0.04, railH = 1.6, railD = 0.04;
  const footW = 0.12, footH = 0.04, footD = 0.2;
  for (const sign of [-1, 1]) {
    const xOff = sign * 0.12;
    // Rail
    {
      const g = new THREE.BoxGeometry(railW, railH, railD);
      applyTiledBoxUVs(g, railW, railH, railD);
      pushT(b.stand, g, trans(xOff, railH / 2, 0));
    }
    // Foot
    {
      const g = new THREE.BoxGeometry(footW, footH, footD);
      applyTiledBoxUVs(g, footW, footH, footD);
      pushT(b.stand, g, trans(xOff, footH / 2, 0));
    }
  }

  // PPM magnet stack — main cylinder
  const ppmR = 0.08, ppmH = 1.2;
  const ppmBase = 0.2;
  {
    const g = new THREE.CylinderGeometry(ppmR, ppmR, ppmH, SEGS);
    applyTiledCylinderUVs(g, ppmR, ppmH, SEGS);
    pushT(b.iron, g, trans(0, ppmBase + ppmH / 2, 0));
  }

  // PPM ring magnets (periodic rings along the stack)
  for (let i = 0; i < 4; i++) {
    const yFrac = 0.15 + i * 0.23;
    const g = new THREE.TorusGeometry(ppmR + 0.005, 0.012, 8, SEGS);
    pushT(b.detail, g, trans(0, ppmBase + ppmH * yFrac, 0));
  }

  // Tube extensions above and below PPM
  const tubeR = 0.04, tubeH = 0.15;
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, SEGS);
    applyTiledCylinderUVs(g, tubeR, tubeH, SEGS);
    pushT(b.copper, g, trans(0, ppmBase - tubeH / 2, 0));
  }
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, SEGS);
    applyTiledCylinderUVs(g, tubeR, tubeH, SEGS);
    pushT(b.copper, g, trans(0, ppmBase + ppmH + tubeH / 2, 0));
  }

  // Collector at top
  const collR = 0.07, collH = 0.12;
  {
    const g = new THREE.CylinderGeometry(collR, collR, collH, SEGS);
    applyTiledCylinderUVs(g, collR, collH, SEGS);
    pushT(b.accent, g, trans(0, ppmBase + ppmH + tubeH + collH / 2, 0));
  }

  // Output waveguide stub near top
  {
    const g = new THREE.BoxGeometry(0.1, 0.05, 0.06);
    applyTiledBoxUVs(g, 0.1, 0.05, 0.06);
    pushT(b.copper, g, trans(ppmR + 0.05, ppmBase + ppmH * 0.8, 0));
  }

  return b;
}

// ── IOT (Inductive Output Tube) ────────────────────────────────────

export function _buildIOTRoles() {
  const b = makeBuckets();

  // Base frame
  const baseH = 0.15;
  {
    const g = new THREE.BoxGeometry(0.9, baseH, 1.8);
    applyTiledBoxUVs(g, 0.9, baseH, 1.8);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Short focusing solenoid
  const solR = 0.3, solH = 0.8;
  const solBase = baseH;
  {
    const g = new THREE.CylinderGeometry(solR, solR, solH, SEGS);
    applyTiledCylinderUVs(g, solR, solH, SEGS);
    pushT(b.iron, g, trans(0, solBase + solH / 2, 0));
  }

  // Output cavity — the defining torus bulge
  const cavMajR = 0.35, cavMinR = 0.08;
  {
    const g = new THREE.TorusGeometry(cavMajR, cavMinR, 12, SEGS);
    pushT(b.copper, g, trans(0, solBase + solH + cavMinR, 0));
  }

  // Tube above cavity
  const tubeR = 0.1, tubeH = 0.2;
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, SEGS);
    applyTiledCylinderUVs(g, tubeR, tubeH, SEGS);
    pushT(b.copper, g, trans(0, solBase + solH + cavMinR * 2 + tubeH / 2, 0));
  }

  // Large collector at top
  const collR = 0.25, collH = 0.3;
  {
    const g = new THREE.CylinderGeometry(collR, collR, collH, SEGS);
    applyTiledCylinderUVs(g, collR, collH, SEGS);
    pushT(b.accent, g, trans(0, solBase + solH + cavMinR * 2 + tubeH + collH / 2, 0));
  }

  // Output waveguide from cavity
  {
    const g = new THREE.BoxGeometry(0.15, 0.08, 0.12);
    applyTiledBoxUVs(g, 0.15, 0.08, 0.12);
    pushT(b.copper, g, trans(cavMajR + 0.075, solBase + solH + cavMinR, 0));
  }

  return b;
}

// ── Circulator (Y-junction) ────────────────────────────────────────

export function _buildCirculatorRoles() {
  const b = makeBuckets();

  // Base plate
  const baseH = 0.08;
  {
    const g = new THREE.BoxGeometry(1.2, baseH, 1.2);
    applyTiledBoxUVs(g, 1.2, baseH, 1.2);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // 4 support legs
  const legR = 0.04, legH = 0.35;
  const legInset = 0.35;
  for (const [lx, lz] of [[legInset, legInset], [-legInset, legInset],
                           [legInset, -legInset], [-legInset, -legInset]]) {
    const g = new THREE.CylinderGeometry(legR, legR, legH, 8);
    applyTiledCylinderUVs(g, legR, legH, 8);
    pushT(b.stand, g, trans(lx, baseH + legH / 2, lz));
  }

  // Central Y-junction body — hexagonal cylinder
  const juncR = 0.3, juncH = 0.35;
  const juncY = baseH + legH + juncH / 2;
  {
    const g = new THREE.CylinderGeometry(juncR, juncR, juncH, 6);
    applyTiledCylinderUVs(g, juncR, juncH, 6);
    pushT(b.iron, g, trans(0, juncY, 0));
  }

  // Top cover plate
  {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.02, 6);
    applyTiledCylinderUVs(g, 0.32, 0.02, 6);
    pushT(b.iron, g, trans(0, juncY + juncH / 2 + 0.01, 0));
  }

  // Three waveguide stubs at 120° intervals
  const wgW = 0.16, wgH = 0.10, wgLen = 0.25;
  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (let i = 0; i < 3; i++) {
    const angle = angles[i];
    const dist = juncR + wgLen / 2;
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    const g = new THREE.BoxGeometry(wgW, wgH, wgLen);
    applyTiledBoxUVs(g, wgW, wgH, wgLen);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(x, juncY, z),
      rotY(angle),
    );
    pushT(b.copper, g, m);
  }

  // Dummy load on the third port with cooling fins
  const loadR = 0.14, loadH = 0.35;
  const loadAngle = angles[2];
  const loadDist = juncR + wgLen + loadR;
  const loadX = Math.sin(loadAngle) * loadDist;
  const loadZ = Math.cos(loadAngle) * loadDist;
  {
    const g = new THREE.CylinderGeometry(loadR, loadR, loadH, SEGS);
    applyTiledCylinderUVs(g, loadR, loadH, SEGS);
    pushT(b.accent, g, trans(loadX, juncY, loadZ));
  }
  // Cooling fins on the load
  const finR = 0.18, finH = 0.01;
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(finR, finR, finH, SEGS);
    applyTiledCylinderUVs(g, finR, finH, SEGS);
    pushT(b.detail, g, trans(loadX, juncY - loadH / 2 + loadH * (i + 1) / 4, loadZ));
  }

  return b;
}

// ── RF Coupler ─────────────────────────────────────────────────────

export function _buildRFCouplerRoles() {
  const b = makeBuckets();

  // Base plate
  const baseH = 0.08;
  {
    const g = new THREE.BoxGeometry(0.8, baseH, 0.8);
    applyTiledBoxUVs(g, 0.8, baseH, 0.8);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Support frame — two vertical rails
  const railW = 0.06, railD = 0.06, railH = 1.1;
  for (const side of [-0.25, 0.25]) {
    const g = new THREE.BoxGeometry(railW, railH, railD);
    applyTiledBoxUVs(g, railW, railH, railD);
    pushT(b.stand, g, trans(side, baseH + railH / 2, 0));
  }

  // Cross-brace between rails
  {
    const g = new THREE.BoxGeometry(0.5, 0.05, railD);
    applyTiledBoxUVs(g, 0.5, 0.05, railD);
    pushT(b.stand, g, trans(0, baseH + railH * 0.15, 0));
  }

  // Main coupler body — copper cylinder
  const bodyR = 0.18, bodyH = 0.7;
  const bodyBase = baseH + 0.2;
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyH, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyH, SEGS);
    pushT(b.copper, g, trans(0, bodyBase + bodyH / 2, 0));
  }

  // Flanges at top and bottom of body
  const flangeR = 0.26, flangeH = 0.04;
  {
    const g = new THREE.CylinderGeometry(flangeR, flangeR, flangeH, SEGS);
    applyTiledCylinderUVs(g, flangeR, flangeH, SEGS);
    pushT(b.copper, g, trans(0, bodyBase + flangeH / 2, 0));
  }
  {
    const g = new THREE.CylinderGeometry(flangeR, flangeR, flangeH, SEGS);
    applyTiledCylinderUVs(g, flangeR, flangeH, SEGS);
    pushT(b.copper, g, trans(0, bodyBase + bodyH - flangeH / 2, 0));
  }

  // Ceramic window at mid-height
  const winR = 0.15, winH = 0.03;
  {
    const g = new THREE.CylinderGeometry(winR, winR, winH, SEGS);
    applyTiledCylinderUVs(g, winR, winH, SEGS);
    pushT(b.pipe, g, trans(0, bodyBase + bodyH / 2, 0));
  }

  // Waveguide stub extending from top flange
  {
    const g = new THREE.BoxGeometry(0.14, 0.15, 0.10);
    applyTiledBoxUVs(g, 0.14, 0.15, 0.10);
    pushT(b.copper, g, trans(0, bodyBase + bodyH + 0.075, 0));
  }

  // Cooling water fittings on the body
  for (const zOff of [-0.12, 0.12]) {
    const g = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8);
    applyTiledCylinderUVs(g, 0.02, 0.08, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(bodyR + 0.04, bodyBase + bodyH * 0.4, zOff),
      rotZ(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  return b;
}

// ── Gyrotron ───────────────────────────────────────────────────────

export function _buildGyrotronRoles() {
  const b = makeBuckets();

  // Footprint: 1.5m W × 2m L × 3m H
  // Heavy base frame
  const baseH = 0.18;
  {
    const g = new THREE.BoxGeometry(1.3, baseH, 1.8);
    applyTiledBoxUVs(g, 1.3, baseH, 1.8);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Superconducting magnet cryostat — the dominant visual element
  const cryoR = 0.5, cryoH = 1.8;
  const cryoBase = baseH;
  {
    const g = new THREE.CylinderGeometry(cryoR, cryoR, cryoH, SEGS);
    applyTiledCylinderUVs(g, cryoR, cryoH, SEGS);
    pushT(b.iron, g, trans(0, cryoBase + cryoH / 2, 0));
  }

  // Cryostat end caps
  for (const yOff of [0, cryoH]) {
    const g = new THREE.CylinderGeometry(0.52, 0.52, 0.05, SEGS);
    applyTiledCylinderUVs(g, 0.52, 0.05, SEGS);
    pushT(b.iron, g, trans(0, cryoBase + yOff + (yOff === 0 ? 0.025 : -0.025), 0));
  }

  // Cryogen transfer lines (detail rings on cryostat)
  for (let i = 0; i < 3; i++) {
    const g = new THREE.TorusGeometry(cryoR + 0.01, 0.018, 8, SEGS);
    pushT(b.detail, g, trans(0, cryoBase + 0.3 + i * 0.6, 0));
  }

  // Electron gun assembly at bottom (below cryostat)
  const gunR = 0.18, gunH = 0.15;
  {
    const g = new THREE.CylinderGeometry(gunR, gunR * 0.7, gunH, SEGS);
    applyTiledCylinderUVs(g, gunR, gunH, SEGS);
    pushT(b.copper, g, trans(0, cryoBase - gunH / 2, 0));
  }

  // Interaction cavity tube emerging from top
  const tubeR = 0.12, tubeH = 0.3;
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, SEGS);
    applyTiledCylinderUVs(g, tubeR, tubeH, SEGS);
    pushT(b.copper, g, trans(0, cryoBase + cryoH + tubeH / 2, 0));
  }

  // Collector at top — large for 1 MW dissipation
  const collR = 0.3, collH = 0.35;
  {
    const g = new THREE.CylinderGeometry(collR, collR * 0.8, collH, SEGS);
    applyTiledCylinderUVs(g, collR, collH, SEGS);
    pushT(b.accent, g, trans(0, cryoBase + cryoH + tubeH + collH / 2, 0));
  }

  // Output waveguide — large for MW power
  {
    const g = new THREE.BoxGeometry(0.2, 0.12, 0.18);
    applyTiledBoxUVs(g, 0.2, 0.12, 0.18);
    pushT(b.copper, g, trans(cryoR + 0.1, cryoBase + cryoH * 0.75, 0));
  }

  // Cooling water manifolds on cryostat side
  for (let i = 0; i < 2; i++) {
    const pipeR = 0.025, pipeH = 0.6;
    const g = new THREE.CylinderGeometry(pipeR, pipeR, pipeH, 8);
    applyTiledCylinderUVs(g, pipeR, pipeH, 8);
    pushT(b.pipe, g, trans(cryoR + 0.04, cryoBase + cryoH * 0.5, (i === 0 ? 0.15 : -0.15)));
  }

  return b;
}
