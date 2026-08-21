// src/ui/ScenarioEditor.js — dev-only in-game Scenario Editor mode.
//
// Entered via ?editor=1 (or the dev-only Menu item). main.js only imports
// this module behind `import.meta.env.DEV`, so none of it ships in the
// production bundle. The editor session:
//   - runs on a fresh blank world, or the existing local default for revision
//   - never writes the active save (game.suppressAutosave)
//   - has sandbox economics + all research unlocked, so nothing is
//     placement-locked while designing
//   - exports the built world as scenario data: a downloadable .json, a
//     ready-to-paste .js generator module (console + clipboard), and a
//     localStorage custom-scenario slot for immediate play-testing.

import { RESEARCH } from '../data/research.js';
import { serializeCornerHeights } from '../game/terrain.js';
import {
  CUSTOM_SCENARIO_ID,
  PENDING_SCENARIO_KEY,
  saveCustomScenario,
} from '../data/scenarios.js';

export class ScenarioEditor {
  constructor(game, existingScenario = null) {
    this.game = game;
    this._lastName = existingScenario?.name || 'Local Balance Sandbox';
  }

  init() {
    const g = this.game;
    g.editorMode = true;
    // Never touch the player's active save from an editor session.
    g.suppressAutosave = true;
    // Free construction WITHOUT persisting the sandbox flag from the editor
    // session. Unlike devMode, this leaves the actual balance moving so the
    // same contract is exercised while authoring and while play-testing.
    g.devMode = false;
    g.sandboxMode = true;
    // No first-run popups while designing.
    g.state.welcomeSeen = true;
    g.state.tutorialDismissed = true;
    // Unlock everything: research gates hide palette items via
    // isComponentUnlocked; completing all research removes every lock.
    g.state.completedResearch = Object.keys(RESEARCH);

    this._mountBadge();
    this._mountToolbar();
    g.log('SCENARIO CONSTRUCTION — free build; operating income and upkeep remain live. Use Save + Playtest to make this the local default.', 'info');
  }

  // === UI ===

  _mountBadge() {
    const title = document.getElementById('game-title');
    const badge = document.createElement('div');
    badge.id = 'editor-badge';
    badge.textContent = 'SCENARIO ADMIN';
    badge.title = 'Scenario Editor — click to exit';
    badge.addEventListener('click', () => this.exit());
    if (title && title.parentNode) title.after(badge);
    else document.body.appendChild(badge);
  }

  _mountToolbar() {
    const bar = document.createElement('div');
    bar.id = 'editor-toolbar';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'editor-toolbar-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    mk('Export', 'Export Scenario — download .json + copy a .js generator module to clipboard/console', () => this.exportScenario());
    mk('Save + Playtest', 'Save as the local New Game default and playtest with free construction plus real operating economics', () => this.playScenario());
    mk('Exit', 'Exit Editor — leave the editor and resume your saved game', () => this.exit());
    // Sit inline in the top bar, right after the EDITOR MODE badge.
    const badge = document.getElementById('editor-badge');
    if (badge) badge.after(bar);
    else document.body.appendChild(bar);
  }

  // === EXPORT ===

  // Serialize the current world into the scenario-data shape that
  // Game.applyScenario consumes. Covered: floors, zones, walls, doors,
  // windows, placeables (furnishings, decorations, equipment, beamline junctions),
  // terrain corner heights, beam pipes (with on-pipe placements), and
  // utility lines. Not covered (regenerated or irrelevant per session):
  // wildlife entities, staff, resources, research, machines (legacy).
  collectScenarioData() {
    const s = this.game.state;
    const strip = (o) => JSON.parse(JSON.stringify(o));
    return {
      floors: strip(s.floors),
      zones: strip(s.zones),
      walls: strip(s.walls),
      doors: strip(s.doors),
      windows: strip(s.windows || []),
      placeables: strip(s.placeables),
      placeableNextId: s.placeableNextId,
      cornerHeights: serializeCornerHeights(s.cornerHeights),
      beamPipes: strip(s.beamPipes || []),
      beamPipeNextId: s.beamPipeNextId || 1,
      placementNextId: s.placementNextId || 0,
      utilityLines: strip(Array.from((s.utilityLines || new Map()).entries())),
      utilityNextId: s.utilityNextId || 1,
      infraBlockers: [],
    };
  }

  _promptMeta() {
    const name = prompt('Scenario name:', this._lastName);
    if (!name) return null;
    this._lastName = name;
    // Derive a camelCase id from the name: "My Cool Lab" -> "myCoolLab"
    const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/);
    let id = words.map((w, i) => {
      const lw = w.toLowerCase();
      return i === 0 ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
    }).join('');
    if (!id || /^[0-9]/.test(id)) id = 'custom' + (id || 'Scenario');
    return { id, name };
  }

  exportScenario() {
    const meta = this._promptMeta();
    if (!meta) return;
    const data = this.collectScenarioData();
    const payload = { id: meta.id, name: meta.name, data };

    // 1) Download as .json
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.id}.scenario.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // 2) Ready-to-paste generator module (matches src/data/scenarios/*.js style)
    const js = this._buildGeneratorModule(meta, data);
    console.log(`[ScenarioEditor] Generator module for src/data/scenarios/${meta.id}.js:\n\n${js}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(js)
        .then(() => this.game.log('Exported: .json downloaded, .js module copied to clipboard (also in console).', 'good'))
        .catch(() => this.game.log('Exported: .json downloaded, .js module logged to console (clipboard unavailable).', 'good'));
    } else {
      this.game.log('Exported: .json downloaded, .js module logged to console.', 'good');
    }
    return payload;
  }

  _buildGeneratorModule(meta, data) {
    const pascal = meta.id.charAt(0).toUpperCase() + meta.id.slice(1);
    const body = JSON.stringify(data, null, 2).replace(/\n/g, '\n  ');
    return [
      `// ${meta.name} — generated by the in-game Scenario Editor (${new Date().toISOString().slice(0, 10)})`,
      `// Register in src/data/scenarios.js:`,
      `//   import { generate${pascal} } from './scenarios/${meta.id}.js';`,
      `//   { id: '${meta.id}', name: '${meta.name.replace(/'/g, "\\'")}', desc: '...', difficulty: 'Custom', generator: generate${pascal} },`,
      `export function generate${pascal}() {`,
      `  return ${body};`,
      `}`,
      ``,
    ].join('\n');
  }

  // === PLAY-TEST LOOP ===

  playScenario() {
    const meta = this._promptMeta();
    if (!meta) return;
    if (!confirm(`Save "${meta.name}" as the local default and start a sandbox playtest now?\n\nConstruction stays free, while income and recurring operating costs remain real.`)) return;
    const data = this.collectScenarioData();
    try {
      saveCustomScenario({ ...meta, data, sandbox: true });
    } catch (e) {
      alert('Could not store the scenario in localStorage (quota?): ' + e.message);
      return;
    }
    localStorage.removeItem('beamlineTycoon');
    localStorage.setItem(PENDING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
    sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    // Reload WITHOUT the editor flag → sandbox construction with the real
    // tick economy (the stored scenario carries sandbox: true).
    location.href = location.pathname;
  }

  // === EXIT ===

  exit() {
    if (!confirm('Exit the Scenario Editor?\n\nUnexported changes will be lost. Your previous game resumes untouched.')) return;
    location.href = location.pathname;
  }
}
