import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FramePacer } from '../src/renderer3d/frame-pacer.js';

/** A device queue whose completions are resolved by hand. */
function stubQueue() {
  const pending = [];
  return {
    pending,
    onSubmittedWorkDone() {
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    settleAll() {
      const batch = pending.splice(0, pending.length);
      for (const p of batch) p.resolve();
      return Promise.resolve();
    },
    failAll() {
      const batch = pending.splice(0, pending.length);
      for (const p of batch) p.reject(new Error('device lost'));
      return Promise.resolve();
    },
  };
}

const webgpu = (queue) => ({ backend: { isWebGPUBackend: true, device: { queue } } });

test('the WebGL2 fallback is never paced', () => {
  // three's WebGPURenderer silently falls back to a WebGL2 backend with no
  // device queue. Pacing there would drop frames for no signal at all.
  for (const renderer of [
    {},
    { backend: {} },
    { backend: { isWebGPUBackend: false, device: { queue: { onSubmittedWorkDone() {} } } } },
    { backend: { isWebGPUBackend: true, device: {} } },
    { backend: { isWebGPUBackend: true, device: { queue: {} } } },
  ]) {
    const pacer = new FramePacer(renderer);
    assert.equal(pacer.supported, false);
    for (let i = 0; i < 50; i++) {
      assert.equal(pacer.shouldRender(), true, 'unsupported backends always render');
      pacer.frameSubmitted();
    }
    assert.equal(pacer.getStats().framesSkipped, 0);
  }
});

test('frames are skipped once the device is holding more than the limit', async () => {
  const queue = stubQueue();
  const pacer = new FramePacer(webgpu(queue), { maxFramesInFlight: 2 });
  assert.equal(pacer.supported, true);

  assert.equal(pacer.shouldRender(), true);
  pacer.frameSubmitted();
  assert.equal(pacer.shouldRender(), true, 'one frame in flight still pipelines');
  pacer.frameSubmitted();

  assert.equal(pacer.inFlight, 2);
  assert.equal(pacer.shouldRender(), false, 'a third frame would deepen the queue');
  assert.equal(pacer.shouldRender(), false);
  assert.equal(pacer.getStats().framesSkipped, 2);

  await queue.settleAll();
  assert.equal(pacer.inFlight, 0, 'a completion retires every frame submitted before it');
  assert.equal(pacer.shouldRender(), true, 'the loop resumes as soon as the device catches up');
});

test('a completion retires every earlier frame, never fewer', async () => {
  const queue = stubQueue();
  const pacer = new FramePacer(webgpu(queue), { maxFramesInFlight: 4 });
  for (let i = 0; i < 4; i++) pacer.frameSubmitted();
  assert.equal(pacer.inFlight, 4);

  // Settle the LAST probe first: it means everything submitted before it is
  // done too, so in-flight must collapse to zero rather than to three.
  const last = queue.pending.pop();
  last.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pacer.inFlight, 0);

  await queue.settleAll();
  assert.equal(pacer.inFlight, 0, 'a late earlier completion cannot push the count back up');
});

test('the watchdog refuses to let a dead device freeze the world for good', () => {
  // This is the failure this whole module exists to prevent, so the guard
  // against causing it has to be explicit.
  let clock = 0;
  const queue = stubQueue();
  const pacer = new FramePacer(webgpu(queue), {
    maxFramesInFlight: 1,
    watchdogMs: 1000,
    now: () => clock,
  });

  pacer.frameSubmitted();          // never completes
  clock = 500;
  assert.equal(pacer.shouldRender(), false, 'still within the grace period');
  clock = 1500;
  assert.equal(pacer.shouldRender(), true, 'the frame is let through rather than lost');
  assert.equal(pacer.getStats().framePacerWatchdogTrips, 1);
  assert.equal(pacer.inFlight, 0, 'counters resynchronise so the loop keeps running');

  // And it keeps letting frames through forever after, one grace period apart.
  pacer.frameSubmitted();
  clock = 2600;
  assert.equal(pacer.shouldRender(), true);
});

test('a rejected completion still counts as progress', async () => {
  const queue = stubQueue();
  const pacer = new FramePacer(webgpu(queue), { maxFramesInFlight: 1 });
  pacer.frameSubmitted();
  assert.equal(pacer.shouldRender(), false);
  await queue.failAll();
  assert.equal(pacer.inFlight, 0, 'a lost device must not hold the queue closed');
  assert.equal(pacer.shouldRender(), true);
});

test('dispose stops pacing instead of freezing the loop', async () => {
  const queue = stubQueue();
  const pacer = new FramePacer(webgpu(queue), { maxFramesInFlight: 1 });
  pacer.frameSubmitted();
  assert.equal(pacer.shouldRender(), false);
  pacer.dispose();
  assert.equal(pacer.shouldRender(), true);
  await queue.settleAll();
});

test('the in-flight limit is a runtime dial and never drops below one', () => {
  const pacer = new FramePacer(webgpu(stubQueue()));
  pacer.setMaxFramesInFlight(4);
  assert.equal(pacer.maxFramesInFlight, 4);
  pacer.setMaxFramesInFlight(0);
  assert.equal(pacer.maxFramesInFlight, 1, 'zero would stop rendering entirely');
  pacer.setMaxFramesInFlight(-3);
  assert.equal(pacer.maxFramesInFlight, 1);
});
