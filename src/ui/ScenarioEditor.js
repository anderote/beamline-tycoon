// src/ui/ScenarioEditor.js — dev-only in-game Scenario Editor mode.
//
// Entered via ?editor=<local-id> to revise a scenario or ?editor=new for a
// blank project. main.js only imports this module behind `import.meta.env.DEV`,
// so none of it ships in the production bundle. The editor session:
//   - runs on a fresh blank world, or an existing local scenario for revision
//   - never writes the active save (game.suppressAutosave)
//   - has sandbox economics + all research unlocked, so nothing is
//     placement-locked while designing
//   - exports the built world as scenario data: a downloadable .json, a
//     ready-to-paste .js generator module (console + clipboard), and a
//     localStorage scenario catalogue for immediate play-testing.

import { RESEARCH } from '../data/research.js';
import { serializeCornerHeights } from '../game/terrain.js';
import {
  customScenarioRef,
  listCustomScenarios,
  saveCustomScenario,
  stageScenarioSelection,
} from '../data/scenarios.js';

export function scenarioIdFromName(name) {
  const words = String(name || '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let id = words.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
  if (!id || /^[0-9]/.test(id)) id = 'custom' + (id || 'Scenario');
  return id;
}

export function uniqueScenarioId(name, existingIds = []) {
  const base = scenarioIdFromName(name);
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

export class ScenarioEditor {
  constructor(game, existingScenario = null, {
    fresh = false,
    storage = globalThis.localStorage,
  } = {}) {
    this.game = game;
    this.storage = storage;
    this._lastName = fresh
      ? 'Untitled Scenario'
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
    g.log('SCENARIO CONSTRUCTION — free build; operating income and upkeep remain live. Save As publishes a playable New Game scenario.', 'info');
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
    mk('Save', 'Update this playable scenario and keep editing', () => this.saveDesign());
    mk('Save As', 'Overwrite a selected local scenario or create a new playable scenario', () => this.openSaveAsDialog());
    mk('Export', 'Export Scenario — download .json + copy a .js generator module to clipboard/console', () => this.exportScenario());
    mk('Save + Playtest', 'Save this scenario and playtest with free construction plus real operating economics', () => this.playScenario());
    mk('Exit', 'Exit Editor — saved scenarios remain available from New Game', () => this.exit());
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
      wallOverlays: strip(s.wallOverlays || []),
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

  _promptExportMeta() {
    const name = prompt('Scenario name:', this._lastName);
    if (!name) return null;
    return { id: scenarioIdFromName(name), name };
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
      if (badge) badge.textContent = 'SCENARIO ADMIN · SAVED';
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
      : null);
    if (!selectedMeta) {
      this.openSaveAsDialog();
      return null;
    }
    this._lastName = selectedMeta.name;
    const stored = this._save(selectedMeta);
    if (stored) {
      this.game.log(`Saved "${stored.name}". It is playable from New Game.`, 'good');
    }
    return stored;
  }

  /** Save under an explicit identity; used by the dialog and headless tests. */
  saveAs(meta) {
    if (!meta?.id || !meta?.name) return null;
    const stored = this._save(meta);
    if (stored) this.game.log(`Saved "${stored.name}" as a playable New Game scenario.`, 'good');
    return stored;
  }

  openSaveAsDialog({ playAfterSave = false } = {}) {
    const doc = globalThis.document;
    if (!doc) return null;
    doc.getElementById('scenario-save-as-dialog')?.remove();

    const scenarios = listCustomScenarios(this.storage);
    const overlay = doc.createElement('div');
    overlay.id = 'scenario-save-as-dialog';
    overlay.className = 'ui-modal-backdrop';
    const panel = doc.createElement('form');
    panel.className = 'scenario-panel scenario-save-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'scenario-save-as-title');

    let html = '<div class="scenario-header"><h2 class="scenario-title" id="scenario-save-as-title">Save Scenario As</h2></div>';
    html += '<div class="scenario-body scenario-save-body">';
    html += '<label class="scenario-save-label" for="scenario-save-target">Destination</label>';
    html += '<select class="scenario-save-control" id="scenario-save-target">';
    html += '<option value="">Create a new playable scenario</option>';
    for (const scenario of scenarios) {
      html += `<option value="${this._escapeAttribute(scenario.id)}">Overwrite: ${this._escapeText(scenario.name)}</option>`;
    }
    html += '</select>';
    html += '<label class="scenario-save-label" for="scenario-save-name">Scenario name</label>';
    html += `<input class="scenario-save-control" id="scenario-save-name" maxlength="80" required value="${this._escapeAttribute(this._hasSavedDesign ? `${this._lastName} Copy` : this._lastName)}">`;
    html += '<p class="scenario-save-help">Saved scenarios appear immediately in the New Game picker. Choosing an existing destination replaces its starting layout.</p>';
    html += '</div>';
    html += '<div class="scenario-footer scenario-save-footer"><button type="button" class="ui-button" data-save-as-cancel>Cancel</button><button type="submit" class="ui-button">Save As</button></div>';
    panel.innerHTML = html;
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);

    const target = panel.querySelector('#scenario-save-target');
    const nameInput = panel.querySelector('#scenario-save-name');
    target.addEventListener('change', () => {
      const selected = scenarios.find(scenario => scenario.id === target.value);
      nameInput.value = selected?.name || (this._hasSavedDesign ? `${this._lastName} Copy` : this._lastName);
      nameInput.focus();
      nameInput.select();
    });
    panel.querySelector('[data-save-as-cancel]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    panel.addEventListener('submit', event => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const destination = target.value;
      const id = destination || uniqueScenarioId(name, scenarios.map(scenario => scenario.id));
      const replacing = scenarios.find(scenario => scenario.id === destination);
      if (replacing && !confirm(`Replace “${replacing.name}” with the current starting situation?`)) return;
      if (playAfterSave && !confirm(`Save “${name}” and start a sandbox playtest now?\n\nConstruction stays free, while income and recurring operating costs remain real.`)) return;
      const stored = this.saveAs({ id, name });
      if (!stored) return;
      overlay.remove();
      if (playAfterSave) this._launchPlaytest(stored);
    });
    nameInput.focus();
    nameInput.select();
    return overlay;
  }

  _escapeText(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  _escapeAttribute(value) {
    return this._escapeText(value);
  }

  exportScenario() {
    const meta = this._promptExportMeta();
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
    if (!this._hasSavedDesign || !this._lastId) {
      this.openSaveAsDialog({ playAfterSave: true });
      return;
    }
    if (!confirm(`Save “${this._lastName}” and start a sandbox playtest now?\n\nConstruction stays free, while income and recurring operating costs remain real.`)) return;
    const stored = this.saveDesign();
    if (stored) this._launchPlaytest(stored);
  }

  _launchPlaytest(stored) {
    this.storage.removeItem('beamlineTycoon');
    stageScenarioSelection(customScenarioRef(stored.id), this.storage);
    sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    // Reload WITHOUT the editor flag → sandbox construction with the real
    // tick economy (the stored scenario carries sandbox: true).
    location.href = location.pathname;
  }

  // === EXIT ===

  exit() {
    const message = this.hasUnsavedChanges()
      ? 'Exit the Scenario Editor?\n\nUnsaved changes will be lost. Use Save or Save As if you want to keep this version.'
      : 'Exit the Scenario Editor and resume your previous game?\n\nYour saved scenario will remain available under New Game.';
    if (!confirm(message)) return;
    location.href = location.pathname;
  }
}
