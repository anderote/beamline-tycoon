import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('equipment screens, dials, and indicators reach bloom, animation, and the bounded light pool', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const types = [
    'workstation', 'monitorBank', 'alarmPanel', 'daqRack', 'cncMill',
    'oscilloscope', 'flowMeter', 'areaMonitor', 'rackIoc',
  ];
  const placed = await page.evaluate((machineTypes) => {
    const g = window.game;
    const area = window.__bt.findClearArea(machineTypes.length * 4, 4);
    if (!area) return null;
    return g._batchEvents(() => machineTypes.map((type, index) => g.placePlaceable({
      type,
      col: area.col + index * 4,
      row: area.row,
      subCol: 0,
      subRow: 0,
      dir: 0,
      free: true,
      silent: true,
    })));
  }, types);
  expect(placed, 'the generated map has room for the lighting fixture row').not.toBeNull();
  expect(placed.every(Boolean), 'every test machine placed').toBe(true);
  await frames(page, 4);

  const state = await page.evaluate((ids) => {
    const r = window._renderer;
    const entries = [];
    const wrappers = [
      ...r.equipmentBuilder._meshes,
      ...r.componentBuilder._meshMap.values(),
    ];
    for (const wrapper of wrappers) {
      const placeableId = wrapper.userData.placeableId ?? wrapper.userData.nodeId;
      if (!ids.includes(placeableId)) continue;
      const glows = [];
      wrapper.traverse((mesh) => {
        if (!mesh.isMesh || mesh.userData.role !== 'glow') return;
        glows.push({
          profile: mesh.userData.effectProfile,
          physical: mesh.userData.ambientLight !== false,
          bloom: mesh.layers.isEnabled(1),
          castsShadow: mesh.castShadow,
          emissive: mesh.material?.emissive?.getHex?.() ?? null,
          intensity: mesh.material?.emissiveIntensity ?? 0,
        });
      });
      entries.push({ type: wrapper.userData.placeableType ?? wrapper.userData.compType, glows });
    }
    return {
      entries,
      machineSurfaceRecords: [...r._effectSystem._surfaceEffects.keys()]
        .filter(key => key.startsWith('equipment:') || key.startsWith('components:')).length,
      physicalCandidates: r._lightRig._glowCandidates.filter((mesh) => {
        let node = mesh;
        while (node && node.userData?.physicsId == null && node.userData?.nodeId == null) {
          node = node.parent;
        }
        const placeableId = node?.userData?.placeableId ?? node?.userData?.nodeId;
        return ids.includes(placeableId);
      }).length,
    };
  }, placed);

  expect(state.entries.map(entry => entry.type).sort()).toEqual(types.slice().sort());
  let totalGlows = 0;
  for (const entry of state.entries) {
    expect(entry.glows.length, `${entry.type} publishes emissive details`).toBeGreaterThan(0);
    expect(entry.glows.every(glow => glow.bloom && !glow.castsShadow && glow.emissive != null),
      `${entry.type} glows use bloom-safe emissive meshes`).toBe(true);
    expect(entry.glows.filter(glow => glow.physical).length,
      `${entry.type} nominates one representative real-light source`).toBe(1);
    totalGlows += entry.glows.length;
  }
  expect(state.machineSurfaceRecords,
    'the surface-effect system owns every machine glow independently').toBe(totalGlows);
  expect(state.physicalCandidates,
    'tiny LEDs do not multiply bounded point-light candidates').toBe(types.length);

  await page.evaluate(() => {
    window.game.stop();
    window.game.state.paused = true;
    window.game.state.timeOfDay = 0;
    window._renderer._localTimeOfDay = 0;
    window._renderer._lastSyncedTimeOfDay = 0;
  });
  await frames(page, 4);
  const midnight = await page.evaluate((ids) => {
    const glows = [];
    const renderer = window._renderer;
    const wrappers = [
      ...renderer.equipmentBuilder._meshes,
      ...renderer.componentBuilder._meshMap.values(),
    ];
    for (const wrapper of wrappers) {
      const placeableId = wrapper.userData.placeableId ?? wrapper.userData.nodeId;
      if (!ids.includes(placeableId)) continue;
      wrapper.traverse((mesh) => {
        if (mesh.isMesh && mesh.userData.role === 'glow') {
          glows.push(mesh.material?.emissiveIntensity ?? 0);
        }
      });
    }
    return { darkness: window._renderer._darkness, glows };
  }, placed);
  expect(midnight.darkness).toBe(1);
  expect(midnight.glows.length).toBe(totalGlows);
  expect(midnight.glows.every(intensity => intensity > 0.2),
    'screens and lamps remain live at midnight after per-machine animation').toBe(true);

  errors.checkAll();
});
