// === BEAM PHYSICS: Pyodide Integration ===
// Loads Python beam physics module client-side via Pyodide + numpy
// Note: loadPyodide is a CDN global — not imported

import { COMPONENTS } from '../data/components.js';

export const BeamPhysics = (() => {
  let pyodide = null;
  let ready = false;
  let loading = false;

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
    'beam_physics/modules/bunch_compression.py',
    'beam_physics/modules/collimation.py',
    'beam_physics/modules/aperture_loss.py',
    'beam_physics/modules/fel_gain.py',
    'beam_physics/modules/beam_beam.py',
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

      // Load numpy and scipy
      await pyodide.loadPackage(['numpy', 'scipy']);

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
      return JSON.parse(resultJson);
    } catch (err) {
      console.error('BeamPhysics compute error:', err);
      return null;
    }
  }

  function isReady() {
    return ready;
  }

  return { init, compute, isReady };
})();
