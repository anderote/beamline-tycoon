// Scene-structure measurements for the ten-large-beamline benchmark. This is
// intentionally a renderer construction benchmark, not a fake FPS claim: GPU
// frame timing belongs to the explicitly-enabled browser lane.

import * as THREE_REAL from 'three';

let modulesPromise = null;

class HeadlessTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

function installHeadlessDom() {
  globalThis.THREE ??= { ...THREE_REAL, TextureLoader: HeadlessTextureLoader };
  globalThis.document ??= {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const gradient = () => ({ addColorStop() {} });
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createLinearGradient: gradient,
            createRadialGradient: gradient,
            fillRect() {},
            clearRect() {},
            drawImage() {},
            fillText() {},
            measureText() { return { width: 0 }; },
            fillStyle: null,
            font: '',
            textAlign: 'left',
            textBaseline: 'alphabetic',
          };
        },
      };
    },
  };
}

async function rendererModules({ quiet = false } = {}) {
  if (modulesPromise) return modulesPromise;
  installHeadlessDom();
  modulesPromise = (async () => {
    const priorInfo = console.info;
    if (quiet) console.info = () => {};
    try {
      const [
        { ComponentBuilder }, { BeamBuilder }, { PipeAttachmentBuilder }, { BeamPipeBuilder },
      ] = await Promise.all([
        import('../../src/renderer3d/component-builder.js'),
        import('../../src/renderer3d/beam-builder.js'),
        import('../../src/renderer3d/pipe-attachment-builder.js'),
        import('../../src/renderer3d/beam-pipe-builder.js'),
      ]);
      return { ComponentBuilder, BeamBuilder, PipeAttachmentBuilder, BeamPipeBuilder };
    } finally {
      console.info = priorInfo;
    }
  })();
  return modulesPromise;
}

function geometryTriangles(geometry) {
  if (!geometry?.attributes?.position) return 0;
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

function materialDrawCount(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mesh.geometry?.groups?.length && materials.length > 1) return mesh.geometry.groups.length;
  return Math.max(1, materials.length);
}

/** Measure the visible scene structure without claiming to measure GPU time. */
export function collectSceneMetrics(root) {
  const geometries = new Set();
  const materials = new Set();
  const metrics = {
    objects: 0,
    lights: 0,
    meshes: 0,
    visibleMeshes: 0,
    drawCalls: 0,
    renderedTriangles: 0,
    shadowDrawCalls: 0,
    shadowTriangles: 0,
    detailMeshes: 0,
    glowMeshes: 0,
    uniqueGeometries: 0,
    uniqueMaterials: 0,
  };

  root.traverse(object => {
    metrics.objects++;
    if (object.isLight && object.visible !== false) metrics.lights++;
    if (!object.isMesh) return;
    metrics.meshes++;
    if (object.visible === false) return;
    if (object.material?.visible === false) return; // renderer hitbox

    const instances = object.isInstancedMesh ? Math.max(0, object.count | 0) : 1;
    const draws = materialDrawCount(object);
    const triangles = object.isBatchedMesh && Number.isFinite(object.userData?.renderedTriangles)
      ? object.userData.renderedTriangles
      : geometryTriangles(object.geometry) * instances;
    metrics.visibleMeshes++;
    metrics.drawCalls += draws;
    metrics.renderedTriangles += triangles;
    if (object.castShadow) {
      metrics.shadowDrawCalls += draws;
      metrics.shadowTriangles += triangles;
    }
    if (object.userData?.lod === 'detail') metrics.detailMeshes++;
    if (object.userData?.role === 'glow') metrics.glowMeshes++;
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (material) materials.add(material);
    }
  });

  metrics.uniqueGeometries = geometries.size;
  metrics.uniqueMaterials = materials.size;
  return metrics;
}

function collectBreakdown(componentGroup, attachmentGroup, beamPipeGroup, beamGroup) {
  return {
    components: collectSceneMetrics(componentGroup),
    pipeAttachments: collectSceneMetrics(attachmentGroup),
    beamPipes: collectSceneMetrics(beamPipeGroup),
    beamEffects: collectSceneMetrics(beamGroup),
  };
}

/** Build the public component and beam-effect renderer paths headlessly. */
export async function buildHeadlessBeamlineScene(snapshot, { quiet = false } = {}) {
  const {
    ComponentBuilder, BeamBuilder, PipeAttachmentBuilder, BeamPipeBuilder,
  } = await rendererModules({ quiet });
  const root = new globalThis.THREE.Group();
  const componentGroup = new globalThis.THREE.Group();
  const attachmentGroup = new globalThis.THREE.Group();
  const beamPipeGroup = new globalThis.THREE.Group();
  const beamGroup = new globalThis.THREE.Group();
  root.add(componentGroup, attachmentGroup, beamPipeGroup, beamGroup);

  const componentBuilder = new ComponentBuilder();
  const attachmentBuilder = new PipeAttachmentBuilder();
  const beamPipeBuilder = new BeamPipeBuilder();
  const beamBuilder = new BeamBuilder();
  const started = performance.now();
  componentBuilder.build(snapshot.components || [], componentGroup);
  attachmentBuilder.build(snapshot.pipeAttachments || [], attachmentGroup);
  beamPipeBuilder.build({
    beamPipes: snapshot.beamPipes || [],
    moduleSubTiles: snapshot.moduleSubTiles || [],
  }, beamPipeGroup);
  beamBuilder.build(snapshot.beamPaths || [], beamGroup);
  const buildMs = performance.now() - started;

  const near = collectSceneMetrics(root);
  const nearBreakdown = collectBreakdown(
    componentGroup, attachmentGroup, beamPipeGroup, beamGroup,
  );

  // The live renderer keeps high-detail geometry at every zoom. Keep the
  // headless measurement aligned with that presentation instead of inventing
  // a separate low-detail scene for the benchmark.
  const far = collectSceneMetrics(root);
  const farBreakdown = collectBreakdown(
    componentGroup, attachmentGroup, beamPipeGroup, beamGroup,
  );

  return {
    root,
    buildMs,
    near,
    far,
    breakdown: { near: nearBreakdown, far: farBreakdown },
    pipeStats: beamPipeBuilder.getStats(),
  };
}
