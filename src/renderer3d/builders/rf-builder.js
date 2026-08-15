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
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [], glow: [] };
}

// Box helper — the rack and waveguide builders below are almost entirely
// boxes, and spelling out the geometry/UV/transform trio at every one of
// them buries the dimensions that actually matter.
function boxAt(bucket, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  applyTiledBoxUVs(g, w, h, d);
  pushT(bucket, g, trans(x, y, z));
}
function cylY(bucket, r, h, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  pushT(bucket, g, trans(x, y, z));
}
// Cylinder laid along Z (rotX) or along X (rotZ).
function cylZ(bucket, r, len, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  applyTiledCylinderUVs(g, r, len, segs);
  pushT(bucket, g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotX(Math.PI / 2)));
}
function cylX(bucket, r, len, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  applyTiledCylinderUVs(g, r, len, segs);
  pushT(bucket, g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotZ(Math.PI / 2)));
}

// A bolted rectangular-waveguide flange: the plate plus the four bolt heads
// that make it read as bolted rather than welded. `axis` is the run direction
// the flange sits across.
function wgFlange(b, { axis, x, y, z, bw, bh, t = 0.045, boltR = 0.018 }) {
  if (axis === 'z') {
    boxAt(b.detail, bw, bh, t, x, y, z);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      cylZ(b.iron, boltR, t + 0.03, x + sx * (bw / 2 - 0.05), y + sy * (bh / 2 - 0.045), z, 6);
    }
  } else {
    boxAt(b.detail, t, bh, bw, x, y, z);
    for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
      cylX(b.iron, boltR, t + 0.03, x, y + sy * (bh / 2 - 0.045), z + sz * (bw / 2 - 0.05), 6);
    }
  }
}

// Sagging cable run drawn as a chain of short cylinders. `plane` picks which
// pair of axes the catenary lives in; a cylinder's own axis is +Y, so each
// segment needs only a single-axis rotation to lie along its chord.
function cableArc(bucket, plane, fixed, a0, b0, a1, b1, sag, r, segs = 7) {
  const pt = (t) => {
    const a = a0 + (a1 - a0) * t;
    const bb = b0 + (b1 - b0) * t - sag * 4 * t * (1 - t);
    return [a, bb];
  };
  for (let i = 0; i < segs; i++) {
    const [pa, pb] = pt(i / segs);
    const [qa, qb] = pt((i + 1) / segs);
    const da = qa - pa, db = qb - pb;
    const len = Math.hypot(da, db);
    const g = new THREE.CylinderGeometry(r, r, len * 1.08, 6);
    applyTiledCylinderUVs(g, r, len, 6);
    const mid = [(pa + qa) / 2, (pb + qb) / 2];
    if (plane === 'zy') {
      // a = z, b = y. rotX(t) sends +Y to (0, cos t, sin t).
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(fixed, mid[1], mid[0]), rotX(Math.atan2(da, db)),
      );
      pushT(bucket, g, m);
    } else {
      // a = x, b = y. rotZ(t) sends +Y to (-sin t, cos t, 0).
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(mid[0], mid[1], fixed), rotZ(Math.atan2(-da, db)),
      );
      pushT(bucket, g, m);
    }
  }
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

// The SLAC 5045 gets its own builder rather than another _buildKlystronBase
// call: what makes it read as the cheap production tube is the oil tank it
// stands in and the banded solenoid stack above it, neither of which the
// shared helper models. Envelope is 2x3 sub-tiles by 4 tall — 1.0 x 1.5 x 2.0 m
// — and every part below stays inside it.
export function _buildSLAC5045KlystronRoles() {
  const b = makeBuckets();

  // Oil tank — the gun end lives down here, immersed for HV standoff.
  const tankW = 0.86, tankD = 1.20, tankH = 0.30;
  {
    const g = new THREE.BoxGeometry(tankW, tankH, tankD);
    applyTiledBoxUVs(g, tankW, tankH, tankD);
    pushT(b.stand, g, trans(0, tankH / 2, 0));
  }
  // Tank lid, slightly proud of the tank sides.
  const lidH = 0.05, lidTop = tankH + lidH;
  {
    const g = new THREE.BoxGeometry(tankW + 0.04, lidH, tankD + 0.04);
    applyTiledBoxUVs(g, tankW + 0.04, lidH, tankD + 0.04);
    pushT(b.iron, g, trans(0, tankH + lidH / 2, 0));
  }
  // HV bushing rising out of the tank behind the tube.
  {
    const bushR = 0.07, bushH = 0.20;
    const g = new THREE.CylinderGeometry(bushR, bushR * 1.3, bushH, SEGS);
    applyTiledCylinderUVs(g, bushR, bushH, SEGS);
    pushT(b.pipe, g, trans(0, lidTop + bushH / 2, -0.42));
  }

  // Focusing solenoid — the body of the tube.
  const solR = 0.28, solH = 0.98;
  const solBase = lidTop;
  {
    const g = new THREE.CylinderGeometry(solR, solR, solH, SEGS);
    applyTiledCylinderUVs(g, solR, solH, SEGS);
    pushT(b.iron, g, trans(0, solBase + solH / 2, 0));
  }
  // Solenoid end plates.
  for (const yOff of [0, solH]) {
    const capR = 0.31, capH = 0.04;
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    pushT(b.iron, g, trans(0, solBase + yOff + (yOff === 0 ? capH / 2 : -capH / 2), 0));
  }
  // Coil bands. rotX puts the ring in the horizontal plane so it wraps the
  // solenoid rather than standing edge-on through it.
  for (let i = 0; i < 5; i++) {
    const frac = 0.12 + i * 0.19;
    const g = new THREE.TorusGeometry(solR + 0.015, 0.022, 8, SEGS);
    g.applyMatrix4(rotX(Math.PI / 2));
    pushT(b.copper, g, trans(0, solBase + solH * frac, 0));
  }

  // Drift tube neck above the solenoid.
  const neckR = 0.085, neckH = 0.16;
  const neckBase = solBase + solH;
  {
    const g = new THREE.CylinderGeometry(neckR, neckR, neckH, SEGS);
    applyTiledCylinderUVs(g, neckR, neckH, SEGS);
    pushT(b.copper, g, trans(0, neckBase + neckH / 2, 0));
  }

  // Output waveguide, off the output cavity just below the collector.
  const wgY = neckBase + neckH * 0.5;
  {
    const runW = 0.34, wgH = 0.075, wgD = 0.10;
    const g = new THREE.BoxGeometry(runW, wgH, wgD);
    applyTiledBoxUVs(g, runW, wgH, wgD);
    pushT(b.copper, g, trans(neckR + runW / 2 - 0.02, wgY, 0));
  }
  // Waveguide flange at the far end of the run.
  {
    const flW = 0.04, flH = 0.14, flD = 0.17;
    const g = new THREE.BoxGeometry(flW, flH, flD);
    applyTiledBoxUVs(g, flW, flH, flD);
    pushT(b.detail, g, trans(neckR + 0.32 + flW / 2 - 0.02, wgY, 0));
  }

  // Collector.
  const collR = 0.16, collH = 0.26;
  const collBase = neckBase + neckH;
  {
    const g = new THREE.CylinderGeometry(collR, collR, collH, SEGS);
    applyTiledCylinderUVs(g, collR, collH, SEGS);
    pushT(b.accent, g, trans(0, collBase + collH / 2, 0));
  }
  // Collector cooling discs.
  for (let i = 0; i < 3; i++) {
    const finR = 0.19;
    const g = new THREE.CylinderGeometry(finR, finR, 0.012, SEGS);
    applyTiledCylinderUVs(g, finR, 0.012, SEGS);
    pushT(b.detail, g, trans(0, collBase + 0.06 + i * 0.07, 0));
  }
  // Ion pump stub on top.
  {
    const stubR = 0.05, stubH = 0.10;
    const g = new THREE.CylinderGeometry(stubR, stubR, stubH, SEGS);
    applyTiledCylinderUVs(g, stubR, stubH, SEGS);
    pushT(b.pipe, g, trans(0, collBase + collH + stubH / 2, 0));
  }

  return b;
}

// ── Solid-state amplifier racks ────────────────────────────────────
//
// The two solid-state units are the only RF sources in the game that are
// NOT tubes, and the model exists to say so at a glance: where a klystron
// is one tall cylinder on a stand, these are cabinets full of slide-in
// modules. The module stack on the front face is the whole read, so the
// slabs protrude past the cabinet skin rather than sitting flush — flush
// modules vanish into the box at dimetric zoom.
//
// Front face is +X (matching the decal these components used to carry).

// One cabinet of the family. `cz` is its centre along the ganging axis.
function _ampCabinet(b, {
  cz, width, depth, frontX, yBase, height,
  modules, modH, modPitch, modBottom, modZ,
}) {
  const backX = frontX - depth;
  const cx = (frontX + backX) / 2;
  const yMid = yBase + height / 2;

  // Painted cabinet shell.
  boxAt(b.accent, depth, height, width, cx, yMid, cz);
  // Corner posts, proud of the skin so the cabinet reads as a framed rack.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    boxAt(b.stand, 0.05, height, 0.05,
      cx + sx * (depth / 2 - 0.015), yMid, cz + sz * (width / 2 - 0.015));
  }

  // Slide-in amplifier modules.
  for (let i = 0; i < modules; i++) {
    const y = modBottom + modH / 2 + i * modPitch;
    boxAt(b.pipe, 0.06, modH, modZ, frontX, y, cz);
    // Extraction handles either side of the module face.
    for (const sz of [-1, 1]) {
      boxAt(b.detail, 0.04, modH * 0.42, 0.05,
        frontX + 0.045, y, cz + sz * (modZ / 2 - 0.07));
    }
    // Fault/RF-on lamp between the handles.
    boxAt(b.detail, 0.02, 0.022, 0.022, frontX + 0.04, y + modH * 0.28, cz);
  }

  // Intake louvres on the lower bay, below the module stack.
  const louvreTop = modBottom - 0.05;
  for (let i = 0; i < 4; i++) {
    const y = yBase + 0.10 + i * 0.09;
    if (y > louvreTop) break;
    boxAt(b.detail, 0.03, 0.04, modZ, frontX - 0.01, y, cz);
  }

  // Roof: cap plate, extract cowl, fan hub.
  const capY = yBase + height + 0.025;
  boxAt(b.iron, depth + 0.04, 0.05, width + 0.04, cx, capY, cz);
  boxAt(b.detail, depth * 0.42, 0.06, width * 0.72, cx, capY + 0.055, cz);
  cylY(b.detail, width * 0.13, 0.05, cx, capY + 0.11, cz, 8);
}

export function _buildSolidStateAmpRoles() {
  const b = makeBuckets();
  // Envelope: 2 x 2 sub-tiles by 4 tall — 1.0 x 1.0 x 2.0 m.
  const yBase = 0.09, height = 1.70;

  boxAt(b.stand, 0.92, yBase, 0.92, 0, yBase / 2, 0);
  _ampCabinet(b, {
    cz: 0, width: 0.86, depth: 0.84, frontX: 0.42, yBase, height,
    modules: 9, modH: 0.10, modPitch: 0.12, modBottom: 0.62, modZ: 0.78,
  });

  // Combining network down the back wall, and the coax that leaves it. The
  // riser deliberately clears the cabinet roof: a 35 kW rack whose output is
  // buried inside the box has no silhouette at all.
  boxAt(b.copper, 0.08, 1.10, 0.20, -0.42, 1.00, 0);
  cylY(b.copper, 0.06, 0.35, -0.42, 1.72, 0);
  cylY(b.detail, 0.075, 0.03, -0.42, 1.91, 0);
  // Coax elbow tying the spine to the riser.
  boxAt(b.copper, 0.10, 0.10, 0.16, -0.42, 1.55, 0);

  // Four individually flanged RF outputs along the combiner wall. These are
  // the physical ports declared in utility-ports-v2, not decorative vents:
  // four direct runs avoid an impedance-penalised waveguide tee.
  for (const [z, y] of [[-0.30, 0.78], [-0.10, 0.78], [0.10, 1.12], [0.30, 1.12]]) {
    boxAt(b.copper, 0.12, 0.07, 0.07, -0.48, y, z);
    wgFlange(b, { axis: 'x', x: -0.50, y, z, bw: 0.12, bh: 0.12, t: 0.025 });
  }

  // AC feed conduit at the front corner, opposite the RF combining wall.
  boxAt(b.detail, 0.06, 0.55, 0.07, 0.43, 0.37, 0.30);
  // Dedicated HV cable gland on that conduit. The persistent utility-port
  // fitting sits over this collar, making the input distinct from the copper
  // RF combining spine and its four output flanges on the opposite face.
  cylX(b.accent, 0.055, 0.10, 0.46, 0.37, 0.30, 10);
  cylX(b.copper, 0.027, 0.14, 0.50, 0.37, 0.30, 8);

  return b;
}

export function _buildHighPowerSSARoles() {
  const b = makeBuckets();
  // Envelope: 3 x 4 sub-tiles by 4 tall — 1.5 x 2.0 x 2.0 m.
  // Same family as the 35 kW rack, ganged three wide: 300 kW is not a
  // different technology, it is more of the same modules, and the model
  // should cost the player nothing to recognise.
  const yBase = 0.10, height = 1.66;

  boxAt(b.stand, 1.30, yBase, 1.92, 0, yBase / 2, 0);

  const cabZ = [-0.62, 0, 0.62];
  for (const cz of cabZ) {
    _ampCabinet(b, {
      cz, width: 0.58, depth: 1.06, frontX: 0.48, yBase, height,
      modules: 10, modH: 0.11, modPitch: 0.13, modBottom: 0.40, modZ: 0.50,
    });
  }
  // Seam strips between adjacent cabinets.
  for (const z of [-0.31, 0.31]) {
    boxAt(b.stand, 1.08, height, 0.04, -0.05, yBase + height / 2, z);
  }

  // Combining manifold: one fat coax trunk along the back with a riser from
  // each cabinet, then a single elbow out the top. This is what buys the
  // "three cabinets, one transmitter" read.
  cylZ(b.copper, 0.10, 1.70, -0.63, 1.40, 0);
  for (const cz of cabZ) cylY(b.copper, 0.05, 0.78, -0.63, 0.92, cz);
  cylY(b.copper, 0.10, 0.40, -0.61, 1.60, 0.83);
  cylY(b.detail, 0.13, 0.04, -0.61, 1.82, 0.83);

  // Switchgear cubicle for the 500 kW wall feed.
  boxAt(b.iron, 0.16, 0.70, 0.30, -0.63, 0.45, -0.83);
  boxAt(b.detail, 0.03, 0.20, 0.22, -0.72, 0.55, -0.83);

  return b;
}

// ── Modulator ──────────────────────────────────────────────────────

export function _buildModulatorRoles() {
  const b = makeBuckets();
  // Envelope: 2 x 3 sub-tiles by 4 tall — 1.0 x 1.5 x 2.0 m.
  //
  // A klystron modulator is a pulse transformer sitting in a tank of oil.
  // Everything that makes it read as dangerous lives above the tank lid:
  // three porcelain HV bushings and the cable festoon between them. The
  // tank itself is deliberately a plain heavy slab — it is the thing the
  // hazard sits on top of.

  // Skid and oil tank.
  boxAt(b.stand, 0.94, 0.10, 1.42, 0, 0.05, 0);
  boxAt(b.iron, 0.86, 1.00, 1.30, 0, 0.60, 0);
  const lidTop = 1.17;
  boxAt(b.iron, 0.92, 0.07, 1.36, 0, lidTop - 0.035, 0);

  // Radiator fins down the back face — oil-cooled, like a substation
  // transformer.
  for (const z of [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]) {
    boxAt(b.detail, 0.07, 0.72, 0.06, -0.46, 0.60, z);
  }

  // Oil conservator along the back of the lid.
  cylZ(b.pipe, 0.11, 1.00, -0.26, 1.34, 0);
  for (const z of [-0.34, 0.34]) boxAt(b.detail, 0.05, 0.18, 0.05, -0.26, 1.24, z);

  // Front access door with its hazard plate and handle.
  boxAt(b.accent, 0.03, 0.80, 1.00, 0.435, 0.60, 0);
  boxAt(b.detail, 0.02, 0.16, 0.20, 0.455, 0.86, -0.30);
  boxAt(b.detail, 0.03, 0.05, 0.05, 0.46, 0.60, 0.42);
  for (const z of [-0.44, 0.44]) boxAt(b.detail, 0.03, 0.07, 0.05, 0.45, 0.95, z);

  // Three HV bushings on the lid.
  const bushX = 0.16, bushZ = [-0.42, 0, 0.42];
  const termY = 1.71;
  for (const z of bushZ) {
    cylY(b.iron, 0.10, 0.05, bushX, lidTop + 0.025, z);
    {
      const g = new THREE.CylinderGeometry(0.055, 0.075, 0.46, SEGS);
      applyTiledCylinderUVs(g, 0.075, 0.46, SEGS);
      pushT(b.pipe, g, trans(bushX, lidTop + 0.05 + 0.23, z));
    }
    for (const y of [1.30, 1.44, 1.58]) cylY(b.detail, 0.115, 0.025, bushX, y, z);
    cylY(b.copper, 0.07, 0.06, bushX, termY, z);
  }

  // Cable festoon between the bushing terminals, and the thick output cable
  // that drops away toward the klystron.
  cableArc(b.detail, 'zy', bushX, bushZ[0], termY, bushZ[1], termY, 0.13, 0.024);
  cableArc(b.detail, 'zy', bushX, bushZ[1], termY, bushZ[2], termY, 0.13, 0.024);
  cableArc(b.detail, 'xy', bushZ[2], bushX, termY, 0.44, 1.22, 0.10, 0.028);

  return b;
}

// ── LLRF controller ────────────────────────────────────────────────

export function _buildLLRFControllerRoles() {
  const b = makeBuckets();
  // Envelope: 1 x 2 sub-tiles by 2 tall — 0.5 x 1.0 x 1.0 m.
  //
  // A half-height instrument rack. There is no physics to show here, so the
  // model earns its keep purely as texture: a stack of chassis faces with
  // handles, a patch panel of coax bulkheads, and one screen. Rack width
  // runs along Z because the front panel faces +X.
  const frontX = 0.195;

  boxAt(b.stand, 0.44, 0.06, 0.90, 0, 0.03, 0);
  // Frame posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    boxAt(b.stand, 0.05, 0.80, 0.05, sx * 0.185, 0.46, sz * 0.395);
  }
  // Skins.
  for (const sz of [-1, 1]) boxAt(b.accent, 0.40, 0.76, 0.025, 0, 0.44, sz * 0.408);
  boxAt(b.accent, 0.025, 0.76, 0.82, -0.195, 0.44, 0);

  // Five rack units.
  for (let i = 0; i < 5; i++) {
    const y = 0.19 + i * 0.13;
    boxAt(b.iron, 0.36, 0.10, 0.76, 0, y, 0);
    boxAt(b.pipe, 0.03, 0.105, 0.78, frontX, y, 0);
    for (const sz of [-1, 1]) {
      boxAt(b.detail, 0.035, 0.05, 0.05, 0.225, y, sz * 0.32);
    }
    boxAt(b.detail, 0.02, 0.02, 0.16, 0.215, y + 0.025, 0.20);
  }
  // The top unit is the operator console: a screen and two tuning knobs.
  boxAt(b.glow, 0.02, 0.07, 0.30, 0.215, 0.71, -0.06);
  for (const sz of [-1, 1]) cylX(b.pipe, 0.022, 0.03, 0.225, 0.32, sz * 0.20, 8);

  // Patch panel of coax bulkheads across the top, then the lid.
  boxAt(b.iron, 0.36, 0.06, 0.76, 0, 0.81, 0);
  for (let i = 0; i < 8; i++) {
    cylX(b.pipe, 0.015, 0.05, 0.215, 0.81, -0.28 + i * 0.08, 6);
  }
  boxAt(b.iron, 0.42, 0.04, 0.86, 0, 0.88, 0);

  // Fibre/power conduit leaving the back.
  boxAt(b.detail, 0.05, 0.55, 0.06, -0.215, 0.33, 0.30);

  return b;
}

// ── Waveguide manifold ─────────────────────────────────────────────

export function _buildWaveguideManifoldRoles() {
  const b = makeBuckets();
  // Envelope: 2 x 3 sub-tiles by 2 tall — 1.0 x 1.5 x 1.0 m.
  //
  // Nothing else on the floor is rectangular waveguide, so this leans all
  // the way into it: a straight WR-sized trunk on stands, bolted flanges,
  // square-cornered E-plane tees dropping to mitred bends, and a blank
  // H-arm stub on top. Cross-sections are 0.22 x 0.11 m — several times
  // oversize for the band, but a true WR-284 section is two pixels wide at
  // this camera and reads as a wire.
  const trunkY = 0.62, bw = 0.22, bh = 0.11;
  const trunkHalf = 0.68;

  // Main run.
  boxAt(b.copper, bw, bh, trunkHalf * 2, 0, trunkY, 0);
  // Bolted spool joints at each end, plus the terminating flanges.
  for (const sz of [-1, 1]) {
    wgFlange(b, { axis: 'z', x: 0, y: trunkY, z: sz * 0.6625, bw: 0.32, bh: 0.21 });
    wgFlange(b, { axis: 'z', x: 0, y: trunkY, z: sz * 0.5625, bw: 0.32, bh: 0.21 });
  }
  // Tuning stubs / directional-coupler ports on the broad wall.
  for (const z of [-0.50, 0.50]) cylY(b.pipe, 0.025, 0.06, 0, trunkY + 0.085, z, 8);

  // Two H-frame stands.
  for (const z of [-0.20, 0.20]) {
    for (const sx of [-1, 1]) {
      boxAt(b.stand, 0.05, 0.56, 0.05, sx * 0.14, 0.28, z);
      boxAt(b.stand, 0.14, 0.03, 0.16, sx * 0.14, 0.015, z);
    }
    boxAt(b.stand, 0.33, 0.04, 0.05, 0, 0.58, z);
  }

  // Magic-tee H-arm: a short stub up off the trunk, blanked off.
  boxAt(b.copper, 0.11, 0.20, 0.11, 0, trunkY + 0.155, 0);
  boxAt(b.detail, 0.20, 0.04, 0.20, 0, 0.895, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cylY(b.iron, 0.015, 0.07, sx * 0.07, 0.895, sz * 0.07, 6);
  }

  // Two E-plane branches: down out of the trunk, mitred 90 degrees, and out
  // the front to a bolted flange where the cavity feed picks up.
  for (const z of [-0.36, 0.36]) {
    boxAt(b.copper, 0.26, 0.17, 0.26, 0, trunkY, z);           // tee body
    boxAt(b.copper, 0.11, 0.20, 0.22, 0, 0.44, z);             // down leg
    boxAt(b.copper, 0.17, 0.13, 0.22, 0.03, 0.275, z);         // mitred corner
    boxAt(b.copper, 0.28, 0.11, 0.22, 0.255, 0.275, z);        // out run
    wgFlange(b, { axis: 'x', x: 0.4175, y: 0.275, z, bw: 0.32, bh: 0.21 });
  }

  // Every branch leaves on +X, so the assembly as built is lopsided in its
  // tile. Slide the whole thing back along -X to re-centre the mass rather
  // than adding decorative stubs on the other side.
  const recentre = trans(-0.12, 0, 0);
  for (const role of Object.keys(b)) for (const g of b[role]) g.applyMatrix4(recentre);

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
