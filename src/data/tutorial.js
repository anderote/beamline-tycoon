// src/data/tutorial.js — Tutorial checklist step definitions
// 3-minute path: reduced thresholds (5 m pipe, 3 cavities, 1 quad, Control Room zone-only)
// and capacity-based power branching let new players complete beamline → infra → commission in ~3 min.

import { COMPONENTS } from './components.js';

// Phase 6 helper: true if the solve-runner has produced a flow state for any
// network of the given utility type, with non-zero perSinkQuality entries.
// A perSinkQuality key exists iff the network contained at least one sink,
// and the solver only emits a flow (into utilityNetworkData) when discovery
// found the utility type's topology. Combined, "has sinks + has flow" is a
// cheap proxy for ">=1 source and >=1 sink wired together". For utilities
// with a totalCapacity field (power, cooling, rf, cryo), also require it
// to be positive so we don't light up the tutorial for sinkless sources.
function hasFunctionalNetwork(state, utilityType) {
  const perType = state?.utilityNetworkData?.get?.(utilityType);
  if (!perType || perType.size === 0) return false;
  for (const flow of perType.values()) {
    if (!flow) continue;
    const hasSinks = flow.perSinkQuality
      && Object.keys(flow.perSinkQuality).length > 0;
    if (!hasSinks) continue;
    // For capacity-bearing utilities, also require a real source.
    if (flow.totalCapacity !== undefined && flow.totalCapacity <= 0) continue;
    return true;
  }
  return false;
}

export const TUTORIAL_GROUPS = [
  { id: 'beamline', name: 'Beamline' },
  { id: 'infrastructure', name: 'Infrastructure' },
  { id: 'commission', name: 'Commission' },
];

export const TUTORIAL_STEPS = [
  // === Beamline ===
  {
    id: 'tut-source',
    name: 'Place an Ion Source',
    hint: 'Select Beamline \u2192 Sources and place a Source in the tunnel.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && COMPONENTS[p.type]?.isSource),
  },
  {
    id: 'tut-drift',
    name: 'Extend the Beam Pipe',
    hint: 'Connect beam pipe between components \u2014 the pipe path should total at least 5 m (3-min path).',
    group: 'beamline',
    condition: (state) => {
      const totalSubL = (state.beamPipes || []).reduce((sum, bp) => sum + (bp.subL || 0), 0);
      return totalSubL >= 20; // 20 subtiles = 5 m — 3-min path (was 10 m)
    },
  },
  {
    id: 'tut-buncher',
    name: 'Add a Buncher',
    hint: 'Place a Buncher after the source to compress the beam into bunches.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && p.type === 'buncher'),
  },
  {
    id: 'tut-cavities',
    name: 'Install RF Cavities',
    hint: 'Place 3 Pillbox Cavities to accelerate the beam (3-min path). Add more later for higher energy.',
    group: 'beamline',
    condition: (state) => {
      const count = state.placeables.filter(
        p => p.category === 'beamline' && p.type === 'pillboxCavity'
      ).length;
      return count >= 3;
    },
  },
  {
    id: 'tut-quads',
    name: 'Focus with Quadrupoles',
    hint: 'Place a Quadrupole magnet to keep the beam focused (3-min path).',
    group: 'beamline',
    condition: (state) =>
      state.placeables.filter(
        p => p.category === 'beamline' && p.type === 'quadrupole'
      ).length >= 1,
  },
  {
    id: 'tut-faraday',
    name: 'Place a Faraday Cup',
    hint: 'End your beamline with a Faraday Cup to measure the beam current.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && p.type === 'faradayCup'),
  },

  // === Infrastructure ===
  // Phase 6: tutorial conditions were rewritten to use the new
  // state.utilityNetworkData (Map<utilityType, Map<networkId, flow>>) instead
  // of the legacy nets/networkData shape. `hasFunctionalNetwork` returns true
  // as soon as one network of the given utility type has >=1 source and >=1
  // sink — the minimal bar for "you've wired something real".
  {
    id: 'tut-power',
    name: 'Connect Power',
    hint: 'Place a HV Transformer (now fans out via capacity) and run Power Cable to any beamline component (3-min path).',
    group: 'infrastructure',
    condition: (state) => hasFunctionalNetwork(state, 'powerCable'),
  },
  {
    id: 'tut-vacuum',
    name: 'Connect Vacuum',
    hint: 'Place a Roughing Pump and run Vacuum Pipe to the beamline (3-min path).',
    group: 'infrastructure',
    condition: (state) => hasFunctionalNetwork(state, 'vacuumPipe'),
  },
  {
    id: 'tut-rf',
    name: 'Connect RF Power',
    hint: 'Place a Magnetron and run RF Waveguide to a cavity (3-min path).',
    group: 'infrastructure',
    condition: (state) => hasFunctionalNetwork(state, 'rfWaveguide'),
  },
  {
    id: 'tut-cooling',
    name: 'Connect Cooling Water',
    hint: 'Place a Chiller and run Cooling Water to a Quadrupole (optional for 3-min path).',
    group: 'infrastructure',
    condition: (state) => hasFunctionalNetwork(state, 'coolingWater'),
  },
  {
    id: 'tut-data',
    name: 'Connect Data Fiber',
    hint: 'Run Data Fiber from the Faraday Cup to a Rack/IOC (3-min path).',
    group: 'infrastructure',
    condition: (state) => hasFunctionalNetwork(state, 'dataFiber'),
  },

  // === Commission ===
  {
    id: 'tut-beam',
    name: 'First Measurement',
    hint: 'Your beam should now be running. The Faraday Cup will collect data automatically.',
    group: 'commission',
    condition: (state) => (state.totalDataCollected || 0) > 0 || state.resources.data > 0,
  },
  {
    id: 'tut-control',
    name: 'Build a Control Room',
    hint: 'Drag Facility \u2192 Control Room to auto-place Office Floor + Control Room zone (3-min path: zone alone completes this step).',
    group: 'commission',
    condition: (state) => (state.zones || []).some(z => z.type === 'controlRoom'),
  },
];
