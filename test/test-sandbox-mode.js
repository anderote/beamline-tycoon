// test/test-sandbox-mode.js — sandbox suppresses capital charges, not the economy.
//
// The distinction from devMode matters: devMode pins funding at 1e12, which
// hides what a facility actually earns. Sandbox leaves the balance real so the
// player can still read income while building without the capital grind.
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { launchScenario } from '../src/game/scenario-launch.js';

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

console.log('\n--- structure affordability is also bypassed ---');
{
  const g = mk();
  g.setSandboxMode(true);
  g.state.resources.funding = -50000;
  const before = g.state.resources.funding;
  assert(g.placeInfraTile(0, 0, 'concrete') === true,
    'a floor can be built with a negative sandbox balance');
  assert(g.placeWall(0, 0, 'n', 'structuralWall') === true,
    'a wall can be built with a negative sandbox balance');
  assert(g.state.resources.funding === before,
    'capital construction leaves the real operating balance untouched');
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
  g.tick();
  const { snapshot } = g.getEconomySnapshot();
  assert(snapshot.income.total > 0,
    `grants/income are still credited in sandbox (got ${snapshot.income.total})`);
}

console.log('\n--- recurring operating costs remain real ---');
{
  const g = mk();
  g.setSandboxMode(true);
  // Remove the seeded operator so the expected tick delta is just grant minus
  // this placed pump's service and electricity bill.
  g.state.staff = Object.fromEntries(Object.keys(g.state.staff).map(id => [id, 0]));
  g.state.resources.funding = 0;
  const id = g.placePlaceable({ type: 'turboPump', col: 12, row: 12, silent: true });
  assert(!!id, 'operating-cost fixture places in sandbox');
  g.tick();
  const { snapshot } = g.getEconomySnapshot();
  assert(snapshot.upkeep.total > 0, 'the published sandbox snapshot includes real upkeep');
  assert(g.state.resources.funding === snapshot.income.total - snapshot.upkeep.total,
    'the sandbox cash balance is moved by both recurring income and upkeep');

  const beforeRefill = g.state.resources.funding;
  g.chargeReservoirRefill({ funding: 250 });
  assert(g.state.resources.funding === beforeRefill - 250,
    'reservoir consumables remain a real sandbox operating cost');
}

console.log('\n--- failed and demolished free builds cannot mint money ---');
{
  const g = mk();
  g.setSandboxMode(true);
  g.state.resources.funding = 1234;
  const id = g.placePlaceable({ type: 'turboPump', col: 12, row: 12, silent: true });
  assert(!!id && g.removePlaceable(id), 'a sandbox placeable can be demolished');
  assert(g.state.resources.funding === 1234,
    'demolishing free sandbox construction pays no refund');
  const before = g.state.resources.funding;
  g.commitGesture({ cost: { funding: 999 }, mutate: () => false });
  assert(g.state.resources.funding === before,
    'a rejected paid gesture does not refund a charge sandbox never took');
}

console.log('\n--- Sandbox scenario is an infrastructure-free beamline test bench ---');
{
  store.clear();
  const g = mk();
  const scenario = SCENARIOS.find(entry => entry.id === 'sandbox');
  assert(scenario?.name === 'Sandbox', 'the player-facing scenario name is exactly Sandbox');
  assert(launchScenario(g, scenario) === true, 'the Sandbox scenario launches');
  assert(g.sandboxMode === true, 'Sandbox enables free construction');
  assert(g.state.scenarioRules.freeConstruction === true,
    'free construction is also carried by the scenario save');
  assert(g.state.scenarioRules.idealInfrastructure === true,
    'Sandbox supplies ideal infrastructure');
  assert(g.isComponentUnlocked(COMPONENTS.srfGun) === true,
    'research-gated beamline components are unlocked');

  g.state.resources.funding = -1;
  g.state.resources.spares = 0;
  let sourceId = null;
  for (let col = -18; col <= 18 && !sourceId; col += 3) {
    for (let row = -18; row <= 18 && !sourceId; row += 3) {
      sourceId = g.placePlaceable({ type: 'srfGun', col, row, silent: true }) || null;
    }
  }
  assert(!!sourceId, 'an $8M SRF gun builds with no funding, spares, or research');
  assert(g.state.resources.funding === -1 && g.state.resources.spares === 0,
    'the Sandbox build charges no resources');

  g.refreshInfrastructureGate();
  assert(g.state.infraCanRun === true && g.state.infraBlockers.length === 0,
    'unwired power, RF, cryogenics, data, and missing operator infrastructure do not block');
  const beamline = g.registry.getAll().find(entry => entry.sourceId === sourceId);
  g.toggleBeam(beamline?.id);
  assert(beamline?.status === 'running', 'the completely unwired beamline starts');
  g.tick();
  assert(g.state.beamOn === true, 'the Sandbox beam remains live after a simulation tick');
  assert((beamline?.beamState?.beamCurrent || 0) > 0,
    'ideal services produce a non-zero physics result instead of a fail-closed beam');

  beamline.beamState.componentHealth[sourceId] = 100;
  for (let i = 0; i < 20; i++) g.tick();
  assert(beamline?.beamState?.componentHealth?.[sourceId] === 100,
    'Sandbox beamline testing does not require maintenance infrastructure');

  g.save();
  const restored = mk();
  assert(restored.load() === true, 'the Sandbox game reloads');
  assert(restored.state.scenarioRules.idealInfrastructure === true
      && restored.state.scenarioRules.unlockAllComponents === true
      && restored.state.scenarioRules.freeConstruction === true,
    'Sandbox creative rules persist with the save');
  restored.setSandboxMode(false);
  assert(restored.isConstructionFree() === true,
    'the restored Sandbox remains free even if the global option is off');
  launchScenario(restored, { id: 'career', name: 'Career', sandbox: false, generator: null });
  assert(restored.isConstructionFree() === false
      && restored.state.scenarioRules.idealInfrastructure === false
      && restored.state.scenarioRules.unlockAllComponents === false,
    'launching an ordinary scenario clears every Sandbox-only rule');

  const legacyPayload = JSON.parse(restored.serialize());
  delete legacyPayload.state.scenarioRules;
  restored.setScenarioRules(scenario.rules);
  store.set('beamlineTycoon', JSON.stringify(legacyPayload));
  assert(restored.load() === true && restored.isConstructionFree() === false,
    'an older save cannot inherit Sandbox rules from the world it replaces');
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
