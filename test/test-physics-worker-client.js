import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PhysicsWorkerClient } from '../src/beamline/physics.js';
import { PhysicsRecalcCoordinator } from '../src/beamline/physics-recalc-coordinator.js';

class FakeWorker {
  constructor() { this.messages = []; this.onmessage = null; this.onerror = null; }
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.onmessage?.({ data }); }
}

test('physics client deduplicates equivalent lattices and remaps cavity ids', async () => {
  const worker = new FakeWorker();
  const client = new PhysicsWorkerClient({ workerFactory: () => worker });
  const initializing = client.init();
  worker.emit({ type: 'ready' });
  await initializing;

  const a = [{ id: 'cavity-a', type: 'pillboxCavity', subL: 2, stats: {}, params: {} }];
  const b = [{ id: 'cavity-b', type: 'pillboxCavity', subL: 2, stats: {}, params: {} }];
  const first = client.computeAsync(a, { machineType: 'linac' });
  const second = client.computeAsync(b, { machineType: 'linac' });
  const computeMessages = worker.messages.filter(message => message.type === 'compute');
  assert.equal(computeMessages.length, 1);
  worker.emit({
    type: 'result', requestId: computeMessages[0].requestId,
    result: { beamEnergy: 3, cavities: [{ id: '__beam_node_0', pDissW: 12 }] },
  });
  assert.equal((await first).cavities[0].id, 'cavity-a');
  assert.equal((await second).cavities[0].id, 'cavity-b');
  assert.equal(client.getStats().deduplicated, 1);

  const cached = await client.computeAsync(a, { machineType: 'linac' });
  assert.equal(cached.beamEnergy, 3);
  assert.equal(worker.messages.filter(message => message.type === 'compute').length, 1);
  assert.equal(client.getStats().cacheHits, 1);
});

test('revision coordinator rejects stale results', async () => {
  const resolvers = [];
  const engine = {
    isReady: () => true,
    computeAsync: () => new Promise(resolve => resolvers.push(resolve)),
  };
  const coordinator = new PhysicsRecalcCoordinator(engine);
  const applied = [];
  coordinator.request('bl-1', [1], {}, result => applied.push(result));
  coordinator.request('bl-1', [2], {}, result => applied.push(result));
  resolvers[0]('old');
  await Promise.resolve();
  resolvers[1]('new');
  await Promise.resolve();
  assert.deepEqual(applied, ['new']);
  assert.equal(coordinator.pendingCount(), 0);
});

test('physics client drops superseded queued work in the same lane', async () => {
  const worker = new FakeWorker();
  const client = new PhysicsWorkerClient({ workerFactory: () => worker });
  const initializing = client.init();
  worker.emit({ type: 'ready' });
  await initializing;

  const effects = { machineType: 'linac' };
  const element = value => [{
    id: `cavity-${value}`, type: 'pillboxCavity', subL: value, stats: {}, params: {},
  }];
  const first = client.computeAsync(element(1), effects, { lane: 'beamline-a' });
  const second = client.computeAsync(element(2), effects, { lane: 'beamline-a' });
  const latest = client.computeAsync(element(3), effects, { lane: 'beamline-a' });
  assert.equal(worker.messages.filter(message => message.type === 'compute').length, 1);
  assert.equal(await second, null);

  const firstMessage = worker.messages.find(message => message.type === 'compute');
  worker.emit({ type: 'result', requestId: firstMessage.requestId, result: { beamEnergy: 1 } });
  assert.equal((await first).beamEnergy, 1);
  const computeMessages = worker.messages.filter(message => message.type === 'compute');
  assert.equal(computeMessages.length, 2);
  assert.equal(computeMessages[1].payload[0].subL, 3);
  worker.emit({
    type: 'result', requestId: computeMessages[1].requestId, result: { beamEnergy: 3 },
  });
  assert.equal((await latest).beamEnergy, 3);
  assert.equal(client.getStats().superseded, 1);
  assert.equal(client.getStats().queued, 0);
});
