import assert from 'node:assert/strict';
import { rankStackupSuggestions, stackupCandidateTypes } from '../src/beamline/stackup-planner.js';

const nodes = [
  { type: 'source', subL: 4, params: {} },
  { type: 'drift', subL: 4, params: {} },
  { type: 'faradayCup', subL: 4, params: {} },
];

const result = (overrides = {}) => ({
  beamAlive: true,
  beamEnergy: 0.001,
  beamCurrent: 1,
  beamQuality: 0.4,
  envelope: [{
    energy: 0.001, current: 1, focus_margin: 0.1,
    emit_nx: 1, emit_ny: 1, sigma_x: 0.01, sigma_y: 0.01,
  }],
  ...overrides,
});

assert(stackupCandidateTypes({
  typeId: 'testStand',
  isUnlocked: () => true,
}).includes('quadrupole'));
assert(!stackupCandidateTypes({
  typeId: 'testStand',
  isUnlocked: () => true,
}).includes('source'));

const calls = [];
const plan = await rankStackupSuggestions({
  nodes,
  baselineResult: result(),
  typeId: 'testStand',
  maxResults: 3,
  maxCandidates: 20,
  isUnlocked: def => def.id === 'quadrupole' || def.id === 'bpm',
  evaluate: candidate => {
    calls.push(candidate);
    const type = candidate.find(node => node.type === 'quadrupole')?.type;
    return type === 'quadrupole'
      ? result({ beamQuality: 0.9, beamCurrent: 1, beamEnergy: 0.001 })
      : result({ beamQuality: 0.45 });
  },
});

assert.equal(plan.evaluated, calls.length);
assert(plan.suggestions.length > 0);
assert.equal(plan.suggestions[0].type, 'quadrupole');
assert.equal(plan.suggestions[0].confidence, 'medium');
assert(plan.suggestions[0].reason.includes('improves beam quality'));
assert(['before', 'after'].includes(plan.suggestions[0].position));
assert(plan.suggestions[0].utilityRequirements.includes('powerCable'));

console.log('stackup planner: ok');
