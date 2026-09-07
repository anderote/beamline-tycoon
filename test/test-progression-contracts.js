import assert from 'node:assert/strict';
import { RESEARCH } from '../src/data/research.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { startResearch, tickResearch } from '../src/game/research.js';
import { checkObjectives } from '../src/game/objectives.js';

// Starting a second project must preserve the paid project's progress and cost.
const state = {
  completedResearch: [], activeResearch: null, researchProgress: 0,
  resources: { funding: 10000000, data: 1000, reputation: 1000 },
  zoneItems: [], beamOn: false,
};
assert(startResearch('rfFundamentals', state, () => {}));
tickResearch(state, () => {}, () => 4, () => {});
const paidState = structuredClone(state);
assert.equal(startResearch('basicVacuum', state, () => {}), false);
assert.deepEqual(state, paidState);
assert.equal(startResearch('rfFundamentals', state, () => {}), false);
assert.deepEqual(state, paidState);
while (state.activeResearch) tickResearch(state, () => {}, () => 4, () => {});
assert(startResearch('basicVacuum', state, () => {}));

// A legacy hidden node or duplicate cannot substitute for a visible project.
const visible = Object.values(RESEARCH).filter(r => !r.hidden).map(r => r.id);
const objective = OBJECTIVES.find(o => o.id === 'allResearch');
const progress = {
  completedResearch: [...visible.slice(1), 'superconducting', visible[1]],
  completedObjectives: OBJECTIVES.filter(o => o.id !== 'allResearch').map(o => o.id),
  resources: { funding: 0, reputation: 0 },
};
assert.equal(objective.condition(progress), false);
assert.equal(checkObjectives(progress, () => {}).length, 0);
assert.equal(progress.resources.funding, 0);
progress.completedResearch.push(visible[0]);
assert.equal(checkObjectives(progress, () => {}).length, 1);
assert.equal(progress.resources.funding, objective.reward.funding);
assert.equal(checkObjectives(progress, () => {}).length, 0);
console.log('Progression contracts passed');
