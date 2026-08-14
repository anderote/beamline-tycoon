// Utility-run illumination proxy. The old implementation drew wide additive
// boxes on the deck; those were visible as flashing translucent geometry.
// This object has no pixels of its own. LightRig assigns a bounded pool of
// real PointLights to the nearest proxies, so nearby surfaces receive light.
// THREE is a CDN global — do not import it.

import { FLOW_PARAMS } from './utility-flow.js';
import { UTILITY_TYPES } from '../utility/registry.js';

function midpoint(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += points[i].distanceTo(points[i + 1]);
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = points[i].distanceTo(points[i + 1]);
    if (walked + length >= total / 2) {
      const t = length ? (total / 2 - walked) / length : 0;
      const a = points[i], b = points[i + 1];
      return new THREE.Vector3(
        a.x + (b.x - a.x) * t, 0.16, a.z + (b.z - a.z) * t,
      );
    }
    walked += length;
  }
  const p = points[points.length - 1];
  return new THREE.Vector3(p.x, 0.16, p.z);
}

export function buildFloorGlowStrip(points, utilityType, flowState) {
  // RF's travelling emissive wave blooms directly around the waveguide. A
  // separate PointLight reads as a lamp/hotspot and fights that continuous
  // effect, so RF deliberately stays out of the real-light proxy system.
  if (!points || points.length < 2 || !FLOW_PARAMS[utilityType]
      || utilityType === 'rfWaveguide' || flowState === 'hard') return null;
  const flow = FLOW_PARAMS[utilityType];
  const group = new THREE.Group();
  group.position.copy(midpoint(points));
  group.userData = {
    isFloorGlowStrip: true, // historical toggle tag; no strip is rendered now
    utilityType,
    flowState,
    utilityLightEmitter: {
      color: flow.color || UTILITY_TYPES[utilityType]?.color || '#ffffff',
      intensity: flowState === 'soft' ? 0.3 : 0.65,
      distance: flowState === 'soft' ? 1.8 : 2.6,
    },
  };
  return group;
}

export default buildFloorGlowStrip;
