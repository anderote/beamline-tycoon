// test/test-research-integrity.js
//
// Guards the research tree against the dead-content class: nodes that
// advertise components which don't exist, effect keys nothing reads, or no
// payload at all. 27 of 68 nodes were dead this way before validateResearch()
// existed, so this suite is the thing that keeps them from coming back.

import { RESEARCH, RESEARCH_EFFECT_KEYS, RESEARCH_PHYSICS_EFFECT_KEYS } from '../src/data/research.js';
import { COMPONENTS } from '../src/data/components.js';
import { validateResearch } from '../src/data/validate.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('--- shipped research tree is clean ---');
{
  const problems = validateResearch({
    research: RESEARCH, components: COMPONENTS, effectKeys: RESEARCH_EFFECT_KEYS,
  });
  for (const p of problems) console.log(`    ${p.id}.${p.field}: ${p.message}`);
  assert(problems.length === 0, `no research integrity problems (got ${problems.length})`);
}

console.log('\n--- the validator actually catches each defect class ---');
{
  const components = { realThing: { name: 'Real Thing' } };
  const problems = validateResearch({
    research: {
      dangling: { id: 'dangling', unlocks: ['nopeNotAComponent'] },
      unreadEffect: { id: 'unreadEffect', unlocks: ['realThing'], effect: { qualityBoost: 0.02 } },
      empty: { id: 'empty' },
      hiddenEmpty: { id: 'hiddenEmpty', hidden: true },
      fine: { id: 'fine', effect: { beamStability: 0.1 } },
    },
    components,
    effectKeys: ['beamStability'],
  });
  const by = (id, field) => problems.some(p => p.id === id && p.field === field);
  assert(by('dangling', 'unlocks'), 'dangling unlocks id is reported');
  assert(by('dangling', 'payload'), 'a node left with no real unlock is reported as payload-less');
  assert(by('unreadEffect', 'effect'), 'unconsumed effect key is reported');
  assert(by('empty', 'payload'), 'a node with neither unlocks nor effect is reported');
  assert(!by('hiddenEmpty', 'payload'), 'hidden nodes are exempt from the payload rule');
  assert(!problems.some(p => p.id === 'fine'), 'a node with a consumed effect is clean');
}

console.log('\n--- effect-key constant is the single source of truth ---');
{
  assert(!RESEARCH_PHYSICS_EFFECT_KEYS.includes('passiveFunding'),
    'passiveFunding is an economy knob, not part of the physics contract');
  assert(RESEARCH_PHYSICS_EFFECT_KEYS.every(k => RESEARCH_EFFECT_KEYS.includes(k)),
    'the physics subset is a subset');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
