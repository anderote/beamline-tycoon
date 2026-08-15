// src/data/wiki/links.js
//
// The article ↔ component cross-reference, written out by hand ON PURPOSE.
//
// This table is the staleness gate. The wiki drifted before because nothing
// connected the prose to the registry: a component could be renamed or deleted
// and the article that documented it would keep saying otherwise forever.
// test/test-wiki-content.js asserts every id below still exists in COMPONENTS,
// so removing a component now breaks the build and points at the article that
// has to be rewritten.
//
// Deriving these links by fuzzy-matching component names against article text
// would defeat the point — a deleted component simply stops matching, and the
// check silently passes.

import { COMPONENTS } from '../components.js';
import { PARAM_DEFS } from '../../beamline/component-physics.js';
import { CAVITY_SPECS } from '../../beamline/cavity-specs.js';

/**
 * Articles that exist but are not content: the two READMEs duplicate the table
 * of contents. They stay reachable by id — the docs cross-link to them — and
 * simply never appear in the index or in search results.
 */
export const NAVIGATION_ARTICLES = new Set(['infra-README', 'physics-README']);

/** Article id → the components that article actually documents. */
export const ARTICLE_COMPONENTS = {
  'infra-power': [
    'powerPanel', 'ups', 'padMountTransformer', 'facilityTransformer',
    'hvTransformer', 'gridIntertieTransformer', 'mcc', 'switchgear',
    'powerBus', 'spiderBox', 'disconnectSwitch',
  ],
  'infra-vacuum': [
    'roughingPump', 'roughingPumpCart', 'turboPump', 'turboPumpCart',
    'vacuumCart', 'highCapacityVacuumStation',
    'ionPump', 'negPump', 'tiSubPump',
    'vacuumManifold', 'gateValve', 'bakeoutSystem',
    'piraniGauge', 'coldCathodeGauge', 'baGauge',
  ],
  'infra-rf-power': [
    'magnetron', 'widebandDriverAmp', 'lowBandBuncherAmp', 'solidStateAmp', 'slac5045Klystron', 'twt',
    'pulsedKlystron', 'cwKlystron', 'iot',
    'multibeamKlystron', 'highPowerSSA', 'gyrotron',
    'waveguideManifold', 'circulator', 'modulator', 'rfCoupler', 'llrfController',
  ],
  'infra-cooling': [
    'fanCoilCooler', 'packageChiller',
    'lcwSkid', 'dualCircuitChiller', 'chiller', 'dryCoolerBank',
    'coolingTower', 'coolingManifold', 'deionizer',
    'emergencyCooling', 'waterLoad',
  ],
  'infra-cryogenics': [
    'coldBox2K', 'coldBox4K', 'cryoValveBox', 'heCompressor', 'heRecovery',
    'heRecoveryHeader', 'heGasBag', 'hePurifier', 'heLiquefier',
    'ln2Dewar', 'ln2Precooler', 'cryocooler', 'cryomoduleHousing', 'cryomodule',
  ],
  'infra-controls': [
    'rackIoc', 'timingSystem', 'networkSwitch', 'archiver', 'patchPanel',
    'fiberBus', 'bpmElectronics', 'blmReadout',
    'mps', 'ppsInterlock', 'accessControl', 'searchSecure', 'areaMonitor',
  ],
  'infra-connection-types': [
    'powerBus', 'spiderBox', 'coolingManifold', 'vacuumManifold', 'waveguideManifold',
    'cryoValveBox', 'fiberBus',
  ],
  'physics-tier1-components': [
    'source', 'drift', 'quadrupole', 'dipole', 'rfCavity', 'aperture',
    'target', 'beamDump', 'bpm',
  ],
  'physics-tier1-physics': ['quadrupole', 'dipole', 'drift', 'sextupole'],
  'physics-tier2-components': ['screen', 'ict', 'wireScanner'],
  'physics-tier2-physics': ['bpm', 'screen', 'wireScanner', 'emittanceFilter'],
  'physics-tier3-components': ['buncher'],
  'physics-tier4-components': ['target', 'detector', 'injectionSeptum', 'collisionPoint'],
  'physics-tier4-physics': ['collisionPoint', 'detector'],
};

/**
 * Extra articles for a specific component, beyond what the category and its
 * utility ports already imply.
 */
export const COMPONENT_ARTICLE_OVERRIDES = {
  drift: ['physics-tier1-components', 'infra-vacuum', 'physics-equations'],
  bellows: ['infra-vacuum'],
  cryomodule: ['infra-cryogenics', 'infra-rf-power', 'infra-infrastructure-quality'],
  ellipticalSrfCavity: ['infra-cryogenics', 'infra-rf-power'],
  spokeCavity: ['infra-cryogenics', 'infra-rf-power'],
  halfWaveResonator: ['infra-cryogenics', 'infra-rf-power'],
  rfCavity: ['physics-tier1-components', 'infra-rf-power', 'infra-cooling'],
  sbandStructure: ['infra-rf-power', 'infra-cooling'],
  quadrupole: ['physics-tier1-physics', 'physics-equations'],
  dipole: ['physics-tier1-physics', 'physics-equations'],
  source: ['physics-tier2-physics'],
  detector: ['physics-tier4-physics'],
  collisionPoint: ['physics-tier4-physics'],
};

/** Category → the article that frames that whole family. */
export const CATEGORY_ARTICLES = {
  source: ['physics-tier1-components', 'physics-fundamentals'],
  optics: ['physics-tier1-components', 'physics-tier1-physics'],
  rf: ['infra-rf-power', 'physics-tier1-components'],
  diagnostic: ['physics-diagnostics-and-plots', 'physics-tier2-components'],
  endpoint: ['physics-tier4-components'],
  power: ['infra-power'],
  vacuum: ['infra-vacuum'],
  rfPower: ['infra-rf-power'],
  cooling: ['infra-cooling'],
  dataControls: ['infra-controls'],
  ops: ['infra-controls'],
};

/** Every component page ends with the two articles that explain the model. */
const UNIVERSAL_ARTICLES = ['infra-utility-networks', 'infra-infrastructure-quality'];

/**
 * Backticked identifiers the docs use that are neither component ids, tunable
 * params, objectives nor port params — solver field names and the functions
 * the articles name when they explain a mechanic. The vocabulary check in
 * test/test-wiki-content.js derives everything else from the live registries;
 * this is the short list it cannot, and adding to it should feel like a small
 * decision, not a reflex — an unrecognised identifier usually means the doc is
 * out of date, not that the list is short.
 */
export const SCHEMA_IDENTIFIERS = [
  // Component/def schema
  'requiredConnections', 'zoneOutput', 'energyCost', 'physicsType', 'spriteKey',
  'isDrawnConnection', 'interiorVolume', 'zoneTier', 'rfBand', 'beamPipes',
  'placement', 'subL', 'subW', 'subH', 'gridW', 'gridH',
  // Per-sink quantities the solvers publish
  'infraQuality', 'vacuumPressure', 'cryoTempK', 'coolingDeltaT', 'rfPowerW',
  'cryoQuenched', 'wasQuenched', 'liveCavities', 'coolingDegradation',
  'reflectedFraction', 'reportedPressure',
  'gradientDemanded', 'gradientAchievable', 'gradientAchieved', 'cavityQ0', 'pDissW',
  'perSinkQuality', 'perSinkPower', 'perSinkPressure', 'perSinkDeltaT',
  'perSegmentLoad', 'totalCapacity', 'totalDemand', 'meanDuty', 'peakFactor',
  // The 0-1 scalars, still computed and still named in the quality article
  'powerQuality', 'rfQuality', 'coolingQuality', 'cryoQuality', 'vacuumQuality',
  'dataQuality',
  // Functions the articles name when they explain a mechanic
  'findUnconnectedSinks', 'findLabNetworkBonuses', 'createBeamline',
  'costPerSubUnit', 'serviceRadius',
  // Game-state flags objectives read (see BeamlineRegistry defaults)
  'felSaturated',
];

/**
 * Cavities and elements that are modelled in PARAM_DEFS or CAVITY_SPECS but
 * have no placeable component yet. The physics wiki documents several of them,
 * which is legitimate — they are the design of the machine, not a stale
 * reference — so they are computed here rather than asserted against.
 */
export const DOCUMENTED_NOT_PLACEABLE = [
  ...new Set([...Object.keys(PARAM_DEFS), ...Object.keys(CAVITY_SPECS)]),
].filter(id => !COMPONENTS[id]).sort();

/** Articles for one component: category defaults, port utilities, overrides. */
export function relatedArticlesFor(componentId, utilities) {
  const comp = COMPONENTS[componentId];
  const out = [];
  const add = (id) => { if (id && !out.includes(id)) out.push(id); };

  for (const a of COMPONENT_ARTICLE_OVERRIDES[componentId] || []) add(a);
  for (const a of CATEGORY_ARTICLES[comp?.category] || []) add(a);
  for (const u of utilities) add(u.article);
  for (const a of UNIVERSAL_ARTICLES) add(a);
  return out;
}
