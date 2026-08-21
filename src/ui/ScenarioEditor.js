// src/ui/ScenarioEditor.js — dev-only in-game Scenario Editor mode.
//
// Entered via ?editor=1 to resume or ?editor=new for a blank project. main.js only imports
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
  constructor(game, existingScenario = null, {
    fresh = false,
    storage = globalThis.localStorage,
  } = {}) {
    this.game = game;
    this.storage = storage;
    this._lastName = fresh
      ? 'Untitled Default World'
      : existingScenario?.name || 'Local Balance Sandbox';
    this._lastId = fresh ? null : existingScenario?.id || null;
    this._hasSavedDesign = !fresh && !!existingScenario?.data;
    this._savedSnapshot = null;
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
    if (this._hasSavedDesign) this._savedSnapshot = this._currentSnapshot();
    g.log('SCENARIO CONSTRUCTION — free build; operating income and upkeep remain live. Save Design keeps this project available to resume later.', 'info');
  }

  // === UI ===

  _mountBadge() {
    const title = document.getElementById('game-title');
    const badge = document.createElement('div');
    badge.id = 'editor-badge';
    badge.textContent = `SCENARIO ADMIN · ${this._hasSavedDesign ? 'CURRENT' : 'NEW'}`;
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
    mk('Save Design', 'Save this default-world design locally and keep editing', () => this.saveDesign());
    mk('Export', 'Export Scenario — download .json + copy a .js generator module to clipboard/console', () => this.exportScenario());
    mk('Save + Playtest', 'Save as the local New Game default and playtest with free construction plus real operating economics', () => this.playScenario());
    mk('Exit', 'Exit Editor — saved designs can be resumed from Scenarios', () => this.exit());
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
    this._lastId = id;
    return { id, name };
  }

  _currentSnapshot() {
    return JSON.stringify(this.collectScenarioData());
  }

  hasUnsavedChanges() {
    return this._savedSnapshot !== this._currentSnapshot();
  }

  _save(meta) {
    const data = this.collectScenarioData();
    try {
      const stored = saveCustomScenario({ ...meta, data, sandbox: true }, {
        storage: this.storage,
      });
      this._hasSavedDesign = true;
      this._lastId = stored.id;
      this._lastName = stored.name;
      this._savedSnapshot = JSON.stringify(data);
      const badge = globalThis.document?.getElementById('editor-badge');
      if (badge) badge.textContent = 'SCENARIO ADMIN · CURRENT';
      return stored;
    } catch (e) {
      alert('Could not store the scenario in localStorage (quota?): ' + e.message);
      return null;
    }
  }

  /** Save the current design without leaving Scenario Admin. */
  saveDesign(meta = null) {
    const selectedMeta = meta || (this._hasSavedDesign && this._lastId
      ? { id: this._lastId, name: this._lastName }
      : this._promptMeta());
    if (!selectedMeta) return null;
    this._lastName = selectedMeta.name;
    const stored = this._save(selectedMeta);
    if (stored) {
      this.game.log(`Saved "${stored.name}" as the current default-world design. You can keep editing or resume it later from Scenarios.`, 'good');
    }
    return stored;
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
    if (!this._save(meta)) return;
    this.storage.removeItem('beamlineTycoon');
    this.storage.setItem(PENDING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
    sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    // Reload WITHOUT the editor flag → sandbox construction with the real
    // tick economy (the stored scenario carries sandbox: true).
    location.href = location.pathname;
  }

  // === EXIT ===

  exit() {
    const message = this.hasUnsavedChanges()
      ? 'Exit the Scenario Editor?\n\nUnsaved changes will be lost. Use Save Design if you want to resume this version later.'
      : 'Exit the Scenario Editor and resume your previous game?\n\nYour saved default-world design will remain available under Scenarios.';
    if (!confirm(message)) return;
    location.href = location.pathname;
  }
}
