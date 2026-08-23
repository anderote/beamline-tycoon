// Control Room contract: the display joins published game values and never
// calculates a parallel economy/physics answer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildControlRoomModel, sparklinePoints } from '../src/ui/control-room-model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const publishedEconomy = {
  income: { total: 4321, beam: 3000, dataFees: 700 },
  upkeep: { total: 876 },
  net: 3445,
};
const game = {
  state: {
    tick: 91,
    infraCanRun: false,
    uptimeFraction: 0.625,
    resources: { funding: 777777 },
    // Deliberately unrelated raw values: the model must use the published
    // economy snapshot above rather than trying to infer cash flow from these.
    staffCosts: { operator: 999999 },
    totalEnergyCost: 123456,
    staffMembers: [
      { mood: 'content', job: { jobType: 'runBeam' } },
      { mood: 'tired', job: null },
      { mood: 'content', job: { jobType: 'repair' }, unservicedPenalty: true },
    ],
    infraBlockers: [{ code: 'power_unconnected', message: 'Power feed is open.' }],
  },
  registry: {
    getAll: () => [{
      id: 'bl-1', name: 'North Line', accentColor: '#12abef', status: 'running',
      beamState: {
        canRun: false, holdReason: 'The source power feed is open.',
        beamQuality: 0.82, totalLossFraction: 0.07, beamEnergy: 250,
        beamCurrent: 0.4, effectiveDataRate: 31, uptimeFraction: 0.75,
        totalLength: 42, serviceRevenue: 2800, serviceContract: 'Photon users',
        rawDataStored: 17, rawDataDropped: 2,
      },
    }],
  },
  getEconomySnapshot: () => ({ snapshot: publishedEconomy }),
};

const model = buildControlRoomModel(game);
assert.equal(model.status, 'FACILITY FAULT');
assert.equal(model.beamlines[0].status, 'held');
assert.equal(model.beamlines[0].beamQuality, 0.82);
assert.deepEqual(model.economy, {
  totalIncome: 4321,
  beamIncome: 3000,
  dataFees: 700,
  totalUpkeep: 876,
  net: 3445,
});
assert.deepEqual(model.staff, { total: 3, onTask: 2, idle: 1, attention: 2 });
assert.deepEqual(model.blockers, [{ code: 'power_unconnected', message: 'Power feed is open.' }]);

assert.equal(sparklinePoints([0, 0.5, 1], 100, 40, { min: 0, max: 1 }),
  '0.0,40.0 50.0,20.0 100.0,0.0');
assert.equal(sparklinePoints([], 100, 40), '');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const main = readFileSync(join(root, 'src/main.js'), 'utf8');
const windowSource = readFileSync(join(root, 'src/ui/ControlRoomWindow.js'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');

assert.match(html, /id="btn-control-room"[^>]*>Control Room<\/button>/);
assert.match(main, /ControlRoomWindow\.toggle\(game\)/);
assert.match(windowSource, /Rolling telemetry/);
assert.match(windowSource, /Active alarms/);
assert.match(windowSource, /game\.runUndoableMutation\(\(\) => this\.game\.toggleBeam/);
assert.match(css, /\.ctx-window\[data-ctx-id="control-room"\]/);

console.log('Control Room window contract passed');
