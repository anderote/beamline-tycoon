// test/test-beamline-picker.js — the New Beamline picker, end to end.
//
// Three things have to hold for beamline types to be worth anything, and each
// one has already been broken once in this codebase's history:
//
//   1. THE PALETTE FILTER IS TWO-DIRECTIONAL. A component's `beamlineTypes`
//      allowlist and a type's `excludes` denylist both hide, they mean
//      different things, and omitting the allowlist must mean "trunk" rather
//      than "hidden everywhere". Getting that default backwards empties the
//      palette for every type at once.
//
//   2. THE CHOICE SURVIVES. Registry entries are minted lazily from a placed
//      source, so the picker's answer has to travel through
//      Game.pendingBeamlineTypeId → _ensureBeamlineForSourcePlaceable →
//      createBeamline → toJSON. A break anywhere in that chain leaves a
//      beamline that looks typed in the UI and is untyped in the save.
//
//   3. THE TYPE IS THE ONLY SOURCE OF MACHINE TYPE. This is the sharp one.
//      BeamlineDesigner used to fall back to a heuristic — 'fel' if the draft
//      contained an undulator or wiggler, 'linac' otherwise — whenever
//      `this.beamlineId` was unset, which `openFromSource` ALWAYS leaves
//      unset. A synchrotron light source with an insertion device in it
//      therefore ran FELGainModule and reported saturation a storage ring
//      cannot physically reach: exactly the failure the capability sets in
//      beam_physics/machines.py exist to prevent, reintroduced one layer up in
//      the UI. The heuristic is gone; these tests are what keep it gone.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';
import {
  beamlineTypeHidesComponent, formatEnergyBand, formatCurrentBand,
  missingResearchNames,
} from '../src/ui/BeamlineTypePicker.js';
import { BEAMLINE_TYPES, getBeamlineType } from '../src/data/beamline-types.js';
import { COMPONENTS } from '../src/data/components.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log(`  FAIL: ${msg} (expected ${expected}, got ${actual})`); }
}

// ---------------------------------------------------------------------------
// 1. Palette filter
// ---------------------------------------------------------------------------
console.log('\n=== Palette filter ===\n');

{
  // Trunk: no allowlist, not excluded. The default has to be "visible", or
  // picking any type empties the palette.
  const trunk = { category: 'optics' };
  assert(!beamlineTypeHidesComponent('therapy', 'quadrupole', trunk),
    'a component with no beamlineTypes is trunk — visible to every type');
  assert(!beamlineTypeHidesComponent(null, 'quadrupole', trunk),
    'no active type hides nothing at all');
  assert(!beamlineTypeHidesComponent('notAType', 'quadrupole', trunk),
    'an unknown type id hides nothing (fail open, never blank the palette)');

  // Allowlist direction: "this is special-purpose hardware".
  const protonOnly = { category: 'source', beamlineTypes: ['isotopeIrradiation', 'therapy'] };
  assert(beamlineTypeHidesComponent('testStand', 'ionSource', protonOnly),
    'an allowlist hides the component from types not on it');
  assert(!beamlineTypeHidesComponent('therapy', 'ionSource', protonOnly),
    'an allowlist shows the component to types on it');

  // Denylist direction: "this general hardware is wrong here". therapy excludes
  // velocitySelector and emittanceFilter — both trunk everywhere else.
  const therapy = getBeamlineType('therapy');
  assert(therapy.excludes.includes('velocitySelector'),
    'precondition: therapy excludes velocitySelector');
  assert(beamlineTypeHidesComponent('therapy', 'velocitySelector', { category: 'optics' }),
    "a type's excludes hides trunk hardware that is wrong for it");
  assert(!beamlineTypeHidesComponent('testStand', 'velocitySelector', { category: 'optics' }),
    'the same trunk component stays visible to a type that does not exclude it');

  // Scope: only beamline-mode categories are filtered. Infra/Structure/Grounds
  // hardware is trunk by construction and must never be touched, even if a
  // type's excludes happened to name something with a colliding id.
  assert(!beamlineTypeHidesComponent('therapy', 'velocitySelector', { category: 'vacuum' }),
    'a non-beamline category is never filtered, whatever the type says');
  assert(!beamlineTypeHidesComponent('testStand', 'turboPump',
    { category: 'vacuum', beamlineTypes: ['collider'] }),
    'an allowlist on infra hardware is ignored — infra is trunk by construction');
}

{
  // Against the real catalogue: every type must keep a buildable source, or
  // the filter has made that type impossible to start.
  console.log('');
  for (const type of Object.values(BEAMLINE_TYPES)) {
    const sources = Object.entries(COMPONENTS).filter(([key, comp]) =>
      comp.isSource && !beamlineTypeHidesComponent(type.id, key, comp));
    assert(sources.length > 0, `${type.id} keeps at least one source in its palette`);
  }
}

{
  // And the filter must actually filter: a proton front end has no business in
  // an electron test stand, and vice versa.
  console.log('');
  assert(beamlineTypeHidesComponent('testStand', 'ionSource', COMPONENTS.ionSource),
    'testStand cannot build a duoplasmatron ion source');
  assert(beamlineTypeHidesComponent('therapy', 'source', COMPONENTS.source),
    'therapy cannot build an electron gun');
}

// ---------------------------------------------------------------------------
// 2. The pick survives: picker → pending → registry entry → save
// ---------------------------------------------------------------------------
console.log('\n=== The chosen type reaches the registry and the save ===\n');

function gameWithSource(typeId) {
  const g = new Game(new BeamlineRegistry(), { seed: 11 });
  g.state.resources.funding = 1e9;
  if (typeId) g.startNewBeamline(typeId);
  // Stand in for a placed source. _ensureBeamlineForSourcePlaceable only reads
  // `type` and `id` off the instance, so this is the real call path, not a
  // reimplementation of it.
  const instance = { id: 'src-1', type: 'source', category: 'beamline' };
  const blId = g._ensureBeamlineForSourcePlaceable(instance);
  return { g, instance, entry: g.registry.get(blId) };
}

{
  const { g, entry } = gameWithSource('ebeamProcessing');
  assertEq(entry.typeId, 'ebeamProcessing', 'the placed source carries the picked typeId');
  assertEq(entry.beamState.machineType, 'ebeamProcessing',
    "beamState.machineType is the type's machineType, not 'linac'");
  assertEq(g.pendingBeamlineTypeId, null, 'the pick is consumed exactly once');
  assertEq(g.editingBeamlineId, entry.id,
    'the player is dropped into editing the beamline they just started');
  assertEq(g.getActiveBeamlineTypeId(), 'ebeamProcessing',
    'the palette now filters to the new beamline');
}

{
  // A second source after the pick is spent must NOT inherit the type.
  const { g } = gameWithSource('therapy');
  const second = { id: 'src-2', type: 'source', category: 'beamline' };
  const id2 = g._ensureBeamlineForSourcePlaceable(second);
  assertEq(g.registry.get(id2).typeId, null,
    'a source placed with no pending pick makes an untyped beamline');
  assertEq(g.registry.get(id2).beamState.machineType, 'linac',
    "an untyped beamline falls back to the plain 'linac' transport stack");
}

{
  // No pick at all — the pre-picker path every existing save takes.
  const { entry } = gameWithSource(null);
  assertEq(entry.typeId, null, 'no pick means no type');
  assertEq(entry.beamState.machineType, 'linac', 'no pick means the linac fallback');
}

{
  // Guided setup starts from the opposite direction: an ordinary source is
  // already on the map, then the player says what that machine is for.
  const { g, instance, entry } = gameWithSource(null);
  g.state.placeables.push(instance);
  g.state.placeableIndex[instance.id] = g.state.placeables.length - 1;
  assert(g.assignBeamlineType(entry.id, 'testStand'),
    'an untyped placed source can be designated after placement');
  assertEq(entry.typeId, 'testStand', 'post-placement designation reaches the registry');
  assertEq(entry.beamState.machineType, BEAMLINE_TYPES.testStand.machineType,
    'post-placement designation updates the physics machine type');
  assert(!g.assignBeamlineType(entry.id, 'therapy'),
    'an electron source refuses an incompatible proton mission');
}

{
  // Round-trip. typeId has to survive toJSON/fromJSON or a reloaded save has a
  // beamline whose palette and physics silently revert to untyped.
  const reg = new BeamlineRegistry();
  reg.createBeamline('xfel', 'src-1', 'xfel');
  reg.createBeamline('linac', 'src-2');
  const json = JSON.parse(JSON.stringify(reg.toJSON()));
  assertEq(json.entries[0].typeId, 'xfel', 'toJSON serialises typeId');
  assertEq(json.entries[1].typeId, null, 'toJSON writes null for an untyped entry');

  const restored = new BeamlineRegistry();
  restored.fromJSON(json);
  assertEq(restored.get('bl-1').typeId, 'xfel', 'fromJSON restores typeId');
  assertEq(restored.get('bl-2').typeId, null, 'fromJSON tolerates an untyped entry');

  // Entries written before typeId existed have no such field at all.
  const legacy = new BeamlineRegistry();
  legacy.fromJSON({
    nextBeamlineId: 2,
    entries: [{
      id: 'bl-1', name: 'Beamline-1', accentColor: 0x46c25a, status: 'stopped',
      sourceId: 'src-1', beamState: { machineType: 'linac' },
    }],
  });
  assertEq(legacy.get('bl-1').typeId, null, 'a pre-typeId save loads as untyped');
}

{
  // Every type's machineType must be a config the physics side knows. The
  // exhaustive check against machines.py lives in test-beamline-types.js; this
  // one guards the specific hop the picker adds — createBeamline must write
  // the TYPE's machineType and not the type id, which happen to be equal for
  // every current entry and would hide a copy-paste error forever if unchecked.
  console.log('');
  for (const type of Object.values(BEAMLINE_TYPES)) {
    const reg = new BeamlineRegistry();
    const g = new Game(reg, { seed: 3 });
    g.startNewBeamline(type.id);
    const id = g._ensureBeamlineForSourcePlaceable(
      { id: `src-${type.id}`, type: 'source', category: 'beamline' });
    assertEq(reg.get(id).beamState.machineType, type.machineType,
      `${type.id} → machineType '${type.machineType}'`);
  }
}

// ---------------------------------------------------------------------------
// 3. The trap: no heuristic may outvote the type
// ---------------------------------------------------------------------------
console.log('\n=== machineType comes from the type, never from the parts ===\n');

function designerFor(game) {
  // The constructor reaches straight for #designer-overlay, so build the
  // instance off the prototype instead of stubbing a DOM. _machineTypeForDraft
  // reads exactly three fields — game, beamlineId, editSourceId — and the
  // prototype chain is intact, so `in` checks below still see the real class.
  const d = Object.create(BeamlineDesigner.prototype);
  d.game = game;
  d.beamlineId = null;
  d.editSourceId = null;
  d.draftNodes = [];
  return d;
}

{
  // The exact shape of the old bug: a lightSource whose draft contains an
  // undulator. The dead heuristic returned 'fel' here.
  const { g, entry } = gameWithSource('lightSource');
  const d = designerFor(g);
  d.beamlineId = null;              // what openFromSource always leaves it as
  d.editSourceId = entry.sourceId;
  d.draftNodes = [
    { type: 'source', params: {} },
    { type: 'undulator', params: {} },
    { type: 'beamStop', params: {} },
  ];
  assertEq(d._machineTypeForDraft(), 'lightSource',
    'a lightSource with an undulator in it is still a lightSource, not an FEL');
  assert(!('_pickMachineType' in d),
    'the undulator→fel heuristic no longer exists on the designer');
}

{
  // Same draft, an XFEL: the type says 'xfel' and that is what physics gets.
  // Same components, opposite answer — which is the whole point of types.
  const { g, entry } = gameWithSource('xfel');
  const d = designerFor(g);
  d.editSourceId = entry.sourceId;
  d.draftNodes = [{ type: 'source', params: {} }, { type: 'undulator', params: {} }];
  assertEq(d._machineTypeForDraft(), 'xfel',
    'the same undulator draft on an xfel resolves to xfel');
}

{
  // A typed beamline with NO undulator must still get its type — the old
  // heuristic would have said 'linac' and quietly dropped the module stack.
  const { g, entry } = gameWithSource('spallation');
  const d = designerFor(g);
  d.editSourceId = entry.sourceId;
  d.draftNodes = [{ type: 'ionSource', params: {} }, { type: 'drift', params: {} }];
  assertEq(d._machineTypeForDraft(), 'spallation',
    'a typed beamline with no insertion device still resolves to its type');
}

{
  // Resolution via the registry id, not just the source id.
  const { g, entry } = gameWithSource('therapy');
  const d = designerFor(g);
  d.beamlineId = entry.id;
  d.editSourceId = null;
  d.draftNodes = [{ type: 'undulator', params: {} }];
  assertEq(d._machineTypeForDraft(), 'therapy',
    'a draft opened by beamlineId resolves through the registry entry');
}

{
  // Untyped and typeless drafts. Neither may invent a specialised stack.
  const { g, entry } = gameWithSource(null);
  const d = designerFor(g);
  d.editSourceId = entry.sourceId;
  d.draftNodes = [{ type: 'undulator', params: {} }];
  assertEq(d._machineTypeForDraft(), 'linac',
    'an untyped beamline keeps its beamState machineType, undulator or not');

  const lib = designerFor(g);
  lib.beamlineId = null;
  lib.editSourceId = null;
  lib.draftNodes = [{ type: 'undulator', params: {} }, { type: 'wiggler', params: {} }];
  assertEq(lib._machineTypeForDraft(), 'linac',
    'a design-library draft has no beamline to ask and claims no specialised product');
}

{
  // The map-side physics path agrees with the designer, and repairs a
  // beamState whose machineType drifted away from its type.
  const { g, entry } = gameWithSource('euvFel');
  entry.beamState.machineType = 'fel';   // as a hand-edited save might read
  g.recalcBeamline(entry.id);
  assertEq(g.registry.get(entry.id).beamState.machineType, 'euvFel',
    'a recalc re-derives machineType from the type and overwrites drift');
}

// ---------------------------------------------------------------------------
// 4. Picker presentation
// ---------------------------------------------------------------------------
console.log('\n=== Locked tiles name what they want ===\n');

{
  // A locked tile has to say what would open it, by NAME — an id like
  // 'isochronousCyclotron' in the UI is a leaked internal. Counts come off the
  // table rather than being restated, so retuning therapy's gate is a
  // beamline-types decision and not a picker-test failure.
  const gate = getBeamlineType('therapy').requires;
  const names = missingResearchNames('therapy', { completedResearch: [] });
  assertEq(names.length, gate.length, 'therapy names every one of its missing nodes');
  assert(names.every(n => n && !/^[a-z][A-Za-z]*$/.test(n)),
    'missing nodes are reported as display names, not raw ids');

  const partly = missingResearchNames('therapy',
    { completedResearch: gate.slice(1) });
  assertEq(partly.length, 1, 'a partly-researched type names only what is left');

  assertEq(missingResearchNames('testStand', { completedResearch: [] }).length, 0,
    'an ungated type is never locked');
}

{
  // Band formatting. Sub-GeV bands read in MeV — a therapy line advertised as
  // "0.07–0.25 GeV" is technically true and useless.
  assertEq(formatEnergyBand([0.07, 0.25]), '70–250 MeV', 'sub-GeV bands read in MeV');
  assertEq(formatEnergyBand([6, 17.5]), '6–17.5 GeV', 'GeV bands keep one decimal');
  assertEq(formatEnergyBand([45, 120]), '45–120 GeV', 'large bands round to integers');
  assertEq(formatEnergyBand(null), '—', 'a missing band renders as a dash, not NaN');
  assertEq(formatCurrentBand([0.001, 0.05]), '1–50 µA', 'therapy currents read in µA');
  assertEq(formatCurrentBand([200, 500]), '200–500 mA', 'ring currents read in mA');
  assertEq(formatCurrentBand(undefined), null,
    'a type with no current band (collider) renders no current chip');

  // Every type must render something on all three chips it advertises.
  for (const t of Object.values(BEAMLINE_TYPES)) {
    assert(formatEnergyBand(t.spec?.energyGeV) !== '—',
      `${t.id} has a renderable energy band`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
