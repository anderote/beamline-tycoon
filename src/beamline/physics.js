// === BEAM PHYSICS: Pyodide Integration ===
// Loads Python beam physics module client-side via Pyodide + numpy
// Note: loadPyodide is a CDN global — not imported

import { COMPONENTS } from '../data/components.js';

export const BeamPhysics = (() => {
  let pyodide = null;
  let ready = false;
  let loading = false;
  // Why the last compute() returned null, or null if the last one succeeded.
  // compute() swallows every failure into a bare null, and the only trace was
  // a console.error that a busy console buries — a beamline whose physics
  // raised looked exactly like a beamline with no beam. Callers that render
  // the absence (the designer's plot panels) read this to say WHICH it was.
  let lastError = null;

  // Python source files to load
  const PY_MODULES = [
    'beam_physics/constants.py',
    'beam_physics/beam.py',
    'beam_physics/context.py',
    'beam_physics/modules/__init__.py',
    'beam_physics/modules/base.py',
    'beam_physics/modules/linear_optics.py',
    'beam_physics/modules/rf_acceleration.py',
    'beam_physics/modules/space_charge.py',
    'beam_physics/modules/synchrotron_rad.py',
    'beam_physics/modules/synchrotron_light.py',
    'beam_physics/modules/bunch_compression.py',
    'beam_physics/modules/collimation.py',
    'beam_physics/modules/aperture_loss.py',
    'beam_physics/modules/fel_gain.py',
    'beam_physics/modules/beam_beam.py',
    'beam_physics/modules/beam_gas.py',
    'beam_physics/srf.py',
    'beam_physics/machines.py',
    'beam_physics/lattice.py',
    'beam_physics/elements.py',
    'beam_physics/gameplay.py',
  ];

  async function init() {
    if (ready) return;
    if (loading) {
      // Wait for in-progress load
      while (loading) await new Promise(r => setTimeout(r, 100));
      return;
    }
    loading = true;

    try {
      // Load Pyodide runtime
      pyodide = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/',
      });

      // NumPy provides the small-matrix operations used by the beam model.
      // Scalar special functions use Python's standard library, so pulling in
      // SciPy (and its OpenBLAS dependency) would only add tens of megabytes.
      await pyodide.loadPackage('numpy');

      // Create the beam_physics package in Pyodide's virtual filesystem
      pyodide.runPython(`
import os
os.makedirs('beam_physics', exist_ok=True)
os.makedirs('beam_physics/modules', exist_ok=True)
with open('beam_physics/__init__.py', 'w') as f:
    f.write('')
      `);

      // Fetch and load each module (written straight to the virtual FS —
      // no string interpolation into Python source)
      for (const path of PY_MODULES) {
        const response = await fetch(path);
        const code = await response.text();
        pyodide.FS.writeFile(path, code);
      }

      // Import the entry point
      pyodide.runPython(`
from beam_physics.gameplay import compute_beam_for_game
      `);

      ready = true;
    } catch (err) {
      console.error('BeamPhysics init failed:', err);
      throw err;
    } finally {
      loading = false;
    }
  }

  function compute(gameBeamline, researchEffects) {
    if (!ready) {
      lastError = 'Physics engine still loading';
      console.warn('BeamPhysics not ready');
      return null;
    }

    // Attach each component's declared physics identity from the registry so
    // Python never has to guess how a game type maps onto the engine.
    // gameplay.py raises on a missing/unknown physicsType.
    const payload = gameBeamline.map(el =>
      el.physicsType ? el : { ...el, physicsType: COMPONENTS[el.type]?.physicsType }
    );

    try {
      // Pass JSON via pyodide globals — no quote/backslash escaping games.
      pyodide.globals.set('beamline_json', JSON.stringify(payload));
      pyodide.globals.set('effects_json', JSON.stringify(researchEffects || {}));
      const resultJson = pyodide.runPython(
        'compute_beam_for_game(beamline_json, effects_json)'
      );
      lastError = null;
      return JSON.parse(resultJson);
    } catch (err) {
      // A PythonError's message IS the traceback; its last non-empty line is
      // the exception itself, which is the part worth showing in a UI.
      const full = String((err && err.message) || err);
      lastError = full.trim().split('\n').filter(Boolean).pop() || full;
      console.error('BeamPhysics compute error:', lastError, '\n', full,
        '\nbeamline:', gameBeamline, '\neffects:', researchEffects);
      // TEMPORARY: mirror the traceback and the exact payload to the dev
      // server's /__diag sink (vite.config.js), so a failure that only happens
      // on a live save can be reproduced offline. Remove with the sink.
      if (import.meta.env.DEV) {
        try {
          fetch('/__diag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'physics-compute-error',
              error: full,
              beamline: gameBeamline,
              effects: researchEffects,
            }),
          }).catch(() => {});
        } catch (_) { /* never let diagnostics break the caller */ }
      }
      return null;
    }
  }

  function isReady() {
    return ready;
  }

  /** Why the last compute() returned null; null after a successful one. */
  function getLastError() {
    return lastError;
  }

  return { init, compute, isReady, getLastError };
})();
