// Pixel-level regression for the midnight visibility failure: ordinary scene
// materials must remain readable beside emissive utility effects, and the
// selective bloom pass must restore every temporarily darkened material.
import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { bootFreshGame, expectRendererLive } from './helpers.mjs';

function pixelStats(buffer) {
  const png = PNG.sync.read(buffer);
  let count = 0;
  let black = 0;
  let mean = 0;
  let max = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const i = (y * png.width + x) * 4;
      const luma = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      mean += luma;
      max = Math.max(max, luma);
      if (luma < 3) black++;
      count++;
    }
  }
  return { mean: mean / count, max, blackFraction: black / count };
}

test('midnight keeps the world readable with selective glow enabled', async ({ page }) => {
  await bootFreshGame(page, { lightingQuality: 'low' });
  await expectRendererLive(page);
  await page.evaluate(async () => {
    window.game.stop();
    window.game.state.paused = true;
    window.game.state.timeOfDay = 0;
    window._renderer._localTimeOfDay = 0;
    window._renderer._lastSyncedTimeOfDay = 0;
    const r = window._renderer;
    const probe = new window.THREE.Mesh(
      new window.THREE.BoxGeometry(8, 2, 8),
      new window.THREE.MeshStandardMaterial({
        color: 0xb0b0b0,
        roughness: 1,
        metalness: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    // Put the material probe directly on the camera ray and above the world.
    // A fixed y=5 at the camera target can sit inside newer hilly terrain (or
    // behind its trees), making this sample measure the map instead of the box.
    const viewDirection = new window.THREE.Vector3();
    r.camera.getWorldDirection(viewDirection);
    probe.position.copy(r.camera.position).addScaledVector(viewDirection, 10);
    probe.renderOrder = 10_000;
    probe.frustumCulled = false;
    r.scene.add(probe);
    window.__nightLightingProbe = probe;
    if (r._animFrameId !== null) cancelAnimationFrame(r._animFrameId);
    r._animFrameId = null;
    r._updateSunCycle();
    r._updateLightingRamp();
    await r.renderer.compileAsync(r.scene, r.camera);
    r._glowPipeline.render();
  });

  const { clip, probeClip } = await page.evaluate(() => {
    const rect = window._renderer.renderer.domElement.getBoundingClientRect();
    const v = window.__nightLightingProbe.position.clone();
    v.y += 1.01;
    v.project(window._renderer.camera);
    const x = rect.x + (v.x * 0.5 + 0.5) * rect.width;
    const y = rect.y + (-v.y * 0.5 + 0.5) * rect.height;
    return {
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      probeClip: { x: Math.round(x - 12), y: Math.round(y - 12), width: 24, height: 24 },
    };
  });
  const glowOn = pixelStats(await page.screenshot({ clip }));
  const probeOn = pixelStats(await page.screenshot({ clip: probeClip }));
  const materialState = await page.evaluate(() => {
    const r = window._renderer;
    let dark = 0;
    let materialObjects = 0;
    r.scene.traverse((obj) => {
      if (!obj.material) return;
      materialObjects++;
      if (obj.material === r._glowPipeline._darkMaterial) dark++;
    });
    return {
      dark,
      materialObjects,
      ambient: r._ambientLight.intensity,
      sun: r._sunLight.intensity,
      moon: r._moonLight.intensity,
      darkness: r._darkness,
    };
  });

  expect(materialState).toMatchObject({
    dark: 0,
    ambient: 0.48,
    sun: 0,
    moon: 0.52,
    darkness: 1,
  });
  expect(materialState.materialObjects).toBeGreaterThan(0);
  expect(glowOn.mean, 'midnight canvas retains readable world illumination').toBeGreaterThan(29);
  expect(probeOn.mean, 'a neutral material retains readable form at midnight').toBeGreaterThan(50);
  // `dark === 0` is the critical restoration/masking invariant. A second
  // glow-off screenshot deadlocks Chrome's SwiftShader compositor on this
  // scene even after the animation loop is stopped; native-browser coverage
  // exercises the live toggle separately.
});
