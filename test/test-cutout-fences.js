// Regression coverage for cutout fences disappearing in the default
// transparent-wall view. THREE multiplies a material's opacity by the PNG
// alpha before applying alphaTest. With opacity 0.3 and alphaTest 0.5, even
// fully opaque fence pixels evaluate to 0.3 and the entire mesh is discarded.

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

const near = (a, b, epsilon = 1e-9) => Math.abs(a - b) < epsilon;

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.needsUpdate = false;
  }
  getX(index) { return this.array[index * this.itemSize]; }
  setX(index, value) { this.array[index * this.itemSize] = value; }
}

class BoxGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    this.parameters = { width, height, depth };
    this.attributes = {
      position: new BufferAttribute(new Float32Array(24 * 3), 3),
      uv: new BufferAttribute(new Float32Array(24 * 2), 2),
    };
  }
  clone() {
    const { width, height, depth } = this.parameters;
    return new BoxGeometry(width, height, depth);
  }
  computeVertexNormals() {}
  computeBoundingBox() {}
  computeBoundingSphere() {}
  dispose() {}
}

class Material {
  constructor(options = {}) { Object.assign(this, options); }
  dispose() {}
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vector3();
    this.matrixAutoUpdate = true;
  }
  updateMatrix() {}
}

class TextureLoader {
  load(path) { return { path }; }
}

class Generic {
  constructor() {}
  dispose() {}
  set() { return this; }
}

const three = {
  Vector3,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial: Material,
  TextureLoader,
  DoubleSide: 'DoubleSide',
  FrontSide: 'FrontSide',
  RepeatWrapping: 'RepeatWrapping',
  ClampToEdgeWrapping: 'ClampToEdgeWrapping',
  NearestFilter: 'NearestFilter',
  LinearFilter: 'LinearFilter',
  SRGBColorSpace: 'SRGBColorSpace',
};
globalThis.THREE = new Proxy(three, {
  get: (target, property) => property in target ? target[property] : Generic,
});

const canvasContext = new Proxy({}, { get: () => () => canvasContext });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => canvasContext }),
};

const { WallBuilder } = await import('../src/renderer3d/wall-builder.js');
const { WALL_TYPES } = await import('../src/data/structure.js');

function buildWall(type, visibility = 'transparent', cutawayRoom = null) {
  const group = {
    children: [],
    add(mesh) { this.children.push(mesh); },
    remove(mesh) { this.children = this.children.filter(child => child !== mesh); },
  };
  const builder = new WallBuilder(null);
  builder.build(
    [{ col: 2, row: 3, edge: 'n', type, baseY: { a: 0, b: 0 } }],
    [],
    [],
    group,
    visibility,
    cutawayRoom,
  );
  return group.children[0];
}

console.log('\n=== cutout fences survive the default transparent-wall view ===\n');

for (const [type, def] of Object.entries(WALL_TYPES).filter(([, entry]) => entry.hasAlpha)) {
  const mesh = buildWall(type);
  assert(mesh?.material?.map, `${def.name} keeps its cutout texture`);
  assert(mesh?.material?.transparent === true, `${def.name} uses transparent rendering`);
  assert(near(mesh?.material?.opacity, 0.3), `${def.name} uses the wall-view opacity`);
  assert(mesh?.material?.alphaTest > 0 && mesh.material.alphaTest < mesh.material.opacity,
    `${def.name} scales alphaTest below opacity so opaque fence pixels survive`);
}

console.log('\n=== cutaway and solid wall modes preserve the same cutout contract ===\n');

{
  const cutaway = buildWall('picketFence', 'cutaway', new Set(['2,3']));
  assert(near(cutaway.material.opacity, 0.3), 'cutaway picket fence is ghosted');
  assert(cutaway.material.alphaTest > 0 && cutaway.material.alphaTest < cutaway.material.opacity,
    'cutaway picket fence keeps visible pixels');

  const solid = buildWall('barbedWireFence', 'up');
  assert(near(solid.material.opacity, 1), 'walls-up barbed wire stays opaque');
  assert(near(solid.material.alphaTest, 0.5), 'walls-up barbed wire keeps the authored cutout threshold');

  const stone = buildWall('stoneWall');
  assert(!stone.material.alphaTest, 'solid stone wall does not gain a cutout threshold');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
