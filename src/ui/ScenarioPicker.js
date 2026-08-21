// src/ui/ScenarioPicker.js — the single New Game entry point.
//
// The picker owns the choose -> preserve -> stage -> reload transaction so
// title-screen and in-game New Game actions cannot drift apart. Blank play is
// an explicit Sandbox selection, just like every authored starting situation.

import {
  customScenarioRef,
  listPlayableScenarios,
  resolveScenario,
  stageScenarioSelection,
} from '../data/scenarios.js';
import { SaveSlots } from '../game/SaveSlots.js';
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
  } = {}) {
    this.game = game;
    this.storage = storage;
    this.sessionStorage = sessionStorage;
    this.document = document;
    this.location = location;
    this.confirm = confirm;
    this.editorEnabled = editorEnabled;
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
    html += '<p class="scenario-intro">Choose a starting situation. Your current game is kept in recovery saves after you confirm a choice.</p>';

    for (const scenario of scenarios) {
      if (scenario.local) html += '<div class="scenario-card-row">';
      html += `<button type="button" class="scenario-card" data-id="${escapeText(scenario.id)}">`;
      html += '<span class="scenario-card-header">';
      html += `<strong class="scenario-card-name">${escapeText(scenario.name)}</strong>`;
      html += `<span class="scenario-difficulty">${escapeText(scenario.difficulty)}</span>`;
      html += '</span>';
      html += `<span class="scenario-description">${escapeText(scenario.desc)}</span>`;
      html += '</button>';
      if (scenario.local) {
        if (this.editorEnabled) {
          html += `<button type="button" class="scenario-edit-action" data-edit-scenario="${escapeText(scenario.localId)}" aria-label="Edit ${escapeText(scenario.name)}">Edit</button>`;
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
        ? 'Use Edit beside a local scenario to revise it, or begin another blank starting situation.'
        : 'Build a playable starting situation with every technology unlocked, then publish it with Save As.'}</p>`;
      html += '<div class="scenario-admin-actions">';
      html += '<button type="button" class="scenario-admin-action" data-scenario-action="start-new">';
      html += '<strong>New Scenario</strong><span>Open a blank project without changing existing playable scenarios.</span>';
      html += '</button>';
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
    const scenario = localId ? resolveScenario(customScenarioRef(localId), this.storage) : null;
    const message = scenario
      ? `Edit “${scenario.name}”?\n\nYour current game will be saved and kept in recovery saves.`
      : 'Create a new starting situation?\n\nYour current game will be saved and kept in recovery saves.';
    if (!this.confirm(message)) return;
    this.game.save();
    SaveSlots.preserveActive('Before scenario construction');
    const editorTarget = localId ? encodeURIComponent(localId) : 'new';
    this.location.href = `${this.location.pathname}?editor=${editorTarget}`;
  }

  _startScenario(id) {
    const scenario = resolveScenario(id, this.storage);
    if (!scenario) return;
    if (!this.confirm(`Start “${scenario.name}”? Your current game will be kept in recovery saves.`)) return;

    this.game.save();
    SaveSlots.preserveActive(`Before ${scenario.name}`);
    this.storage.removeItem('beamlineTycoon');
    stageScenarioSelection(id, this.storage);
    this.sessionStorage.setItem(SKIP_TITLE_SESSION_KEY, '1');
    this.location.reload();
  }
}
