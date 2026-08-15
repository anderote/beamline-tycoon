// Dedicated Pyodide owner. Python/WASM execution never reaches the render
// thread; requests are serialized here so one runtime is sufficient.

import { PY_PHYSICS_MODULES } from './physics-modules.js';
import { PHYSICS_MESSAGE } from './physics-protocol.js';

const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/';
let pyodide = null;
let initPromise = null;

async function initialize(baseUrl) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const moduleUrl = `${PYODIDE_INDEX}pyodide.mjs`;
    const { loadPyodide } = await import(/* @vite-ignore */ moduleUrl);
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
    await pyodide.loadPackage('numpy');
    pyodide.runPython(`
import os
os.makedirs('beam_physics', exist_ok=True)
os.makedirs('beam_physics/modules', exist_ok=True)
with open('beam_physics/__init__.py', 'w') as f:
    f.write('')
    `);
    for (const path of PY_PHYSICS_MODULES) {
      const response = await fetch(new URL(path, baseUrl));
      if (!response.ok) throw new Error(`Physics module ${path}: HTTP ${response.status}`);
      pyodide.FS.writeFile(path, await response.text());
    }
    pyodide.runPython('from beam_physics.gameplay import compute_beam_for_game');
  })();
  return initPromise;
}

function compute(payload, effects) {
  pyodide.globals.set('beamline_json', JSON.stringify(payload));
  pyodide.globals.set('effects_json', JSON.stringify(effects || {}));
  return JSON.parse(pyodide.runPython(
    'compute_beam_for_game(beamline_json, effects_json)',
  ));
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === PHYSICS_MESSAGE.INIT) {
    try {
      await initialize(message.baseUrl);
      self.postMessage({ type: PHYSICS_MESSAGE.READY });
    } catch (error) {
      self.postMessage({
        type: PHYSICS_MESSAGE.INIT_ERROR, error: String(error?.stack || error),
      });
    }
    return;
  }
  if (message.type !== PHYSICS_MESSAGE.COMPUTE) return;
  try {
    await initialize(message.baseUrl);
    const result = compute(message.payload, message.effects);
    self.postMessage({ type: PHYSICS_MESSAGE.RESULT, requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({
      type: PHYSICS_MESSAGE.RESULT, requestId: message.requestId,
      error: String(error?.stack || error),
    });
  }
};
