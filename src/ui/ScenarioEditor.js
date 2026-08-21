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
  normalizeScenarioExport,
  parseScenarioExport,
  saveCustomScenario,
  stageScenarioSelection,
} from '../data/scenarios.js';
import { SKIP_TITLE_SESSION_KEY } from './main-menu-navigation.js';
import { evictOldestAutosave } from '../game/SaveSlots.js';
import {
  downloadTextFile,
  isQuotaError,
  runWithQuotaRecovery,
  setItemWithRecovery,
} from '../game/storageQuota.js';

// Crash/quota recovery for in-progress editor work. Deliberately NOT under
// CUSTOM_SCENARIO_PREFIX: a periodic draft must never overwrite a scenario the
// author published on purpose, and must never appear in the New Game picker.
export const SCENARIO_RECOVERY_KEY = 'beamlineTycoon.scenarioEditorRecovery';
// A single key, rewritten in place, so the recovery copy costs one scenario's
// worth of storage no matter how long the session runs.
export const SCENARIO_AUTOSAVE_INTERVAL = 60 * 1000;

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
    // Recovery-draft bookkeeping.
    this._autosaveTimer = null;
    this._beforeUnload = null;
    this._lastDraftSnapshot = null;
    this._draftFailureReported = false;
    this._leaving = false;
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
    this.offerRecoveryRestore();
    this.startDraftAutosave();
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
    mk('Load', 'Load an exported .scenario.json file as unsaved editor work', () => this.chooseScenarioFile());
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
    // A display name is not an identity. In particular, exporting a saved
    // `majorLab2` named "Major Lab" must remain `majorLab2` so the file can be
    // loaded without unexpectedly targeting a different catalogue entry.
    const id = this._lastId && name.trim() === this._lastName.trim()
      ? this._lastId
      : scenarioIdFromName(name);
    return { id, name: name.trim() };
  }

  _currentSnapshot() {
    return JSON.stringify(this.collectScenarioData());
  }

  hasUnsavedChanges() {
    return this._savedSnapshot !== this._currentSnapshot();
  }

  // === IMPORT ===

  /** Open the native file chooser for a Scenario Admin export or backup. */
  chooseScenarioFile() {
    const doc = globalThis.document;
    if (!doc?.body) return null;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      try {
        if (file) await this.loadScenarioFile(file);
      } finally {
        input.remove();
      }
    }, { once: true });
    doc.body.appendChild(input);
    input.click();
    return input;
  }

  /** Read, validate, and load a browser File selected by the author. */
  async loadScenarioFile(file) {
    const filename = file?.name || 'selected file';
    if (!file || typeof file.text !== 'function') {
      this.game.log?.(`LOAD FAILED — ${filename} could not be read.`, 'bad');
      return null;
    }
    let payload;
    try {
      payload = parseScenarioExport(await file.text());
    } catch (error) {
      this.game.log?.(`LOAD FAILED — ${error.message}`, 'bad');
      return null;
    }
    return this.loadScenarioPayload(payload, { sourceName: filename });
  }

  /**
   * Replace the editor world with a validated export as UNSAVED work. The
   * imported id is retained as an export hint, but Save deliberately routes
   * through Save As so a file never overwrites a local scenario by surprise.
   */
  loadScenarioPayload(payload, {
    sourceName = 'scenario file',
    confirmReplace = message => globalThis.confirm?.(message) !== false,
  } = {}) {
    let imported;
    try { imported = normalizeScenarioExport(payload); }
    catch (error) {
      this.game.log?.(`LOAD FAILED — ${error.message}`, 'bad');
      return null;
    }
    if (typeof this.game.applyScenario !== 'function') {
      this.game.log?.('LOAD FAILED — the editor cannot apply scenario data.', 'bad');
      return null;
    }

    const previous = this.collectScenarioData();
    const worldFields = ['floors', 'zones', 'walls', 'doors', 'windows', 'placeables', 'beamPipes', 'utilityLines'];
    const currentHasContent = worldFields.some(field => previous[field]?.length)
      || previous.cornerHeights?.length;
    if (currentHasContent && !confirmReplace(
      `Load “${imported.name}” from ${sourceName}?\n\nThis replaces the current editor workspace. Any scenario you previously saved remains in New Game.`,
    )) return null;

    try {
      this.game.applyScenario(imported.data);
    } catch (error) {
      // Game.applyScenario touches several indexes. Restore the complete prior
      // editor snapshot if any later rebuild rejects the imported data.
      try { this.game.applyScenario(previous); } catch (_) {}
      this.game.log?.(`LOAD FAILED — ${error.message || 'the scenario could not be applied'}`, 'bad');
      return null;
    }

    this._lastId = imported.id;
    this._lastName = imported.name;
    this._hasSavedDesign = false;
    this._savedSnapshot = null;
    this._lastDraftSnapshot = null;
    // Bank the imported workspace immediately; a crash before the one-minute
    // timer must not make the author repeat the import and subsequent edits.
    this.autosaveDraft({ force: true });
    const badge = globalThis.document?.getElementById('editor-badge');
    if (badge) badge.textContent = 'SCENARIO ADMIN · IMPORTED';
    this.game.log?.(`Loaded “${imported.name}” from ${sourceName} as unsaved work. Use Save As to publish it.`, 'good');
    return imported;
  }

  _save(meta) {
    const data = this.collectScenarioData();
    // A full quota is recoverable: recovery autosaves of the *played* game are
    // expendable next to an authored scenario, so evict the oldest and retry.
    // Named save slots, the active save, and other scenarios are never touched.
    const result = runWithQuotaRecovery(
      () => saveCustomScenario({ ...meta, data, sandbox: true }, { storage: this.storage }),
      { reclaim: () => evictOldestAutosave({ storage: this.storage }) },
    );
    if (!result.ok) {
      // The scenario key is unwritable, but the recovery key may still take
      // the work: overwriting a value reuses the space it already occupies,
      // which a new or growing key cannot do. Quietly, because the save
      // failure below is the message that matters.
      this.autosaveDraft({ force: true, quiet: true });
      this._reportSaveFailure(result.error, meta, data);
      return null;
    }
    const stored = result.value;
    this._hasSavedDesign = true;
    this._lastId = stored.id;
    this._lastName = stored.name;
    this._savedSnapshot = JSON.stringify(data);
    this._draftFailureReported = false;
    // A deliberate save supersedes the crash copy; keeping it would offer a
    // stale restore on the next boot.
    this.clearRecoveryDraft();
    const badge = globalThis.document?.getElementById('editor-badge');
    if (badge) badge.textContent = 'SCENARIO ADMIN · SAVED';
    return stored;
  }

  /**
   * The scenario could not be persisted. Never leave the author with nothing:
   * say what to do, and hand them the world as a file (a Blob object URL needs
   * no storage at all). The periodic recovery draft is deliberately left in
   * place so the next editor boot can still offer it.
   */
  _reportSaveFailure(error, meta, data) {
    const quota = isQuotaError(error);
    const payload = JSON.stringify({ id: meta.id, name: meta.name, data }, null, 2);
    const downloaded = downloadTextFile(`${meta.id}.scenario-backup.json`, payload);
    if (!downloaded) console.error('[ScenarioEditor] Scenario backup payload:', payload);
    const advice = downloaded
      ? 'A .json backup was downloaded — keep it.'
      : 'The full scenario JSON was logged to the console — copy it out.';
    this.game.log?.(quota
      ? `SAVE FAILED — browser storage is full. ${advice} Delete old saves from LOAD to free space, then press Save again.`
      : `SAVE FAILED — ${error?.message || 'storage is unavailable'}. ${advice}`, 'bad');
  }

  // === RECOVERY DRAFT (crash / quota insurance) ===

  /**
   * Persist the working scenario under the recovery key when it differs from
   * the last saved scenario. One key, rewritten in place: the draft cannot
   * grow without bound and so cannot cause the quota problem it guards against.
   * Returns the stored draft, or null when nothing needed writing.
   */
  autosaveDraft({ force = false, quiet = false } = {}) {
    if (!this.storage) return null;
    // One serialization per autosave: the world can be half a megabyte, and
    // this runs on a timer, so dirty-checking reuses the same snapshot rather
    // than calling hasUnsavedChanges() (which would serialize a second time).
    const snapshot = this._currentSnapshot();
    if (!force && snapshot === this._savedSnapshot) return null;
    if (!force && snapshot === this._lastDraftSnapshot) return null;
    const savedAt = Date.now();
    // Assembled textually so the (potentially half-megabyte) world is
    // serialized once per autosave rather than twice.
    const payload = `{"id":${JSON.stringify(this._lastId ?? null)},`
      + `"name":${JSON.stringify(this._lastName || 'Untitled Scenario')},`
      + `"savedAt":${savedAt},"data":${snapshot}}`;
    const result = setItemWithRecovery(SCENARIO_RECOVERY_KEY, payload, {
      storage: this.storage,
      reclaim: () => evictOldestAutosave({ storage: this.storage }),
    });
    if (!result.ok) {
      // Do NOT drop the previous draft: a stale recovery copy beats none.
      if (!quiet && !this._draftFailureReported) {
        this._draftFailureReported = true;
        this.game.log?.(isQuotaError(result.error)
          ? 'SCENARIO AUTOSAVE FAILED — browser storage is full. Use Export to download this scenario before it is lost.'
          : 'SCENARIO AUTOSAVE FAILED — local storage is unavailable. Use Export to download this scenario.', 'bad');
      }
      return null;
    }
    this._lastDraftSnapshot = snapshot;
    this._draftFailureReported = false;
    return { id: this._lastId ?? null, name: this._lastName, savedAt, data: JSON.parse(snapshot) };
  }

  /** The stored recovery draft, or null when there is none / it is unusable. */
  readRecoveryDraft() {
    try {
      const raw = this.storage?.getItem(SCENARIO_RECOVERY_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      return draft?.data ? draft : null;
    } catch (_) { return null; }
  }

  clearRecoveryDraft() {
    try { this.storage?.removeItem(SCENARIO_RECOVERY_KEY); } catch (_) {}
    this._lastDraftSnapshot = null;
  }

  /** Load a recovery draft into the live editor world as UNSAVED work. */
  restoreRecoveryDraft(draft = this.readRecoveryDraft()) {
    if (!draft?.data) return false;
    // applyScenario is the only supported way into the world; a blind
    // Object.assign would drop the Map-backed state the editor depends on and
    // silently corrupt the very work being recovered.
    if (typeof this.game.applyScenario !== 'function') {
      this.game.log?.('Could not restore the recovery draft — the world could not accept it. It is still stored; use Export after reloading.', 'bad');
      return false;
    }
    this.game.applyScenario(draft.data);
    if (draft.id) this._lastId = draft.id;
    if (draft.name) this._lastName = draft.name;
    // The restored world is explicitly dirty — it was never saved — but it
    // already matches the stored draft, so the next timer tick has nothing to
    // rewrite. `_savedSnapshot` is deliberately left alone.
    this._lastDraftSnapshot = this._currentSnapshot();
    this.game.log?.(`Restored unsaved scenario work from ${this._formatDraftTime(draft.savedAt)}. Press Save to publish it.`, 'good');
    return true;
  }

  /** Boot-time prompt: restore the draft, or discard it and keep the stored scenario. */
  offerRecoveryRestore() {
    const draft = this.readRecoveryDraft();
    if (!draft) return false;
    // Identical to what is already loaded — nothing to recover.
    if (JSON.stringify(draft.data) === this._currentSnapshot()) {
      this.clearRecoveryDraft();
      return false;
    }
    const message = `Unsaved Scenario Admin work from ${this._formatDraftTime(draft.savedAt)} was recovered`
      + `${draft.name ? ` ("${draft.name}")` : ''}.\n\nRestore it?\n\nCancel keeps the stored scenario and discards the recovery copy.`;
    // Called through globalThis, not via a detached reference: browsers reject
    // an unbound window.confirm with "Illegal invocation".
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(message)) {
      this.clearRecoveryDraft();
      return false;
    }
    return this.restoreRecoveryDraft(draft);
  }

  _formatDraftTime(savedAt) {
    if (!savedAt) return 'an earlier session';
    try { return new Date(savedAt).toLocaleString(); }
    catch (_) { return 'an earlier session'; }
  }

  startDraftAutosave() {
    const win = globalThis.window;
    if (win?.addEventListener && !this._beforeUnload) {
      this._beforeUnload = (event) => {
        if (this._leaving || !this.hasUnsavedChanges()) return;
        // Last chance to bank the work before the tab goes away.
        this.autosaveDraft({ force: true });
        event.preventDefault();
        event.returnValue = '';
        return '';
      };
      win.addEventListener('beforeunload', this._beforeUnload);
    }
    if (this._autosaveTimer == null && typeof setInterval === 'function') {
      this._autosaveTimer = setInterval(() => this.autosaveDraft(), SCENARIO_AUTOSAVE_INTERVAL);
      this._autosaveTimer?.unref?.();
    }
    return this._autosaveTimer;
  }

  stopDraftAutosave() {
    if (this._autosaveTimer != null) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    const win = globalThis.window;
    if (this._beforeUnload && win?.removeEventListener) {
      win.removeEventListener('beforeunload', this._beforeUnload);
    }
    this._beforeUnload = null;
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

    // 1) Download as .json through the same guarded path used for emergency
    // backups. Export must report a browser failure instead of claiming that a
    // file exists when no download was actually started.
    const downloaded = downloadTextFile(
      `${meta.id}.scenario.json`,
      JSON.stringify(payload, null, 2),
    );

    // 2) Ready-to-paste generator module (matches src/data/scenarios/*.js style)
    const js = this._buildGeneratorModule(meta, data);
    console.log(`[ScenarioEditor] Generator module for src/data/scenarios/${meta.id}.js:\n\n${js}`);
    const downloadStatus = downloaded
      ? 'Exported: .json downloaded'
      : 'EXPORT WARNING — the .json download could not be started';
    if (globalThis.navigator?.clipboard?.writeText) {
      globalThis.navigator.clipboard.writeText(js)
        .then(() => this.game.log(`${downloadStatus}, .js module copied to clipboard (also in console).`, downloaded ? 'good' : 'bad'))
        .catch(() => this.game.log(`${downloadStatus}, .js module logged to console (clipboard unavailable).`, downloaded ? 'good' : 'bad'));
    } else {
      this.game.log(`${downloadStatus}, .js module logged to console.`, downloaded ? 'good' : 'bad');
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
    this._leaving = true;
    this.stopDraftAutosave();
    // Stage and verify before removing the active game. A failed localStorage
    // write must leave the author in the editor with the prior game intact.
    try {
      const staged = stageScenarioSelection(customScenarioRef(stored.id), this.storage);
      if (!staged) throw new Error('The saved scenario is unavailable');
      sessionStorage.setItem(SKIP_TITLE_SESSION_KEY, '1');
      this.storage.removeItem('beamlineTycoon');
    } catch (error) {
      try { stageScenarioSelection('sandbox', this.storage); } catch (_) {}
      try { sessionStorage.removeItem(SKIP_TITLE_SESSION_KEY); } catch (_) {}
      this._leaving = false;
      this.startDraftAutosave();
      this.game.log?.(`PLAYTEST FAILED — ${error.message || 'the saved scenario could not be staged'}.`, 'bad');
      return false;
    }
    // Reload WITHOUT the editor flag → sandbox construction with the real
    // tick economy (the stored scenario carries sandbox: true).
    location.href = location.pathname;
    return true;
  }

  // === EXIT ===

  exit() {
    const dirty = this.hasUnsavedChanges();
    // Bank the work first: if the author leaves anyway, the next editor boot
    // offers it back instead of losing the session.
    if (dirty) this.autosaveDraft({ force: true });
    const message = dirty
      ? 'Exit the Scenario Editor?\n\nThese changes are NOT published to New Game. They are kept as a recovery draft and offered the next time you open Scenario Admin — use Save or Save As to publish them properly.'
      : 'Exit the Scenario Editor and resume your previous game?\n\nYour saved scenario will remain available under New Game.';
    if (!confirm(message)) return;
    this._leaving = true;
    this.stopDraftAutosave();
    location.href = location.pathname;
  }
}
