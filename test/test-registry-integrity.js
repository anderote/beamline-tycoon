// test/test-registry-integrity.js
//
// Every hand-written id string in src/ must resolve against the registry it
// targets. This is insurance against the single largest bug class the review
// rounds found: strings that used to be right. computeSystemStats counted
// 'klystron' / 'ssa' / 'heliumCompressor' / 'subCooling2K' — none of which are
// COMPONENTS ids — so every klystron the player placed and was billed for
// reported as zero hardware in the systems panel. Nothing failed; the numbers
// were just quietly wrong.
//
// validateResearch() (src/data/validate.js) already does this for one table
// and found 27 dead nodes. This generalizes it to every other list.
//
// Three checks:
//   1. LISTS       — each curated list resolves against a named registry.
//   2. SWEEP       — every id-shaped literal in an id position anywhere in
//                    src/ resolves against *some* registry (catches the lists
//                    nobody remembers writing).
//   3. RESEARCH ↔  — the two-way gating contract between RESEARCH.unlocks and
//      COMPONENTS    COMPONENTS.requires.
//
// Adding a coverage entry is one line in LISTS. Ids that are deliberately
// forward-looking go in UNIMPLEMENTED_CONTENT with a reason, never by
// dropping the check — and that allowlist is self-cleaning: an entry that
// becomes real fails here until it is removed.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { ZONES } from '../src/data/facility.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { MODES, CATEGORIES, INFRA_DISTRIBUTION } from '../src/data/modes.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../src/data/structure.js';
import { DECORATIONS } from '../src/data/decorations.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import {
  RESEARCH, RESEARCH_CATEGORIES, RESEARCH_LAB_MAP,
} from '../src/data/research.js';
import {
  DEMOLISH_BUTTONS, DEMOLISH_PLACEABLE_SCOPE, DEMOLISH_STANDALONE,
} from '../src/input/demolishScopes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Registries. `name` is what a failure message quotes, so it must name the
// module a reader would go edit.
// ---------------------------------------------------------------------------
const reg = (name, keys) => ({ name, ids: new Set(keys) });

const R = {
  COMPONENTS:  reg('COMPONENTS',       Object.keys(COMPONENTS)),
  PLACEABLES:  reg('PLACEABLES',       Object.keys(PLACEABLES)),
  ZONES:       reg('ZONES',            Object.keys(ZONES)),
  UTILITIES:   reg('UTILITY_TYPES',    Object.keys(UTILITY_TYPES)),
  RESEARCH:    reg('RESEARCH',         Object.keys(RESEARCH)),
  RESEARCH_CAT: reg('RESEARCH_CATEGORIES', Object.keys(RESEARCH_CATEGORIES)),
  MODES:       reg('MODES',            Object.keys(MODES)),
  CATEGORIES:  reg('CATEGORIES',       Object.keys(CATEGORIES)),
  INFRA_CATS:  reg('MODES.infra.categories', Object.keys(MODES.infra.categories)),
  FLOORS:      reg('FLOORS',           Object.keys(FLOORS)),
  WALLS:       reg('WALL_TYPES',       Object.keys(WALL_TYPES)),
  DOORS:       reg('DOOR_TYPES',       Object.keys(DOOR_TYPES)),
  KINDS:       reg('Placeable kinds',  ['beamline', 'infrastructure', 'equipment', 'furnishing', 'decoration']),
  DEMOLISH:    reg('demolish tools',   [...Object.keys(DEMOLISH_PLACEABLE_SCOPE), ...DEMOLISH_STANDALONE]),
};

// Union of every id namespace, for the broad sweep.
const UNIVERSE = new Set([
  ...R.COMPONENTS.ids, ...R.PLACEABLES.ids, ...R.ZONES.ids, ...R.UTILITIES.ids,
  ...R.RESEARCH.ids, ...R.MODES.ids, ...R.CATEGORIES.ids, ...R.FLOORS.ids,
  ...R.WALLS.ids, ...R.DOORS.ids, ...Object.keys(DECORATIONS),
]);

// ---------------------------------------------------------------------------
// Forward-looking content: ids named by shipped code for components that do
// not exist yet. They are NOT typos — dropping them would delete design intent.
//
// The table that used to name most of these (MACHINE_TIER) is gone, replaced by
// the per-type allowlists in src/data/beamline-types.js. What remains is owned
// by the beamline-types waves: photon-port hardware lands with the Light
// Source, positron hardware with the Collider.
//
// Self-cleaning: implementing one of these fails the "no longer unimplemented"
// assertion below until it is removed from this list.
// ---------------------------------------------------------------------------
const UNIMPLEMENTED_CONTENT = new Set([
  // photoinjector guns (Game._ensureBeamlineForSourcePlaceable names these)
  'dcPhotoGun', 'ncRfGun', 'srfGun',
  // FEL hardware (Game._tickBeamlineEconomy has photon-port user-fee code)
  // `chicane` and `undulator` were here and are now real components — adding
  // them is what finally lets BunchCompressionModule and FELGainModule run.
  'harmonicLinearizer', 'dogleg', 'laserHeater',
  'helicalUndulator', 'wiggler', 'apple2Undulator', 'photonPort',
  'bunchLengthMonitor', 'energySpectrometer',
  'srf650Cavity', 'cbandCavity', 'xbandCavity',
  'octupole', 'scQuad', 'scDipole',
  // collider hardware
  'positronTarget', 'kickerMagnet', 'septumMagnet', 'comptonIP',
  'fixedTargetAdv', 'stripperFoil',
]);

// ---------------------------------------------------------------------------
// Sweep exemptions: `<file>:<id>` pairs where a `.type === '…'` comparison is
// about a namespace that is not a content registry. Each needs a reason.
// ---------------------------------------------------------------------------
const SWEEP_EXEMPT = new Map([
  ['src/game/agent/actions.js:bad', 'log-entry severity, not a content id'],
  ['src/game/agent/observation.js:bad', 'log-entry severity, not a content id'],
  ['src/ui/probe.js:summary', 'probe table cell kind, not a content id'],
]);

// ---------------------------------------------------------------------------
// Reads a module-private id list straight out of the source file, so the test
// checks the list the code actually uses rather than a copy that can drift
// from it. Throws when the list is renamed or reshaped — a silent [] would
// turn this suite into a no-op.
// ---------------------------------------------------------------------------
function sourceList(file, name, { key } = {}) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`test-registry-integrity: no list named '${name}' in ${file} — was it renamed?`);
  // `key` pulls one field out of a list of objects; otherwise take every
  // string literal in the block.
  const re = key ? new RegExp(`${key}:\\s*'([^']+)'`, 'g') : /'([^']+)'/g;
  return [...m[1].matchAll(re)].map(x => x[1]);
}

// One curated coverage entry: [label, ids, registry, allowUnimplemented?].
// `label` reads "<file> <list>" so a failure names both. The fourth element
// opts a single list into UNIMPLEMENTED_CONTENT — never set it just to make a
// failure go away; a scenario or palette list naming unbuilt hardware is a
// real bug, only the forward-looking progression tables are exempt.
const LISTS = [
  // --- the panel counters the review rounds found dead ---
  // PUMP_TYPES was two lists (billed in economy.js, displayed 120 lines
  // below); it now lives once in aggregates.js.
  ['src/game/aggregates.js PUMP_TYPES',     sourceList('src/game/aggregates.js', 'PUMP_TYPES'),  R.COMPONENTS],
  ['src/game/economy.js gaugeTypes',        sourceList('src/game/economy.js', 'gaugeTypes'),     R.COMPONENTS],
  ['src/game/economy.js rfSourceTypes',     sourceList('src/game/economy.js', 'rfSourceTypes'),  R.COMPONENTS],

  // --- utility-type references outside the registry ---
  ['src/game/utility-gate.js HARD_REQUIRED_UTILS', sourceList('src/game/utility-gate.js', 'HARD_REQUIRED_UTILS'), R.UTILITIES],
  ['src/ui/overlays.js valveConns',         sourceList('src/ui/overlays.js', 'valveConns'),      R.UTILITIES],
  ['src/ui/BeamlineWindow.js UTILITY_TYPES', sourceList('src/ui/BeamlineWindow.js', 'UTILITY_TYPES', { key: 'key' }), R.UTILITIES],
  ['src/data/modes.js utilityLineTools',    Object.values(MODES.infra.categories).flatMap(c => c.utilityLineTools || []), R.UTILITIES],
  ['src/data/modes.js INFRA_DISTRIBUTION values', Object.values(INFRA_DISTRIBUTION).flat(),      R.UTILITIES],

  // --- palette / mode plumbing ---
  ['src/data/modes.js INFRA_DISTRIBUTION keys', Object.keys(INFRA_DISTRIBUTION),                 R.INFRA_CATS],
  ['src/ui/overlays.js facilityCategories', sourceList('src/ui/overlays.js', 'facilityCategories'), R.INFRA_CATS],
  ['src/input/InputHandler.js modeOrder',   sourceList('src/input/InputHandler.js', 'modeOrder'), R.MODES],
  ['src/ui/hud.js flooringKeys',            sourceList('src/ui/hud.js', 'flooringKeys'),         R.FLOORS],
  ['src/data/modes.js facility zoneType',   Object.values(MODES.facility.categories).map(c => c.zoneType).filter(Boolean), R.ZONES],

  // --- zone ↔ palette back-references ---
  ['src/data/facility.js ZONES.requiredFloor', Object.values(ZONES).map(z => z.requiredFloor),   R.FLOORS],
  ['src/data/facility.js ZONES.gatesCategory', Object.values(ZONES)
    .flatMap(z => (Array.isArray(z.gatesCategory) ? z.gatesCategory : [z.gatesCategory]))
    .filter(Boolean),                                                                            R.CATEGORIES],

  // --- research tables ---
  ['src/data/research.js RESEARCH_LAB_MAP keys',   Object.keys(RESEARCH_LAB_MAP),                R.RESEARCH_CAT],
  ['src/data/research.js RESEARCH_LAB_MAP values', Object.values(RESEARCH_LAB_MAP),              R.ZONES],
  ['src/data/research.js RESEARCH node.category',  Object.values(RESEARCH).map(n => n.category).filter(Boolean), R.RESEARCH_CAT],
  ['src/data/research.js RESEARCH node.requires',  Object.values(RESEARCH).flatMap(n => n.requires || []), R.RESEARCH],
  ['src/data/research.js RESEARCH node.unlocks',   Object.values(RESEARCH).flatMap(n => n.unlocks || []),  R.COMPONENTS],
  ['components requires -> RESEARCH',              Object.values(COMPONENTS)
    .flatMap(c => (Array.isArray(c.requires) ? c.requires : [c.requires])).filter(Boolean),      R.RESEARCH],

  // --- misc content lists ---
  ['src/game/map-generator.js SCATTER_POOL', sourceList('src/game/map-generator.js', 'SCATTER_POOL'), R.PLACEABLES],
  ['src/renderer3d/component-builder.js ROLE_BUILDERS',
    [...readFileSync(join(ROOT, 'src/renderer3d/component-builder.js'), 'utf8')
      .matchAll(/^ROLE_BUILDERS\.([A-Za-z0-9_]+)\s*=/gm)].map(m => m[1]),                         R.COMPONENTS],
  ['src/input/demolishScopes.js DEMOLISH_BUTTONS keys', DEMOLISH_BUTTONS.map(b => b.key),        R.DEMOLISH],
  ['src/input/demolishScopes.js DEMOLISH_PLACEABLE_SCOPE',
    Object.values(DEMOLISH_PLACEABLE_SCOPE).flatMap(s => [...s]),                                R.KINDS],
];

// Scenario generators write ids straight into the map — one dead floor/zone/
// furnishing id and the scripted layout silently drops that piece.
for (const s of SCENARIOS) {
  if (!s.generator) continue;
  const d = s.generator();
  const uniq = (arr, f) => [...new Set((arr || []).map(f))];
  LISTS.push(
    [`scenario ${s.id} floors`,     uniq(d.floors, f => f.type),     R.FLOORS],
    [`scenario ${s.id} zones`,      uniq(d.zones, z => z.type),      R.ZONES],
    [`scenario ${s.id} walls`,      uniq(d.walls, w => w.type),      R.WALLS],
    [`scenario ${s.id} doors`,      uniq(d.doors, o => o.type),      R.DOORS],
    [`scenario ${s.id} placeables`, uniq(d.placeables, p => p.type), R.PLACEABLES],
  );
}

console.log('--- every curated id list resolves against its registry ---');
for (const [label, ids, registry, allowUnimplemented] of LISTS) {
  const dead = [...new Set(ids)].filter(id =>
    !registry.ids.has(id) && !(allowUnimplemented && UNIMPLEMENTED_CONTENT.has(id)));
  assert(dead.length === 0,
    `${label}: ${dead.length === 0 ? `all ${new Set(ids).size} ids resolve` : `dead ${registry.name} id(s) ${dead.map(d => `'${d}'`).join(', ')}`}`);
}

console.log('\n--- the allowlist is still needed ---');
{
  const nowReal = [...UNIMPLEMENTED_CONTENT].filter(id => UNIVERSE.has(id));
  assert(nowReal.length === 0,
    `UNIMPLEMENTED_CONTENT holds nothing that exists now (drop ${nowReal.map(i => `'${i}'`).join(', ') || '—'})`);
}

// ---------------------------------------------------------------------------
// Broad sweep. Anything shaped like a content id sitting in an id position has
// to resolve somewhere. This checks against the *union* of every namespace, so
// it only catches ids that exist nowhere at all — per-registry precision is
// the LISTS table's job. It is the net under the lists nobody remembers
// writing (objective conditions, tutorial steps, one-off `p.type === 'mps'`).
// ---------------------------------------------------------------------------
const ID_POSITIONS = [
  /\.type\s*[=!]==\s*'([a-z][A-Za-z0-9]*)'/g,
  /\btypes\.includes\('([a-z][A-Za-z0-9]*)'\)/g,
  /\bcounts\.([a-z][A-Za-z0-9]*)\b/g,
  /\b(?:COMPONENTS|PLACEABLES|ZONES)\['([a-z][A-Za-z0-9]*)'\]/g,
  /\bcountPipePlacements\([^,]+,\s*'([a-z][A-Za-z0-9]*)'\)/g,
];

// The .raw.js registries are the definitions themselves, not references to
// them — validateContent already owns their shape.
function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.raw.js')) out.push(p);
  }
  return out;
}

console.log('\n--- no dead id literals anywhere in src/ ---');
{
  const offenders = [];
  const exemptionsUsed = new Set();
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    for (const re of ID_POSITIONS) {
      for (const m of src.matchAll(re)) {
        const id = m[1];
        if (UNIVERSE.has(id) || UNIMPLEMENTED_CONTENT.has(id)) continue;
        if (SWEEP_EXEMPT.has(`${rel}:${id}`)) { exemptionsUsed.add(`${rel}:${id}`); continue; }
        offenders.push(`${rel}: '${id}'`);
      }
    }
  }
  const uniq = [...new Set(offenders)];
  assert(uniq.length === 0,
    `every id literal resolves${uniq.length ? ` — dead: ${uniq.join('; ')}` : ''}`);

  const stale = [...SWEEP_EXEMPT.keys()].filter(k => !exemptionsUsed.has(k));
  assert(stale.length === 0,
    `SWEEP_EXEMPT holds nothing stale (drop ${stale.join(', ') || '—'})`);
}

// ---------------------------------------------------------------------------
// Research ↔ components, both directions.
//
// validateResearch() already checks that `unlocks` names a real component.
// The other half of the contract was left open: a node that advertises an
// unlock must actually gate it (the component is not `unlocked: true`, and its
// `requires` resolves to that node or one of its prerequisites), and a
// component gated by a node must be advertised by it. Otherwise the tech tree
// shows an "Unlocks:" badge for hardware the player already had, or gates
// hardware no node ever mentions.
//
// KNOWN_OPEN_GATING held the eleven cases Phase 9b found; Phase 12 closed
// every one (the nine ungated/pre-unlocked components, heRecovery advertised
// by a node that does not gate it, and gyrotron gated but never advertised).
// It stays as an empty set so a regression has to *add* an exception rather
// than delete an assertion — and the "nothing already fixed" check below keeps
// any new entry honest.
// ---------------------------------------------------------------------------
const KNOWN_OPEN_GATING = new Set([]);

function prerequisitesOf(nodeId) {
  const seen = new Set();
  const stack = [...(RESEARCH[nodeId]?.requires || [])];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(RESEARCH[id]?.requires || []));
  }
  return seen;
}

console.log('\n--- research gating is symmetric (unlocks <-> requires) ---');
{
  const open = [];
  // Forward: what a node claims to unlock, it must actually gate.
  for (const [nodeId, node] of Object.entries(RESEARCH)) {
    for (const compId of node.unlocks || []) {
      const comp = COMPONENTS[compId];
      if (!comp) continue; // validateResearch owns dangling ids
      const requires = Array.isArray(comp.requires) ? comp.requires : (comp.requires != null ? [comp.requires] : []);
      const prereqs = prerequisitesOf(nodeId);
      const gatedHere = requires.some(r => r === nodeId || prereqs.has(r));
      if (comp.unlocked === true || !gatedHere) open.push(`${nodeId}->${compId}`);
    }
  }
  // Reverse: what gates a component, that node must advertise.
  for (const [compId, comp] of Object.entries(COMPONENTS)) {
    const requires = Array.isArray(comp.requires) ? comp.requires : (comp.requires != null ? [comp.requires] : []);
    for (const nodeId of requires) {
      const node = RESEARCH[nodeId];
      if (!node) continue; // covered by the LISTS check above
      if (!(node.unlocks || []).includes(compId)) open.push(`${nodeId}<-${compId}`);
    }
  }

  const unexpected = [...new Set(open)].filter(k => !KNOWN_OPEN_GATING.has(k));
  assert(unexpected.length === 0,
    `no new gating asymmetry${unexpected.length ? ` — ${unexpected.join(', ')}` : ''}`);

  const fixed = [...KNOWN_OPEN_GATING].filter(k => !open.includes(k));
  assert(fixed.length === 0,
    `KNOWN_OPEN_GATING holds nothing already fixed (drop ${fixed.join(', ') || '—'})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
