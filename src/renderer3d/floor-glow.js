// Utility-run floor glow.  A real point light at a run's midpoint reads as a
// single lamp, not power/flow travelling through a cable.  These shallow,
// bloom-only ribbons follow the complete horizontal route instead.  They do
// not try to light other objects (the cable's animated emissive material does
// the primary visual work); their job is the continuous, low pool of colour
// visible on the deck beneath a live utility run.
//
// THREE is a CDN global — do not import it.

import { FLOW_PARAMS } from './utility-flow.js';
import { BLOOM_LAYER } from './glow-pipeline.js';
import { UTILITY_TYPES } from '../utility/registry.js';

const RIBBON_WIDTH = 0.34;
const RIBBON_Y = 0.014; // Clear of the deck: avoids z-fighting at shallow ISO angles.
const RIBBON_OPACITY = 0.34;

const _materialCache = new Map();

function materialFor(utilityType, flowState) {
  const key = `${utilityType}|${flowState}`;
  if (_materialCache.has(key)) return _materialCache.get(key);

  const flow = FLOW_PARAMS[utilityType];
  const color = new THREE.Color(flow?.color || UTILITY_TYPES[utilityType]?.color || '#ffffff');
  // Bloom's threshold is intentionally high for the rest of the scene. Give
  // this tiny deck-only surface enough headroom to bloom without widening it
  // or adding a bright, opaque painted line in the normal render.
  color.multiplyScalar(flowState === 'soft' ? 1.15 : 1.65);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: flowState === 'soft' ? RIBBON_OPACITY * 0.55 : RIBBON_OPACITY,
    depthWrite: false,
    toneMapped: false,
  });
  material.userData.__shared = true;
  _materialCache.set(key, material);
  return material;
}

/**
 * Builds a continuous bloom ribbon below a live run. Vertical risers are
 * deliberately skipped: illumination belongs on the deck, not on equipment
 * shells. A hard-faulted run remains fully dark, matching its pipe material.
 */
export function buildFloorGlowStrip(points, utilityType, flowState) {
  if (!points || points.length < 2 || !FLOW_PARAMS[utilityType]
      || utilityType === 'rfWaveguide' || flowState === 'hard') return null;

  const group = new THREE.Group();
  group.userData = {
    isFloorGlowStrip: true,
    utilityType,
    flowState,
  };
  const material = materialFor(utilityType, flowState);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    // A riser has no floor projection. Also omit zero-length route points.
    if (length < 1e-4) continue;

    const ribbon = new THREE.Mesh(
      new THREE.BoxGeometry(RIBBON_WIDTH, 0.004, length),
      material,
    );
    ribbon.position.set((a.x + b.x) / 2, RIBBON_Y, (a.z + b.z) / 2);
    ribbon.rotation.y = Math.atan2(dx, dz);
    ribbon.layers.enable(BLOOM_LAYER);
    ribbon.userData.isFloorGlowRibbon = true;
    group.add(ribbon);
  }

  // A route consisting solely of vertical risers needs no floor treatment.
  return group.children.length ? group : null;
}

export default buildFloorGlowStrip;
