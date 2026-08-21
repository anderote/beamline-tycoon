// Procedural geometry for Structure -> Hangings.
// THREE is a CDN global — do not import it here.

const HANGING_IDS = new Set([
  'abstractPainting',
  'landscapePainting',
  'beamlinePhotograph',
  'acceleratorBlueprint',
  'wallTelevision',
  'largeWallTelevision',
  'wallWhiteboard',
  'wallBlackboard',
  'noticeBoard',
]);

export function hasHangingGeometry(typeId) {
  return HANGING_IDS.has(typeId);
}

function material(color, { roughness = 0.62, metalness = 0.05, emissive = 0x000000 } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
}

function addBox(group, w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addDisc(group, radius, depth, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, 20), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function framedPanel(width, height, {
  frameColor = 0x5a3b24,
  surfaceColor = 0xe6dfcf,
  surfaceMaterial = null,
} = {}) {
  const group = new THREE.Group();
  const frame = material(frameColor, { roughness: 0.48 });
  const surface = surfaceMaterial || material(surfaceColor, { roughness: 0.72 });
  const bar = Math.max(0.035, Math.min(width, height) * 0.055);
  const depth = 0.065;
  addBox(group, width - bar * 1.35, height - bar * 1.35, 0.035, surface, 0, 0, 0.035);
  addBox(group, width, bar, depth, frame, 0, height / 2 - bar / 2, 0.045);
  addBox(group, width, bar, depth, frame, 0, -height / 2 + bar / 2, 0.045);
  addBox(group, bar, height - bar * 2, depth, frame, -width / 2 + bar / 2, 0, 0.045);
  addBox(group, bar, height - bar * 2, depth, frame, width / 2 - bar / 2, 0, 0.045);
  return { group, bar };
}

function addAbstractArt(group, width, height) {
  const front = 0.063;
  addBox(group, width * 0.23, height * 0.58, 0.012, material(0xd95032), -width * 0.22, height * 0.06, front);
  addBox(group, width * 0.34, height * 0.20, 0.014, material(0x244f73), width * 0.17, height * 0.21, front + 0.002);
  addBox(group, width * 0.43, height * 0.17, 0.016, material(0xe0aa35), width * 0.08, -height * 0.20, front + 0.004);
  addDisc(group, height * 0.12, 0.015, material(0xefe4c0), width * 0.24, -height * 0.02, front + 0.008);
}

function addLandscape(group, width, height) {
  const front = 0.063;
  addBox(group, width * 0.88, height * 0.40, 0.012, material(0x7fa9bd), 0, height * 0.16, front);
  addBox(group, width * 0.88, height * 0.35, 0.014, material(0x56734a), 0, -height * 0.19, front + 0.002);
  addBox(group, width * 0.36, height * 0.23, 0.016, material(0x3f5661), -width * 0.20, -height * 0.02, front + 0.005);
  addBox(group, width * 0.31, height * 0.18, 0.017, material(0x6c806b), width * 0.25, -height * 0.07, front + 0.006);
  addDisc(group, height * 0.085, 0.014, material(0xf1d47a), width * 0.26, height * 0.20, front + 0.008);
}

function addBeamlinePhoto(group, width, height) {
  const front = 0.063;
  const steel = material(0xabb6bd, { metalness: 0.55, roughness: 0.35 });
  addBox(group, width * 0.88, height * 0.72, 0.012, material(0x26343e), 0, 0, front);
  addBox(group, width * 0.76, height * 0.055, 0.018, steel, 0, -height * 0.18, front + 0.006);
  for (const x of [-width * 0.24, 0, width * 0.24]) {
    addDisc(group, height * 0.105, 0.018, steel, x, height * 0.04, front + 0.01);
    addDisc(group, height * 0.054, 0.021, material(0x34434d), x, height * 0.04, front + 0.018);
  }
}

function addBlueprint(group, width, height) {
  const front = 0.063;
  const ink = material(0xd9f1f5, { roughness: 0.8 });
  addBox(group, width * 0.88, height * 0.72, 0.012, material(0x245e82), 0, 0, front);
  addBox(group, width * 0.73, 0.018, 0.018, ink, 0, height * 0.12, front + 0.009);
  addBox(group, width * 0.64, 0.018, 0.018, ink, -width * 0.04, -height * 0.12, front + 0.009);
  for (const x of [-width * 0.28, -width * 0.08, width * 0.14, width * 0.31]) {
    addDisc(group, height * 0.055, 0.018, ink, x, 0, front + 0.012);
    addDisc(group, height * 0.031, 0.021, material(0x245e82), x, 0, front + 0.02);
  }
}

function television(width, height) {
  const group = new THREE.Group();
  const shell = material(0x171b1e, { metalness: 0.48, roughness: 0.32 });
  const screen = material(0x274b5c, { roughness: 0.16, metalness: 0.12, emissive: 0x07141a });
  addBox(group, width, height, 0.09, shell, 0, 0, 0.055);
  addBox(group, width * 0.93, height * 0.87, 0.018, screen, 0, height * 0.02, 0.112);
  addBox(group, width * 0.22, height * 0.035, 0.012, material(0x4c93aa, { emissive: 0x0a222b }), 0, height * 0.05, 0.124);
  addBox(group, width * 0.32, height * 0.022, 0.012, material(0x79b6c5, { emissive: 0x102b31 }), -width * 0.15, -height * 0.08, 0.124);
  addDisc(group, Math.min(width, height) * 0.012, 0.014, material(0x57e36c, { emissive: 0x16471c }), width * 0.43, -height * 0.43, 0.126);
  addBox(group, width * 0.18, height * 0.18, 0.055, shell, 0, 0, -0.015);
  return group;
}

function writingBoard(width, height, blackboard = false) {
  const surfaceMaterial = material(blackboard ? 0x263b35 : 0xf1f2ed, { roughness: blackboard ? 0.86 : 0.48 });
  const { group } = framedPanel(width, height, {
    frameColor: blackboard ? 0x694a2e : 0xaab2b5,
    surfaceMaterial,
  });
  const ink = material(blackboard ? 0xe3dfc9 : 0x355c83, { roughness: 0.88 });
  const front = 0.065;
  for (let i = 0; i < 4; i++) {
    const lineW = width * (0.25 + i * 0.08);
    addBox(group, lineW, 0.012, 0.012, ink, -width * 0.18 + lineW / 2, height * (0.19 - i * 0.105), front);
  }
  const tray = material(blackboard ? 0x8b6741 : 0x9aa3a7, { metalness: blackboard ? 0.05 : 0.42 });
  addBox(group, width * 0.72, 0.035, 0.12, tray, 0, -height / 2 + 0.035, 0.085);
  for (const [x, color] of [[-0.18, blackboard ? 0xf0ead5 : 0x315ca8], [0.08, blackboard ? 0xe9d66b : 0xc83e35]]) {
    addBox(group, width * 0.12, 0.025, 0.025, material(color), x * width, -height / 2 + 0.075, 0.14);
  }
  return group;
}

function noticeBoard(width, height) {
  const { group } = framedPanel(width, height, { frameColor: 0x6b472a, surfaceColor: 0xa97743 });
  const papers = [
    [-0.22, 0.16, 0xd9e5ed], [0.17, 0.18, 0xf0e8c9], [-0.18, -0.17, 0xe9d0cd], [0.22, -0.14, 0xd7e4cf],
  ];
  for (const [px, py, color] of papers) {
    addBox(group, width * 0.27, height * 0.31, 0.012, material(color, { roughness: 0.9 }), px * width, py * height, 0.067);
    addDisc(group, Math.min(width, height) * 0.018, 0.013, material(0xb52d2d), px * width, py * height + height * 0.11, 0.078);
  }
  return group;
}

export function buildHanging(typeId, footW, _footL, totalH) {
  if (!hasHangingGeometry(typeId)) return null;
  const width = Math.max(0.35, footW * 0.92);
  const height = Math.max(0.3, totalH * 0.84);

  if (typeId === 'wallTelevision' || typeId === 'largeWallTelevision') {
    return television(width, height);
  }
  if (typeId === 'wallWhiteboard') return writingBoard(width, height, false);
  if (typeId === 'wallBlackboard') return writingBoard(width, height, true);
  if (typeId === 'noticeBoard') return noticeBoard(width, height);

  const { group } = framedPanel(width, height, {
    frameColor: typeId === 'acceleratorBlueprint' ? 0x35434c : 0x60422b,
  });
  if (typeId === 'abstractPainting') addAbstractArt(group, width, height);
  else if (typeId === 'landscapePainting') addLandscape(group, width, height);
  else if (typeId === 'beamlinePhotograph') addBeamlinePhoto(group, width, height);
  else addBlueprint(group, width, height);
  return group;
}
