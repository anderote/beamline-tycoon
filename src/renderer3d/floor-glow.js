// Distributed utility-run lighting. The pipe material and selective bloom
// make the source itself luminous; this module supplies the missing physical
// response on nearby floors, walls, equipment and staff.
//
// A single PointLight at a line midpoint reads as a lamp-shaped hotspot. We
// instead sample invisible emitter proxies along every horizontal leg. The
// fixed LightRig point pool claims the nearest proxies, so the part of a run
// around the camera gets a continuous field of real light without changing
// the scene's shader-light topology or allocating one light per cable.
//
// THREE is a CDN global — do not import it.

import { FLOW_PARAMS } from './utility-flow.js';
import { UTILITY_TYPES } from '../utility/registry.js';

// With a 3.1 m throw, 2.25 m spacing makes neighbouring lights overlap before
// either falloff reaches zero. At the game's working pixel scale this reads as
// one lit run, not a necklace of pools.
export const UTILITY_LIGHT_SPACING = 2.25;
const EMITTER_FLOOR_Y = 0.16;
const HEALTHY_INTENSITY = 0.58;
const HEALTHY_DISTANCE = 3.1;
const SOFT_INTENSITY = 0.30;
const SOFT_DISTANCE = 2.35;
const DAYLIGHT_FLOOR = 0.42;

function addSegmentEmitters(group, a, b, walked, utilityType, flowState, color, flow) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const horizontalLength = Math.hypot(dx, dz);
  const segmentLength = a.distanceTo(b);
  // Vertical risers have no floor footprint. Their adjacent horizontal tails
  // are still sampled at their real height, so a live connector can tint the
  // machine shell it plugs into rather than painting only the deck.
  if (horizontalLength < 1e-4) return segmentLength;

  const count = Math.max(1, Math.ceil(horizontalLength / UTILITY_LIGHT_SPACING));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    // Group is just an Object3D with a children array; using it here keeps the
    // proxy compatible with the renderer's deliberately small headless THREE
    // stubs without adding any pixels or GPU resources.
    const emitter = new THREE.Group();
    emitter.position.set(
      a.x + dx * t,
      Math.max(EMITTER_FLOOR_Y, a.y + (b.y - a.y) * t),
      a.z + dz * t,
    );
    emitter.userData = {
      isUtilityLightEmitter: true,
      utilityLightEmitter: {
        color,
        intensity: flowState === 'soft' ? SOFT_INTENSITY : HEALTHY_INTENSITY,
        distance: flowState === 'soft' ? SOFT_DISTANCE : HEALTHY_DISTANCE,
        // Live utilities remain actual emitters in daylight; night only gives
        // them more visual authority as the ambient grade falls away.
        daylightFloor: DAYLIGHT_FLOOR,
        flowState,
        flow: {
          distance: walked + segmentLength * t,
          speed: flow.speed,
          period: flow.period,
          width: flow.width,
          pulseDepth: utilityType === 'rfWaveguide' ? 0.48 : 0.28,
        },
      },
    };
    group.add(emitter);
  }
  return segmentLength;
}

/**
 * Build the invisible real-light field for one live utility run. The historic
 * function/tag names are retained because ThreeRenderer's glow toggle already
 * uses them; there is deliberately no floor-strip geometry anymore.
 */
export function buildFloorGlowStrip(points, utilityType, flowState) {
  if (!points || points.length < 2 || !FLOW_PARAMS[utilityType]
      || flowState === 'hard') return null;

  const flow = FLOW_PARAMS[utilityType];
  const color = flow.color || UTILITY_TYPES[utilityType]?.color || '#ffffff';
  const group = new THREE.Group();
  group.userData = {
    isFloorGlowStrip: true,
    isUtilityLightField: true,
    utilityType,
    flowState,
  };

  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    walked += addSegmentEmitters(
      group, points[i], points[i + 1], walked,
      utilityType, flowState, color, flow,
    );
  }

  // A route consisting solely of vertical risers needs no local light field.
  return group.children.length ? group : null;
}

export default buildFloorGlowStrip;
