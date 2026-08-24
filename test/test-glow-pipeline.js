import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { GlowPipeline } from '../src/renderer3d/glow-pipeline.js';

function createPipeline(softGlow = true) {
  const renderer = { backend: { isWebGPUBackend: true } };
  return new GlowPipeline(renderer, new Scene(), new PerspectiveCamera(), {
    quality: { softGlow },
  });
}

test('quality changes switch between stable glow graphs and invalidate the pipeline', () => {
  const pipeline = createPipeline(true);
  const highGraph = pipeline._pipeline.outputNode;

  pipeline._pipeline.needsUpdate = false;
  pipeline.setQuality({ softGlow: false });
  const lowGraph = pipeline._pipeline.outputNode;
  assert.notEqual(lowGraph, highGraph,
    'low quality removes the soft bloom node from the scheduled graph');
  assert.equal(pipeline._pipeline.needsUpdate, true,
    'changing graph shape tells RenderPipeline to rebuild');

  pipeline._pipeline.needsUpdate = false;
  pipeline.setQuality({ softGlow: false });
  assert.equal(pipeline._pipeline.outputNode, lowGraph,
    'reapplying low quality reuses the pre-created graph');
  assert.equal(pipeline._pipeline.needsUpdate, false,
    'an unchanged graph does not trigger another rebuild');

  pipeline.setQuality({ softGlow: true });
  assert.equal(pipeline._pipeline.outputNode, highGraph,
    'returning to high quality reuses the original graph');
  assert.equal(pipeline._pipeline.needsUpdate, true);

  pipeline.dispose();
});

test('disposing glow releases both scene passes and every post-process owner', () => {
  const pipeline = createPipeline(true);
  const owners = [
    '_scenePass',
    '_glowScenePass',
    '_bloomPass',
    '_softGlowPass',
    '_aoPass',
    '_pipeline',
  ];
  const disposeCounts = new Map();

  for (const owner of owners) {
    const resource = pipeline[owner];
    assert.ok(resource, `${owner} exists on the native WebGPU path`);
    const originalDispose = resource.dispose.bind(resource);
    resource.dispose = () => {
      disposeCounts.set(owner, (disposeCounts.get(owner) || 0) + 1);
      originalDispose();
    };
  }

  pipeline.dispose();
  for (const owner of owners) {
    assert.equal(disposeCounts.get(owner), 1, `${owner} is disposed exactly once`);
  }
});
