// test/test-sandbox-mode.js — sandbox suppresses charges, not the economy.
//
// The distinction from devMode matters: devMode pins funding at 1e12, which
// hides what a facility actually earns. Sandbox leaves the balance real so the
// player can still read income while building without the capital grind.
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const mk = () => new Game(new BeamlineRegistry(), { seed: 7 });

console.log('\n--- spend / canAfford ---');
{
  const g = mk();
  const before = g.state.resources.funding;
  g.spend({ funding: 1000 });
  assert(g.state.resources.funding === before - 1000, 'normally, spend debits');

  g.setSandboxMode(true);
  const now = g.state.resources.funding;
  g.spend({ funding: 1000 });
  assert(g.state.resources.funding === now, 'in sandbox, spend does not debit');

  g.state.resources.funding = 5;
  assert(g.canAfford({ funding: 1e9 }) === true, 'in sandbox, anything is affordable');
  g.setSandboxMode(false);
  assert(g.canAfford({ funding: 1e9 }) === false, 'affordability returns when off');
}

console.log('\n--- chargeConstruction is the single build-time chokepoint ---');
{
  const g = mk();
  const before = g.state.resources.funding;
  g.chargeConstruction(2500);
  assert(g.state.resources.funding === before - 2500, 'normally charges');
  g.setSandboxMode(true);
  const now = g.state.resources.funding;
  g.chargeConstruction(2500);
  assert(g.state.resources.funding === now, 'sandbox suppresses it');
}

console.log('\n--- placement is free but the balance stays real ---');
{
  const g = mk();
  g.setSandboxMode(true);
  g.state.resources.funding = 1000;   // far below any component price
  const id = g.placePlaceable({ type: 'turboPump', col: 12, row: 12, silent: true });
  assert(!!id, 'can place a component costing far more than the balance');
  assert(g.state.resources.funding === 1000, 'balance untouched by the purchase');
  assert(g.state.resources.funding !== 1e12,
    'balance is REAL, not pinned like devMode — income stays readable');
}

console.log('\n--- income still accrues ---');
{
  const g = mk();
  g.setSandboxMode(true);
  g.state.resources.funding = 0;
  for (let i = 0; i < 30; i++) g.tick();
  assert(g.state.resources.funding > 0,
    `grants/income still credit in sandbox (got ${g.state.resources.funding})`);
}

console.log('\n--- persistence ---');
{
  const g = mk();
  g.setSandboxMode(true);
  assert(store.get('beamlineTycoon.sandboxMode') === '1', 'persisted to localStorage');
  const g2 = mk();
  assert(g2.sandboxMode === true, 'a new game restores the setting');
  g2.setSandboxMode(false);
  assert(mk().sandboxMode === false, 'and clears it');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
