import assert from 'node:assert/strict';

import { startTitleScenario } from '../src/ui/title-scenario-start.js';

const order = [];
const scenario = { name: 'Test Campus', sandbox: false, rules: {}, generator: () => ({}) };
const game = {
  devMode: false,
  resetForNewSession: () => { order.push('reset'); return true; },
  setSandboxMode: () => order.push('sandbox'),
  setScenarioRules: () => order.push('rules'),
  applyScenario: () => order.push('apply'),
  save: () => order.push('save'),
  log: message => order.push(`log:${message}`),
  start: () => order.push('start'),
};
const renderer = {
  setRenderingSuspended: value => order.push(`suspend:${value}`),
  _generateCategoryTabs: () => order.push('tabs'),
  updatePalette: () => order.push('palette'),
  resetViewForNewSession: () => order.push('camera'),
  refreshForNewSession: () => order.push('refresh'),
};
const input = { selectedCategory: 'source', setActiveMode: () => order.push('mode') };
const router = { navigate: route => order.push(`route:${route}`) };
const resettable = name => ({ resetForNewSession: () => order.push(name) });

assert.equal(startTitleScenario({
  game,
  scenario,
  renderer,
  input,
  router,
  probeWindow: resettable('probe'),
  guidedSetup: resettable('guide'),
  utilityPlantGuide: resettable('plant-guide'),
  titleScreen: { dismiss: () => order.push('dismiss') },
  maybeShowWelcome: () => order.push('welcome'),
}), true);

assert.deepEqual(order, [
  'suspend:true', 'reset', 'sandbox', 'rules', 'apply', 'mode', 'tabs',
  'palette', 'probe', 'guide', 'plant-guide', 'camera', 'route:game',
  'refresh', 'save', 'log:Scenario "Test Campus" loaded.', 'start',
  'dismiss', 'welcome',
]);

console.log('Title scenario start: all assertions passed');
