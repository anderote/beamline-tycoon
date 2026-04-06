// Test: every component has requiredConnections, RF components have rfFrequency
const fs = require('fs');
const vm = require('vm');

const ctx = vm.createContext({ console, Math, Date, JSON, Array, Object, String });
vm.runInContext(fs.readFileSync('data.js', 'utf8'), ctx);

const testCode = `
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); failed++; }
  else { passed++; }
}

const keys = Object.keys(COMPONENTS);
console.log('=== Network Property Tests ===');
console.log('Testing ' + keys.length + ' components...');

// 1. Every component has a requiredConnections array
keys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    Array.isArray(c.requiredConnections),
    k + ' missing requiredConnections array'
  );
});

// 2. Every component with energyCost > 0 has powerCable
// Exceptions: passive components whose energy cost is indirect/negligible
const noPowerExceptions = ['tiSubPump', 'ln2Precooler', 'cryomoduleHousing', 'collimator'];
keys.forEach(k => {
  const c = COMPONENTS[k];
  if (c.energyCost > 0 && noPowerExceptions.indexOf(k) === -1) {
    assert(
      Array.isArray(c.requiredConnections) && c.requiredConnections.indexOf('powerCable') !== -1,
      k + ' has energyCost=' + c.energyCost + ' but no powerCable in requiredConnections'
    );
  }
});

// 3. All RF cavity types have rfFrequency
const rfCavityKeys = keys.filter(k => {
  const c = COMPONENTS[k];
  return (c.category === 'rf' ||
    (Array.isArray(c.requiredConnections) && c.requiredConnections.indexOf('rfWaveguide') !== -1 && c.category !== 'rfPower'));
});
rfCavityKeys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    c.rfFrequency !== undefined,
    k + ' is an RF cavity/structure but missing rfFrequency'
  );
});

// 4. All RF source types have rfFrequency
const rfSourceKeys = keys.filter(k => {
  const c = COMPONENTS[k];
  return c.category === 'rfPower' && c.subsection === 'sources';
});
rfSourceKeys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    c.rfFrequency !== undefined,
    k + ' is an RF source but missing rfFrequency'
  );
});

console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) {
  console.log('\\n=== TESTS FAILED ===');
  // exit with error
  throw new Error(failed + ' test(s) failed');
} else {
  console.log('\\n=== ALL TESTS PASSED ===');
}
`;

vm.runInContext(testCode, ctx);
