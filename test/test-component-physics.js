// test/test-component-physics.js — Node.js tests for component-physics.js

// --- Stub minimal globals ---
global.COMPONENTS = {
  source:    { id: 'source',    length: 2 },
  dcPhotoGun:{ id: 'dcPhotoGun',length: 2 },
  ncRfGun:   { id: 'ncRfGun',   length: 2 },
  srfGun:    { id: 'srfGun',    length: 3 },
};

// --- Load module ---
const { PARAM_DEFS, computeStats, getDefaults } = require('../component-physics.js');

// --- Test harness ---
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg} (expected ${expected}, got ${actual})`);
  }
}

function assertClose(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg} (expected ~${expected}, got ${actual})`);
  }
}

function assertGT(actual, threshold, msg) {
  if (actual > threshold) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg} (expected > ${threshold}, got ${actual})`);
  }
}

// --- Tests ---

console.log('\n=== Component Physics Tests ===\n');

// -----------------------------------------------------------------------
// PARAM_DEFS structure
// -----------------------------------------------------------------------
console.log('-- PARAM_DEFS structure --');
{
  assert(PARAM_DEFS !== undefined, 'PARAM_DEFS is defined');
  assert(PARAM_DEFS.source !== undefined, 'PARAM_DEFS.source exists');
  assert(PARAM_DEFS.dcPhotoGun !== undefined, 'PARAM_DEFS.dcPhotoGun exists');
  assert(PARAM_DEFS.ncRfGun !== undefined, 'PARAM_DEFS.ncRfGun exists');
  assert(PARAM_DEFS.srfGun !== undefined, 'PARAM_DEFS.srfGun exists');

  // source params
  const src = PARAM_DEFS.source;
  assert(src.extractionVoltage !== undefined, 'source has extractionVoltage');
  assert(src.extractionVoltage.min !== undefined, 'extractionVoltage has min');
  assert(src.extractionVoltage.max !== undefined, 'extractionVoltage has max');
  assert(src.extractionVoltage.unit !== undefined, 'extractionVoltage has unit');
  assert(src.extractionVoltage.default !== undefined, 'extractionVoltage has default');
  assert(src.cathodeTemperature !== undefined, 'source has cathodeTemperature');
  assert(src.beamCurrent !== undefined, 'source has beamCurrent');
  assert(src.beamCurrent.derived === true, 'beamCurrent is derived');
  assert(src.emittance !== undefined, 'source has emittance');
  assert(src.emittance.derived === true, 'emittance is derived');

  // dcPhotoGun params
  const dc = PARAM_DEFS.dcPhotoGun;
  assert(dc.extractionVoltage !== undefined, 'dcPhotoGun has extractionVoltage');
  assert(dc.laserPower !== undefined, 'dcPhotoGun has laserPower');
  assert(dc.laserSpotSize !== undefined, 'dcPhotoGun has laserSpotSize');
  assert(dc.beamCurrent !== undefined && dc.beamCurrent.derived, 'dcPhotoGun beamCurrent is derived');
  assert(dc.emittance !== undefined && dc.emittance.derived, 'dcPhotoGun emittance is derived');
  assert(dc.cathodeQE !== undefined && dc.cathodeQE.derived, 'dcPhotoGun cathodeQE is derived');

  // ncRfGun params
  const nc = PARAM_DEFS.ncRfGun;
  assert(nc.peakField !== undefined, 'ncRfGun has peakField');
  assert(nc.rfPhase !== undefined, 'ncRfGun has rfPhase');
  assert(nc.laserSpotSize !== undefined, 'ncRfGun has laserSpotSize');
  assert(nc.beamCurrent !== undefined && nc.beamCurrent.derived, 'ncRfGun beamCurrent is derived');
  assert(nc.emittance !== undefined && nc.emittance.derived, 'ncRfGun emittance is derived');
  assert(nc.bunchCharge !== undefined && nc.bunchCharge.derived, 'ncRfGun bunchCharge is derived');

  // srfGun params
  const srf = PARAM_DEFS.srfGun;
  assert(srf.gradient !== undefined, 'srfGun has gradient');
  assert(srf.repRate !== undefined, 'srfGun has repRate');
  assert(srf.laserSpotSize !== undefined, 'srfGun has laserSpotSize');
  assert(srf.beamCurrent !== undefined && srf.beamCurrent.derived, 'srfGun beamCurrent is derived');
  assert(srf.emittance !== undefined && srf.emittance.derived, 'srfGun emittance is derived');
}

// -----------------------------------------------------------------------
// getDefaults
// -----------------------------------------------------------------------
console.log('\n-- getDefaults --');
{
  const srcDef = getDefaults('source');
  assert(srcDef !== undefined, 'getDefaults(source) returns object');
  assertEq(srcDef.extractionVoltage, PARAM_DEFS.source.extractionVoltage.default,
    'source default extractionVoltage matches PARAM_DEFS');
  assertEq(srcDef.cathodeTemperature, PARAM_DEFS.source.cathodeTemperature.default,
    'source default cathodeTemperature matches PARAM_DEFS');

  const dcDef = getDefaults('dcPhotoGun');
  assertEq(dcDef.laserPower, PARAM_DEFS.dcPhotoGun.laserPower.default,
    'dcPhotoGun default laserPower matches PARAM_DEFS');

  const ncDef = getDefaults('ncRfGun');
  assertEq(ncDef.peakField, PARAM_DEFS.ncRfGun.peakField.default,
    'ncRfGun default peakField matches PARAM_DEFS');

  const srfDef = getDefaults('srfGun');
  assertEq(srfDef.gradient, PARAM_DEFS.srfGun.gradient.default,
    'srfGun default gradient matches PARAM_DEFS');
}

// -----------------------------------------------------------------------
// source (thermionic)
// -----------------------------------------------------------------------
console.log('\n-- source: thermionic physics --');
{
  const defaults = getDefaults('source');
  const stats = computeStats('source', defaults);

  assert(stats !== undefined, 'computeStats(source, defaults) returns object');
  assert(stats.beamCurrent > 0, 'default source produces positive beamCurrent');
  assert(stats.emittance > 0, 'default source produces positive emittance');

  // Child-Langmuir: higher voltage → higher current
  const lowV  = computeStats('source', { ...defaults, extractionVoltage: 20 });
  const highV = computeStats('source', { ...defaults, extractionVoltage: 80 });
  assert(highV.beamCurrent > lowV.beamCurrent,
    'higher extractionVoltage → higher beamCurrent (Child-Langmuir)');

  // Thermal emittance: higher cathode temperature → higher emittance
  const lowT  = computeStats('source', { ...defaults, cathodeTemperature: 700 });
  const highT = computeStats('source', { ...defaults, cathodeTemperature: 1800 });
  assert(highT.emittance > lowT.emittance,
    'higher cathodeTemperature → higher emittance');
}

// -----------------------------------------------------------------------
// dcPhotoGun
// -----------------------------------------------------------------------
console.log('\n-- dcPhotoGun: photocathode DC gun physics --');
{
  const defaults = getDefaults('dcPhotoGun');
  const stats = computeStats('dcPhotoGun', defaults);

  assert(stats !== undefined, 'computeStats(dcPhotoGun, defaults) returns object');
  assert(stats.beamCurrent > 0, 'dcPhotoGun produces positive beamCurrent');
  assert(stats.emittance > 0, 'dcPhotoGun produces positive emittance');
  assert(stats.cathodeQE > 0, 'dcPhotoGun produces positive cathodeQE');

  // Higher laser power → higher current
  const lowP  = computeStats('dcPhotoGun', { ...defaults, laserPower: 0.05 });
  const highP = computeStats('dcPhotoGun', { ...defaults, laserPower: 1.5 });
  assert(highP.beamCurrent > lowP.beamCurrent,
    'higher laserPower → higher beamCurrent');

  // Larger spot size → larger emittance
  const smallSpot = computeStats('dcPhotoGun', { ...defaults, laserSpotSize: 0.2 });
  const largeSpot = computeStats('dcPhotoGun', { ...defaults, laserSpotSize: 2.5 });
  assert(largeSpot.emittance > smallSpot.emittance,
    'larger laserSpotSize → higher emittance');
}

// -----------------------------------------------------------------------
// ncRfGun
// -----------------------------------------------------------------------
console.log('\n-- ncRfGun: normal-conducting RF gun physics --');
{
  const defaults = getDefaults('ncRfGun');
  const stats = computeStats('ncRfGun', defaults);

  assert(stats !== undefined, 'computeStats(ncRfGun, defaults) returns object');
  assert(stats.beamCurrent > 0, 'ncRfGun produces positive beamCurrent');
  assert(stats.emittance > 0, 'ncRfGun produces positive emittance');
  assert(stats.bunchCharge > 0, 'ncRfGun produces positive bunchCharge');

  // Higher peak field → higher bunch charge
  const lowE  = computeStats('ncRfGun', { ...defaults, peakField: 60 });
  const highE = computeStats('ncRfGun', { ...defaults, peakField: 140 });
  assert(highE.bunchCharge > lowE.bunchCharge,
    'higher peakField → higher bunchCharge');

  // Larger spot size → larger emittance
  const smallSpot = computeStats('ncRfGun', { ...defaults, laserSpotSize: 0.2 });
  const largeSpot = computeStats('ncRfGun', { ...defaults, laserSpotSize: 2.5 });
  assert(largeSpot.emittance > smallSpot.emittance,
    'larger laserSpotSize → higher emittance (ncRfGun)');
}

// -----------------------------------------------------------------------
// srfGun
// -----------------------------------------------------------------------
console.log('\n-- srfGun: superconducting RF gun physics --');
{
  const defaults = getDefaults('srfGun');
  const stats = computeStats('srfGun', defaults);

  assert(stats !== undefined, 'computeStats(srfGun, defaults) returns object');
  assert(stats.beamCurrent > 0, 'srfGun produces positive beamCurrent');
  assert(stats.emittance > 0, 'srfGun produces positive emittance');

  // Higher rep rate → higher average current
  const lowRep  = computeStats('srfGun', { ...defaults, repRate: 50 });
  const highRep = computeStats('srfGun', { ...defaults, repRate: 1000 });
  assert(highRep.beamCurrent > lowRep.beamCurrent,
    'higher repRate → higher beamCurrent');

  // Larger spot size → larger emittance
  const smallSpot = computeStats('srfGun', { ...defaults, laserSpotSize: 0.2 });
  const largeSpot = computeStats('srfGun', { ...defaults, laserSpotSize: 2.5 });
  assert(largeSpot.emittance > smallSpot.emittance,
    'larger laserSpotSize → higher emittance (srfGun)');

  // Higher gradient → higher bunch charge (and thus current at fixed rep rate)
  const lowG  = computeStats('srfGun', { ...defaults, gradient: 8 });
  const highG = computeStats('srfGun', { ...defaults, gradient: 35 });
  assert(highG.beamCurrent > lowG.beamCurrent,
    'higher gradient → higher beamCurrent (srfGun)');
}

// -----------------------------------------------------------------------
// quadrupole / scQuad
// -----------------------------------------------------------------------
console.log('\n-- quadrupole: focusing strength --');
{
  const defs = getDefaults('quadrupole');
  const stats = computeStats('quadrupole', defs);
  assert(stats.focusStrength > 0, 'quadrupole produces positive focusStrength');

  const low  = computeStats('quadrupole', { gradient: 5 });
  const high = computeStats('quadrupole', { gradient: 45 });
  assert(high.focusStrength > low.focusStrength,
    'higher gradient → stronger focusing (quadrupole)');

  const scDefs = getDefaults('scQuad');
  const scStats = computeStats('scQuad', scDefs);
  assert(scStats.focusStrength > stats.focusStrength,
    'scQuad (higher default gradient) stronger than regular quadrupole');
}

// -----------------------------------------------------------------------
// dipole / scDipole
// -----------------------------------------------------------------------
console.log('\n-- dipole: max momentum --');
{
  const defs = getDefaults('dipole');
  const stats = computeStats('dipole', defs);
  assert(stats.maxMomentum > 0, 'dipole produces positive maxMomentum');

  const low  = computeStats('dipole', { fieldStrength: 0.2 });
  const high = computeStats('dipole', { fieldStrength: 1.8 });
  assert(high.maxMomentum > low.maxMomentum,
    'higher fieldStrength → higher maxMomentum (dipole)');

  const scDefs  = getDefaults('scDipole');
  const scStats = computeStats('scDipole', scDefs);
  assert(scStats.maxMomentum > stats.maxMomentum,
    'scDipole (higher default field) has larger maxMomentum than regular dipole');
}

// -----------------------------------------------------------------------
// solenoid
// -----------------------------------------------------------------------
console.log('\n-- solenoid: focusing --');
{
  const defs  = getDefaults('solenoid');
  const stats = computeStats('solenoid', defs);
  assert(stats.focusStrength > 0, 'solenoid produces positive focusStrength');

  const weak   = computeStats('solenoid', { fieldStrength: 0.05 });
  const strong = computeStats('solenoid', { fieldStrength: 0.4 });
  assert(strong.focusStrength > weak.focusStrength,
    'stronger B → stronger solenoid focusing');
}

// -----------------------------------------------------------------------
// sextupole / octupole
// -----------------------------------------------------------------------
console.log('\n-- sextupole / octupole: beam quality --');
{
  const sext = computeStats('sextupole', getDefaults('sextupole'));
  assert(sext.beamQuality > 0, 'sextupole produces positive beamQuality');
  assert(sext.beamQuality < 0.3, 'sextupole beamQuality bounded below 0.3');

  const oct  = computeStats('octupole', getDefaults('octupole'));
  assert(oct.beamQuality > 0, 'octupole produces positive beamQuality');
  assert(oct.beamQuality < 0.15, 'octupole beamQuality bounded below 0.15');
}

// -----------------------------------------------------------------------
// rfCavity
// -----------------------------------------------------------------------
console.log('\n-- rfCavity: energy gain --');
{
  const defs  = getDefaults('rfCavity');
  const stats = computeStats('rfCavity', defs);
  assert(stats.energyGain > 0, 'rfCavity on-crest produces positive energyGain');
  assertClose(stats.energySpread, 0, 1e-9,
    'rfCavity on-crest (φ=0) has zero energySpread');

  // off-crest reduces gain
  const offCrest = computeStats('rfCavity', { ...defs, rfPhase: 30 });
  assert(offCrest.energyGain < stats.energyGain,
    'off-crest phase reduces energyGain');
  assert(offCrest.energySpread > 0,
    'off-crest phase produces non-zero energySpread');
}

// -----------------------------------------------------------------------
// cryomodule
// -----------------------------------------------------------------------
console.log('\n-- cryomodule: energy gain --');
{
  const defs  = getDefaults('cryomodule');
  const stats = computeStats('cryomodule', defs);
  assert(stats.energyGain > 0, 'cryomodule produces positive energyGain');

  const lowG  = computeStats('cryomodule', { ...defs, gradient: 8 });
  const highG = computeStats('cryomodule', { ...defs, gradient: 32 });
  assert(highG.energyGain > lowG.energyGain,
    'higher gradient → higher cryomodule energyGain');
}

// -----------------------------------------------------------------------
// buncher / harmonicLinearizer
// -----------------------------------------------------------------------
console.log('\n-- buncher: bunch compression --');
{
  const defs  = getDefaults('buncher');
  const stats = computeStats('buncher', defs);
  // φ=-90 → |sin|=1, so compression is active
  assert(stats.bunchCompression > 0, 'buncher at φ=-90 produces bunchCompression');
  assert(stats.bunchCompression <= 0.8, 'bunchCompression capped at 0.8');

  const lin = computeStats('harmonicLinearizer', getDefaults('harmonicLinearizer'));
  // φ=180 → cos(180°)=-1 → factor=0 → both zero
  assertClose(lin.bunchCompression, 0, 1e-9,
    'harmonicLinearizer at φ=180 has zero bunchCompression');
}

// -----------------------------------------------------------------------
// undulator
// -----------------------------------------------------------------------
console.log('\n-- undulator: K and photon rate --');
{
  const defs  = getDefaults('undulator');
  const stats = computeStats('undulator', defs);
  assert(stats.kParameter  > 0, 'undulator produces positive K');
  assert(stats.photonRate  > 0, 'undulator produces positive photonRate');
  assert(stats.photonEnergy > 0, 'undulator produces positive photonEnergy');

  // Smaller gap → higher B_peak → higher K
  const wideGap   = computeStats('undulator', { gap: 25 });
  const narrowGap = computeStats('undulator', { gap: 6 });
  assert(narrowGap.kParameter > wideGap.kParameter,
    'smaller gap → higher K (undulator)');
  assert(narrowGap.photonRate > wideGap.photonRate,
    'smaller gap → higher photonRate (undulator)');
}

// -----------------------------------------------------------------------
// wiggler / helicalUndulator / apple2Undulator
// -----------------------------------------------------------------------
console.log('\n-- wiggler / helical / apple2 --');
{
  const wig  = computeStats('wiggler', getDefaults('wiggler'));
  assert(wig.kParameter > 1, 'wiggler has K > 1 (undulator-like K<<1 not expected)');

  const hel  = computeStats('helicalUndulator', getDefaults('helicalUndulator'));
  assert(hel.photonRate > 0, 'helicalUndulator produces photonRate');

  const ap0  = computeStats('apple2Undulator', { gap: 10, polarizationMode: 0 });
  const ap1  = computeStats('apple2Undulator', { gap: 10, polarizationMode: 1 });
  assert(ap0.kParameter > ap1.kParameter,
    'apple2 linear mode has higher effective K than circular mode');
}

// -----------------------------------------------------------------------
// combinedFunctionMagnet
// -----------------------------------------------------------------------
console.log('\n-- combinedFunctionMagnet --');
{
  const defs  = getDefaults('combinedFunctionMagnet');
  const stats = computeStats('combinedFunctionMagnet', defs);
  assert(stats.focusStrength > 0, 'combinedFunctionMagnet produces positive focusStrength');
}

// -----------------------------------------------------------------------
// corrector / kickerMagnet — no derived outputs
// -----------------------------------------------------------------------
console.log('\n-- corrector / kickerMagnet: empty stats --');
{
  const corr = computeStats('corrector', getDefaults('corrector'));
  assertEq(Object.keys(corr).length, 0, 'corrector returns empty stats object');

  const kick = computeStats('kickerMagnet', getDefaults('kickerMagnet'));
  assertEq(Object.keys(kick).length, 0, 'kickerMagnet returns empty stats object');
}

// -----------------------------------------------------------------------
// PARAM_DEFS: spot-check new types
// -----------------------------------------------------------------------
console.log('\n-- PARAM_DEFS new types --');
{
  assert(PARAM_DEFS.quadrupole !== undefined, 'PARAM_DEFS.quadrupole exists');
  assert(PARAM_DEFS.quadrupole.gradient !== undefined, 'quadrupole has gradient');
  assert(PARAM_DEFS.quadrupole.focusStrength !== undefined, 'quadrupole has focusStrength');
  assert(PARAM_DEFS.quadrupole.focusStrength.derived === true, 'focusStrength is derived');

  assert(PARAM_DEFS.dipole !== undefined, 'PARAM_DEFS.dipole exists');
  assert(PARAM_DEFS.dipole.maxMomentum.derived === true, 'dipole maxMomentum is derived');

  assert(PARAM_DEFS.rfCavity !== undefined, 'PARAM_DEFS.rfCavity exists');
  assert(PARAM_DEFS.rfCavity.voltage !== undefined, 'rfCavity has voltage');
  assert(PARAM_DEFS.rfCavity.rfPhase !== undefined, 'rfCavity has rfPhase');
  assert(PARAM_DEFS.rfCavity.energyGain.derived === true, 'rfCavity energyGain is derived');

  assert(PARAM_DEFS.undulator !== undefined, 'PARAM_DEFS.undulator exists');
  assert(PARAM_DEFS.undulator.gap !== undefined, 'undulator has gap');
  assert(PARAM_DEFS.undulator.kParameter.derived === true, 'undulator kParameter is derived');

  assert(PARAM_DEFS.apple2Undulator !== undefined, 'PARAM_DEFS.apple2Undulator exists');
  assert(PARAM_DEFS.apple2Undulator.polarizationMode !== undefined,
    'apple2Undulator has polarizationMode');
  assert(Array.isArray(PARAM_DEFS.apple2Undulator.polarizationMode.labels),
    'apple2Undulator polarizationMode has labels array');

  assert(PARAM_DEFS.corrector !== undefined, 'PARAM_DEFS.corrector exists');
  assert(PARAM_DEFS.kickerMagnet !== undefined, 'PARAM_DEFS.kickerMagnet exists');
  assert(PARAM_DEFS.kickerMagnet.riseTime !== undefined, 'kickerMagnet has riseTime');
}

// -----------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
