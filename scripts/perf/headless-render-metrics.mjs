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
            beginPath() {},
            arc() {},
            fill() {},
            stroke() {},
            moveTo() {},
            lineTo() {},
            strokeRect() {},
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
        { EquipmentBuilder }, { DecorationBuilder }, { UtilityLineBuilderV2 },
        { FloorBuilder }, { WallBuilder }, { RoofBuilder },
      ] = await Promise.all([
        import('../../src/renderer3d/component-builder.js'),
        import('../../src/renderer3d/beam-builder.js'),
        import('../../src/renderer3d/pipe-attachment-builder.js'),
        import('../../src/renderer3d/beam-pipe-builder.js'),
        import('../../src/renderer3d/equipment-builder.js'),
        import('../../src/renderer3d/decoration-builder.js'),
        import('../../src/renderer3d/utility-line-builder-v2.js'),
        import('../../src/renderer3d/floor-builder.js'),
        import('../../src/renderer3d/wall-builder.js'),
        import('../../src/renderer3d/roof-builder.js'),
      ]);
      return {
        ComponentBuilder, BeamBuilder, PipeAttachmentBuilder, BeamPipeBuilder,
        EquipmentBuilder, DecorationBuilder, UtilityLineBuilderV2,
        FloorBuilder, WallBuilder, RoofBuilder,
      };
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

function isEffectivelyVisible(object, root) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
    if (current === root) break;
  }
  return true;
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
    if (object.isLight && isEffectivelyVisible(object, root)) metrics.lights++;
    if (!object.isMesh) return;
    metrics.meshes++;
    if (!isEffectivelyVisible(object, root)) return;
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

  // Measure the adaptive large-world far presentation. Ordinary facilities
  // may elect to keep detail at runtime, but this structural view proves the
  // builders' cheap path remains inside its fixed budgets.
  componentBuilder.setDetailLevel(false);
  attachmentBuilder.setDetailLevel(false);
  beamPipeBuilder.setDetailLevel(false);
  beamBuilder.setDetailLevel(false);
  const far = collectSceneMetrics(root);
  const farBreakdown = collectBreakdown(
    componentGroup, attachmentGroup, beamPipeGroup, beamGroup,
  );
  componentBuilder.setDetailLevel(true);
  attachmentBuilder.setDetailLevel(true);
  beamPipeBuilder.setDetailLevel(true);
  beamBuilder.setDetailLevel(true);

  return {
    root,
    buildMs,
    near,
    far,
    breakdown: { near: nearBreakdown, far: farBreakdown },
    pipeStats: beamPipeBuilder.getStats(),
  };
}

function collectFacilityBreakdown(groups) {
  return Object.fromEntries(Object.entries(groups)
    .filter(([name]) => name !== 'root')
    .map(([name, group]) => [name, collectSceneMetrics(group)]));
}

/**
 * Construct the complete modeled-object presentation used by an ordinary
 * facility view. Terrain is deliberately omitted (it is already one merged
 * draw); floors, walls, roofs, hardware, utilities, furnishings, and grounds
 * objects all use their production builders.
 */
export async function buildHeadlessFacilityScene(snapshot, {
  state = null,
  endpointIndex = new Map(),
  quiet = false,
} = {}) {
  const {
    ComponentBuilder, BeamBuilder, PipeAttachmentBuilder, BeamPipeBuilder,
    EquipmentBuilder, DecorationBuilder, UtilityLineBuilderV2,
    FloorBuilder, WallBuilder, RoofBuilder,
  } = await rendererModules({ quiet });
  const root = new globalThis.THREE.Group();
  const groups = {};
  for (const name of [
    'components', 'equipment', 'decorations', 'floors', 'walls', 'roofs',
    'beamPipes', 'attachments', 'beamEffects', 'utilities',
  ]) {
    groups[name] = new globalThis.THREE.Group();
    groups[name].name = `headless-${name}`;
    root.add(groups[name]);
  }
  groups.beamline = new globalThis.THREE.Group();
  groups.infrastructure = new globalThis.THREE.Group();
  groups.components.add(groups.beamline, groups.infrastructure);
  groups.roofs.visible = false;

  const builders = {
    components: new ComponentBuilder(),
    equipment: new EquipmentBuilder(),
    decorations: new DecorationBuilder(),
    floors: new FloorBuilder(),
    walls: new WallBuilder(),
    roofs: new RoofBuilder(),
    beamPipes: new BeamPipeBuilder(),
    attachments: new PipeAttachmentBuilder(),
    beamEffects: new BeamBuilder(),
    utilities: new UtilityLineBuilderV2(),
  };
  const started = performance.now();
  builders.floors.build(snapshot.floors || [], groups.floors);
  builders.walls.build(
    snapshot.walls || [], snapshot.doors || [], snapshot.windows || [],
    groups.walls, 'up', null,
  );
  builders.roofs.build(snapshot.roofs || [], groups.roofs);
  builders.components.build(snapshot.components || [], groups.components, {
    categoryGroups: {
      beamline: groups.beamline,
      infrastructure: groups.infrastructure,
    },
  });
  builders.equipment.build(
    snapshot.equipment || [], snapshot.furnishings || [], groups.equipment,
  );
  builders.decorations.build(snapshot.decorations || [], groups.decorations);
  builders.beamPipes.build({
    beamPipes: snapshot.beamPipes || [],
    moduleSubTiles: snapshot.moduleSubTiles || [],
  }, groups.beamPipes);
  builders.attachments.build(snapshot.pipeAttachments || [], groups.attachments);
  builders.beamEffects.build(snapshot.beamPaths || [], groups.beamEffects);
  builders.utilities.build(
    snapshot.utilityLines || [], endpointIndex, groups.utilities, { state },
  );
  const buildMs = performance.now() - started;

  const near = collectSceneMetrics(root);
  const nearBreakdown = collectFacilityBreakdown(groups);
  for (const name of [
    'components', 'equipment', 'decorations', 'beamPipes', 'attachments',
    'beamEffects', 'utilities',
  ]) builders[name].setDetailLevel(false);
  const far = collectSceneMetrics(root);
  const farBreakdown = collectFacilityBreakdown(groups);
  groups.roofs.visible = true;
  const farRoofOverview = collectSceneMetrics(root);
  groups.roofs.visible = false;

  return {
    root,
    groups,
    builders,
    buildMs,
    near,
    far,
    farRoofOverview,
    breakdown: { near: nearBreakdown, far: farBreakdown },
  };
}
