// src/ui/ScenarioPicker.js — the single New Game entry point.
//
// The picker owns the choose -> preserve -> stage -> reload transaction so
// title-screen and in-game New Game actions cannot drift apart. Blank play is
// an explicit Sandbox selection, just like every authored starting situation.

import {
  customScenarioRef,
  listPlayableScenarios,
  PENDING_SCENARIO_KEY,
  resolveScenario,
  stageScenarioSelection,
} from '../data/scenarios.js';
import { SKIP_TITLE_SESSION_KEY } from './main-menu-navigation.js';

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class ScenarioPicker {
  constructor(game, {
    storage = globalThis.localStorage,
    sessionStorage = globalThis.sessionStorage,
    document = globalThis.document,
    location = globalThis.location,
    confirm = message => globalThis.confirm(message),
    editorEnabled = import.meta.env.DEV,
    startInPlace = null,
    beforeReload = null,
    scheduleReload = callback => globalThis.setTimeout(callback, 0),
  } = {}) {
    this.game = game;
    this.storage = storage;
    this.sessionStorage = sessionStorage;
    this.document = document;
    this.location = location;
    this.confirm = confirm;
    this.editorEnabled = editorEnabled;
    this.startInPlace = startInPlace;
    this.beforeReload = beforeReload;
    this.scheduleReload = scheduleReload;
  }

  open() {
    const existing = this.document.getElementById('scenario-dialog');
    if (existing) { existing.remove(); return; }

    const scenarios = listPlayableScenarios(this.storage);
    const localScenarios = scenarios.filter(scenario => scenario.local);
    const overlay = this.document.createElement('div');
    overlay.id = 'scenario-dialog';
    overlay.className = 'ui-modal-backdrop';

    const panel = this.document.createElement('div');
    panel.className = 'scenario-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'scenario-dialog-title');

    let html = '<div class="scenario-header"><h2 class="scenario-title" id="scenario-dialog-title">New Game</h2></div>';
    html += '<div class="scenario-body">';
    html += '<p class="scenario-intro">Choose a starting situation. Starting it replaces your current game; use Save Game first if you want to keep it in a named slot.</p>';

    for (const scenario of scenarios) {
      if (scenario.local || scenario.editable) html += '<div class="scenario-card-row">';
      html += `<button type="button" class="scenario-card" data-id="${escapeText(scenario.id)}">`;
      html += '<span class="scenario-card-header">';
      html += `<strong class="scenario-card-name">${escapeText(scenario.name)}</strong>`;
      html += `<span class="scenario-difficulty">${escapeText(scenario.difficulty)}</span>`;
      html += '</span>';
      html += `<span class="scenario-description">${escapeText(scenario.desc)}</span>`;
      html += '</button>';
      if (scenario.local || scenario.editable) {
        if (this.editorEnabled) {
          const editId = scenario.local ? scenario.localId : `builtin:${scenario.id}`;
          html += `<button type="button" class="scenario-edit-action" data-edit-scenario="${escapeText(editId)}" aria-label="Edit ${escapeText(scenario.name)}">Edit</button>`;
        }
        html += '</div>';
      }
    }

    if (this.editorEnabled) {
      html += '<section class="scenario-admin-section" aria-labelledby="scenario-admin-title">';
      html += '<span class="scenario-card-header">';
      html += '<strong class="scenario-card-name" id="scenario-admin-title">Starting Situation Editor</strong>';
      html += '<span class="scenario-difficulty">Admin · Local</span>';
      html += '</span>';
      html += `<p class="scenario-description">${localScenarios.length
        ? 'Use Edit beside your local starter game to keep revising it.'
        : 'Build your starter game with every technology unlocked, then publish it from the editor.'}</p>`;
      html += '<div class="scenario-admin-actions">';
      if (!localScenarios.length) {
        html += '<button type="button" class="scenario-admin-action" data-scenario-action="start-new">';
        html += '<strong>Create Starter Game</strong><span>Open a blank project for the New Game picker.</span>';
        html += '</button>';
      }
      html += '</div>';
      html += '</section>';
    }

    html += '</div>';
    html += '<div class="scenario-footer"><button type="button" data-scenario-cancel class="ui-button">Cancel</button></div>';

    panel.innerHTML = html;
    overlay.appendChild(panel);
    this.document.body.appendChild(overlay);

    panel.addEventListener('click', event => {
      const editId = event.target.closest('[data-edit-scenario]')?.dataset.editScenario;
      if (editId && this.editorEnabled) {
        this._openEditor(editId);
        return;
      }

      const adminAction = event.target.closest('[data-scenario-action]')?.dataset.scenarioAction;
      if (adminAction === 'start-new' && this.editorEnabled) {
        this._openEditor(null);
        return;
      }

      const card = event.target.closest('.scenario-card');
      if (card) this._startScenario(card.dataset.id);
    });

    panel.querySelector('[data-scenario-cancel]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  }

  _openEditor(localId) {
    const builtInId = localId?.startsWith('builtin:') ? localId.slice('builtin:'.length) : null;
    const scenario = builtInId
      ? resolveScenario(builtInId, this.storage)
      : localId ? resolveScenario(customScenarioRef(localId), this.storage) : null;
    const message = scenario
      ? `Edit “${scenario.name}”?\n\nThis replaces your current game. Use Save Game first if you want to keep it.`
      : 'Create a new starting situation?\n\nThis replaces your current game. Use Save Game first if you want to keep it.';
    if (!this.confirm(message)) return;
    this.game.save();
    const editorTarget = builtInId
      ? `builtin:${encodeURIComponent(builtInId)}`
      : localId ? encodeURIComponent(localId) : 'new';
    this.location.href = `${this.location.pathname}?editor=${editorTarget}`;
  }

  _startScenario(id) {
    const scenario = resolveScenario(id, this.storage);
    if (!scenario) return;
    if (!this.confirm(`Start “${scenario.name}”? This replaces your current game. Use Save Game first if you want to keep it.`)) return;

    this.game.save();

    // The title screen already owns a fully initialized renderer. Reusing it
    // avoids a second WebGPU/WebGL initialization and its peak GPU allocation.
    // Runtime New Game actions still use the reload transaction below because
    // they may have arbitrary editor/windows/interaction state to tear down.
    try {
      if (this.startInPlace?.(scenario) === true) {
        this.document.getElementById('scenario-dialog')?.remove();
        return;
      }
    } catch (error) {
      console.warn('[scenario] In-place New Game failed; falling back to reload:', error);
    }

    try {
      // The pending selection is verified before the active save is removed.
      // If storage is unavailable, stay put with the current game intact.
      const staged = stageScenarioSelection(id, this.storage);
      if (!staged) throw new Error('The selected scenario is unavailable');
      this.sessionStorage.setItem(SKIP_TITLE_SESSION_KEY, '1');
      this.storage.removeItem('beamlineTycoon');
    } catch (error) {
      try { this.storage.removeItem(PENDING_SCENARIO_KEY); } catch (_) {}
      try { this.sessionStorage.removeItem(SKIP_TITLE_SESSION_KEY); } catch (_) {}
      this.game.log?.(`NEW GAME FAILED — ${error.message || 'the scenario could not be staged'}.`, 'bad');
      return;
    }
    // A page reload does not guarantee that a WebGPU device and its render
    // targets are released before the replacement page asks Chrome for a new
    // device. On large New Game scenes that overlap can saturate or kill the
    // GPU process. The composition root supplies a scoped teardown for the
    // current renderer; yield one task after it so disposal reaches the
    // browser before renderer initialization starts again.
    try { this.beforeReload?.(); }
    catch (error) {
      console.warn('[scenario] Renderer cleanup before New Game reload failed:', error);
    }
    this.scheduleReload(() => this.location.reload());
  }
}
