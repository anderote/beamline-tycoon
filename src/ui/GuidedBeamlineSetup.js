import { COMPONENTS } from '../data/components.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { flattenPath } from '../beamline/flattener.js';
import { findSlot } from '../beamline/pipe-placements.js';
import {
  guidedEndpointSuggestions,
  guidedPlacementTarget,
  guidedPlacementSuggestions,
  infrastructureChecklistForNodes,
} from '../beamline/guided-setup-plan.js';
import { openBeamlineTypePicker } from './BeamlineTypePicker.js';

const UTILITY_ACTIONS = {
  powerCable: { category: 'power', utility: 'powerCable' },
  rfWaveguide: { category: 'rfPower', utility: 'rfWaveguide' },
  coolingWater: { category: 'cooling', utility: 'coolingWater' },
  vacuumPipe: { category: 'vacuum', utility: 'vacuumPipe' },
  cryoTransfer: { category: 'cooling', utility: 'cryoTransfer' },
  dataFiber: { category: 'dataControls', utility: 'dataFiber' },
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function money(cost) {
  const value = typeof cost === 'number' ? cost : cost?.funding || 0;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${Math.round(value)}`;
}

function metricText(row) {
  if (row.utility === 'rfWaveguide' && row.frequencies.length) {
    return row.frequencies.map(hz => {
      const mhz = hz / 1e6;
      return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(1)} MHz`;
    }).join(', ');
  }
  if (row.utility === 'powerCable' && row.amount > 0) return `${row.amount.toFixed(0)} kW demand`;
  if (row.utility === 'coolingWater' && row.amount > 0) return `${row.amount.toFixed(0)} kW heat load`;
  if (row.utility === 'cryoTransfer' && row.amount > 0) return `${row.amount.toFixed(0)} W cold load`;
  return `${row.connected}/${row.sinkCount} connected`;
}

/**
 * Temporary, dismissible scaffolding for starting a beamline. It owns no
 * simulation state: source/type identity stays in BeamlineRegistry, hardware
 * stays in placeables/beamPipes, and utility completion is read from the gate.
 */
export class GuidedBeamlineSetup {
  constructor(game, renderer, input) {
    this.game = game;
    this.renderer = renderer;
    this.input = input;
    this.activeSourceId = null;
    this.activePipeId = null;
    this.collapsed = true;
    this.completed = false;
    this.dismissedSources = new Set();
    this.suggestionId = null;
    this.suggestionReason = '';
    this.suggestionPosition = null;
    this.suggestionPipeId = null;
    this.suggestionParams = null;
    this.suggestionStatus = 'idle';
    this._el = this._createElement();
    this._off = game.on((event, data) => this._onGameEvent(event, data));
  }

  _createElement() {
    const el = document.createElement('aside');
    el.id = 'guided-beamline-setup';
    el.className = 'guided-setup hidden collapsed';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<button type="button" class="guided-setup-chip" data-guide-action="expand">Setup</button>'
      + '<div class="guided-setup-panel">'
      + '<header><div><span class="guided-setup-kicker">GUIDE</span>'
      + '<strong class="guided-setup-title">New Beamline</strong></div>'
      + '<button type="button" class="guided-setup-close" data-guide-action="collapse" title="Collapse">×</button></header>'
      + '<div class="guided-setup-body"></div></div>';
    el.addEventListener('click', e => this._handleClick(e));
    document.body.appendChild(el);
    return el;
  }

  toJSON() {
    return {
      activeSourceId: this.activeSourceId,
      collapsed: this.collapsed,
      completed: this.completed,
      dismissedSources: [...this.dismissedSources],
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    this.activeSourceId = data.activeSourceId || null;
    this.collapsed = data.collapsed !== false;
    this.completed = !!data.completed;
    this.dismissedSources = new Set(data.dismissedSources || []);
    this._clearSuggestion();
    this._resolvePipe();
    this.render();
  }

  resetForNewSession() {
    this.activeSourceId = null;
    this.activePipeId = null;
    this.collapsed = true;
    this.completed = false;
    this.dismissedSources.clear();
    this._clearSuggestion();
    this.render();
  }

  _entryForOpen(beamlineId = null) {
    const selectedId = beamlineId
      || this.game.selectedBeamlineId
      || this.game.editingBeamlineId;
    const selected = selectedId ? this.game.registry.get(selectedId) : null;
    if (selected?.sourceId) return selected;
    const active = this.activeSourceId
      ? this.game.registry.getBySourceId(this.activeSourceId)
      : null;
    if (active?.sourceId) return active;
    const all = this.game.registry.getAll().filter(entry => entry?.sourceId);
    return all.length === 1 ? all[0] : null;
  }

  /** Reopen Guide for the selected (or only) beamline. */
  open(beamlineId = null) {
    const entry = this._entryForOpen(beamlineId);
    if (!entry) {
      const count = this.game.registry.getAll().filter(candidate => candidate?.sourceId).length;
      this.game.log(
        count > 1 ? 'Select a beamline to use Guide' : 'Build a beam source to use Guide',
        'info',
      );
      return false;
    }
    this.activeSourceId = entry.sourceId;
    this.activePipeId = null;
    this.dismissedSources.delete(entry.sourceId);
    this.collapsed = false;
    this._resolvePipe();
    this.render();
    return true;
  }

  toggle(beamlineId = null) {
    if (!this.collapsed && this._source() && !beamlineId) {
      this.collapsed = true;
      this.render();
      return true;
    }
    return this.open(beamlineId);
  }

  _clearSuggestion(status = 'idle') {
    this.suggestionId = null;
    this.suggestionReason = '';
    this.suggestionPosition = null;
    this.suggestionPipeId = null;
    this.suggestionParams = null;
    this.suggestionStatus = status;
  }

  onSourcePlaced(sourceId) {
    const source = this.game.getPlaceable(sourceId);
    const entry = this.game.registry.getBySourceId(sourceId);
    if (!source || !entry) return false;
    this.activeSourceId = sourceId;
    this.activePipeId = null;
    this.completed = false;
    this.collapsed = false;
    this.dismissedSources.delete(sourceId);
    this._clearSuggestion();
    this.render();

    if (!entry.typeId) this._chooseMission();
    else this._beginPipeGuidance();
    return true;
  }

  onPipeBuilt(pipeId) {
    if (!this.activeSourceId) return;
    const pipe = (this.game.state.beamPipes || []).find(p => p.id === pipeId);
    if (!pipe) return;
    if (pipe.start?.junctionId !== this.activeSourceId
        && pipe.end?.junctionId !== this.activeSourceId
        && pipe.id !== this.activePipeId) return;
    this.activePipeId = pipe.id;
    this.collapsed = false;
    this._clearSuggestion();
    this.render();
  }

  onComponentBuilt(pipeId) {
    if (!this._nodes().some(node => node.pipeId === pipeId)) return false;
    this._clearSuggestion();
    this.render();
    return true;
  }

  _entry() {
    return this.activeSourceId
      ? this.game.registry.getBySourceId(this.activeSourceId)
      : null;
  }

  _source() {
    return this.activeSourceId ? this.game.getPlaceable(this.activeSourceId) : null;
  }

  _resolvePipe() {
    if (this.activePipeId && (this.game.state.beamPipes || []).some(p => p.id === this.activePipeId)) return;
    this.activePipeId = (this.game.state.beamPipes || []).find(p =>
      p.start?.junctionId === this.activeSourceId || p.end?.junctionId === this.activeSourceId)?.id || null;
  }

  _pipe() {
    this._resolvePipe();
    return (this.game.state.beamPipes || []).find(p => p.id === this.activePipeId) || null;
  }

  _nodes() {
    if (!this.activeSourceId) return [];
    return flattenPath(this.game.state, this.activeSourceId);
  }

  _plan() {
    const entry = this._entry();
    return guidedPlacementSuggestions({
      typeId: entry?.typeId,
      nodes: this._nodes(),
      envelope: entry?.beamState?.physicsEnvelope || [],
      isUnlocked: comp => this.game.isComponentUnlocked(comp),
    });
  }

  _chooseMission() {
    const source = this._source();
    const entry = this._entry();
    if (!source || !entry) return;
    openBeamlineTypePicker(this.game, {
      sourceType: source.type,
      showBlueprints: false,
      onConfirm: (typeId) => {
        if (!typeId) {
          this.dismissedSources.add(source.id);
          this.collapsed = true;
          this.render();
          if (typeof this.input.beginBeamPipeFromSource === 'function') {
            this.input.beginBeamPipeFromSource(source.id);
          } else {
            this.input.selectComponentTool('drift');
            this.input.beamlineController?.showGuidedPipeStart?.(source.id, 'exit');
          }
          return;
        }
        if (!this.game.assignBeamlineType(entry.id, typeId)) return;
        this.collapsed = false;
        this._beginPipeGuidance();
      },
    });
  }

  _beginPipeGuidance() {
    const source = this._source();
    if (!source) return;
    this.input.setActiveMode?.('beamline');
    if (typeof this.input.beginBeamPipeFromSource === 'function') {
      this.input.beginBeamPipeFromSource(source.id);
    } else {
      this.input.selectComponentTool('drift');
      this.input.beamlineController?.showGuidedPipeStart?.(source.id, 'exit');
    }
    this.render();
  }

  _slotForHint(hint) {
    const def = COMPONENTS[hint?.componentType];
    const target = guidedPlacementTarget({
      nodes: this._nodes(),
      pipes: this.game.state.beamPipes || [],
      hint,
    });
    const pipe = target
      ? (this.game.state.beamPipes || []).find(candidate => candidate.id === target.pipeId)
      : null;
    if (!pipe || !def || !target) return null;
    const result = findSlot(pipe, {
      type: hint.componentType,
      requestedPosition: target.position,
      subL: def.subL || 2,
      inline: def.attachmentKind === 'inline',
      mode: 'snap',
      idGenerator: () => '__guided__',
      params: hint.params || {},
    });
    if (!result.ok) return null;
    const placed = result.placements.find(p => p.id === '__guided__');
    return placed ? { pipeId: pipe.id, position: placed.position } : null;
  }

  _setRecommendedComponent() {
    const plan = this._plan();
    if (!plan.hints.length) {
      this._clearSuggestion('none');
      return false;
    }
    let hint = null;
    let slot = null;
    for (const candidate of plan.hints) {
      slot = this._slotForHint(candidate);
      if (slot) {
        hint = candidate;
        break;
      }
    }
    if (!hint || !slot) {
      this._clearSuggestion('no-room');
      return false;
    }
    this.suggestionId = hint.componentType;
    this.suggestionPosition = slot.position;
    this.suggestionPipeId = slot.pipeId;
    this.suggestionParams = { ...(hint.params || {}) };
    this.suggestionReason = [
      hint.reason,
      hint.state,
      hint.target ? `Target ${hint.target}` : null,
    ].filter(Boolean).join(' · ');
    this.suggestionStatus = 'ready';
    this.input.setActiveMode?.('beamline');
    this.input.selectComponentTool(this.suggestionId);
    this.input.beamlineController?.showGuidedPlacement?.({
      pipeId: this.suggestionPipeId,
      type: this.suggestionId,
      position: this.suggestionPosition,
    });
    return true;
  }

  _requestSuggestion() {
    const entry = this._entry();
    if (!entry || !this._pipe()) return false;
    if (this.game.physicsRecalcCoordinator?.isPending?.(entry.id)) {
      this._clearSuggestion('analyzing');
      this.render();
      return false;
    }
    if (!entry.beamState?.physicsEnvelope?.length) {
      const ready = this.game.physicsEngine?.isReady?.() === true;
      this._clearSuggestion(ready ? 'analyzing' : 'warming');
      if (ready) this.game.recalcBeamline(entry.id);
      this.render();
      return false;
    }
    const recommended = this._setRecommendedComponent();
    this.render();
    return recommended;
  }

  _buildSuggested() {
    if (!this.suggestionId || !this.suggestionPipeId) return;
    const id = this.suggestionId;
    const pipeId = this.suggestionPipeId;
    const position = this.suggestionPosition;
    const params = { ...(this.suggestionParams || {}) };
    if (position == null) return;
    const placedId = this.game.commitGesture({
      mutate: () => this.game.beamline.placeOnPipe(pipeId, {
        type: id,
        position,
        subL: COMPONENTS[id]?.subL,
        mode: 'snap',
        params,
      }),
    });
    if (placedId) this.onComponentBuilt(pipeId, placedId);
  }

  _switchInfraCategory(category) {
    this.input.setActiveMode?.('infra');
    this.input.selectedCategory = category;
    this.renderer._generateCategoryTabs?.();
    this.renderer.updatePalette?.(category);
  }

  _infrastructureAction(utility) {
    const action = UTILITY_ACTIONS[utility];
    if (!action) return;
    const types = new Set((this.game.state.placeables || []).map(p => p.type));
    let component = null;
    if (utility === 'powerCable') {
      if (![...types].some(t => ['hvTransformer', 'facilityTransformer', 'padMountTransformer'].includes(t))) {
        component = 'hvTransformer';
      } else if (![...types].some(t => ['powerPanel', 'sectionDistributionPanel', 'mainDistributionPanel'].includes(t))) {
        component = 'powerPanel';
      }
    } else if (utility === 'rfWaveguide') {
      if (![...types].some(t => COMPONENTS[t]?.category === 'rfPower'
          && COMPONENTS[t]?.subsection === 'supply')) {
        const lowBand = this._nodes().some(n => {
          const f = Object.values(COMPONENTS[n.type]?.ports || {})
            .find(p => p?.utility === 'rfWaveguide' && p.role === 'sink')?.params?.frequency;
          return Number.isFinite(f) && f < 1e9;
        });
        component = lowBand ? 'lowBandBuncherAmp' : 'solidStateAmp';
      }
    } else if (utility === 'coolingWater') {
      if (![...types].some(t => ['packageChiller', 'lcwSkid', 'chiller'].includes(t))) component = 'packageChiller';
    } else if (utility === 'vacuumPipe') {
      if (![...types].some(t => [
        'roughingPump', 'roughingPumpCart', 'turboPump', 'turboPumpCart',
        'vacuumCart', 'highCapacityVacuumStation', 'ionPump', 'negPump', 'tiSubPump',
      ].includes(t))) component = 'roughingPump';
    } else if (utility === 'cryoTransfer') {
      if (![...types].some(t => ['coldBox4K', 'coldBox2K'].includes(t))) component = 'coldBox4K';
    } else if (utility === 'dataFiber') {
      if (![...types].some(t => ['rackIoc', 'networkSwitch'].includes(t))) component = 'rackIoc';
    }

    this._switchInfraCategory(action.category);
    if (component && COMPONENTS[component] && this.game.isComponentUnlocked(COMPONENTS[component])) {
      this.input.selectComponentTool(component);
      this.game.log(`Setup: place ${COMPONENTS[component].name}`, 'info');
    } else {
      this.input.selectPaletteTool('utility', action.utility);
      this.game.log(`Setup: connect ${action.utility}`, 'info');
    }
  }

  _onGameEvent(event, data) {
    if (event === 'beamlineSelected' && data) {
      const entry = this.game.registry.get(data);
      if (entry?.sourceId) {
        this.activeSourceId = entry.sourceId;
        this.activePipeId = null;
        this.completed = false;
        this.collapsed = this.dismissedSources.has(entry.sourceId);
        this._clearSuggestion();
        this._resolvePipe();
        this.render();
      }
      return;
    }
    if (!this.activeSourceId) return;
    if (event === 'beamlineChanged' || event === 'placeableChanged') {
      this._resolvePipe();
      if (event === 'beamlineChanged' && this.suggestionStatus !== 'analyzing') {
        this._clearSuggestion();
      }
      this.render();
      return;
    }
    if (event === 'physicsUpdated' && this.suggestionStatus === 'analyzing') {
      const entry = this._entry();
      const pending = this.game.physicsRecalcCoordinator?.isPending?.(entry?.id) === true;
      if (pending) {
        this.render();
      } else if (entry?.beamState?.physicsEnvelope?.length) {
        this._setRecommendedComponent();
        this.render();
      } else {
        this._clearSuggestion('unavailable');
        this.render();
      }
      return;
    }
    if (event === 'tick') {
      const entry = this._entry();
      const checklist = infrastructureChecklistForNodes(this._nodes(), this.game.state);
      const operational = checklist.length > 0 && checklist.every(row => row.complete);
      const measured = (entry?.beamState?.beamOnTicks || 0) > 0
        || (entry?.beamState?.totalDataCollected || 0) > 0;
      if (!this.completed && operational && measured) {
        this.completed = true;
        this.collapsed = true;
        this._el.classList.add('just-completed');
        setTimeout(() => this._el?.classList.remove('just-completed'), 2400);
      }
      this.render();
    }
  }

  _handleClick(event) {
    const button = event.target.closest('[data-guide-action]');
    if (!button) return;
    const action = button.dataset.guideAction;
    if (action === 'expand') {
      this.collapsed = false;
      if (this.activeSourceId) this.dismissedSources.delete(this.activeSourceId);
    }
    else if (action === 'collapse') {
      this.collapsed = true;
      if (this.activeSourceId) this.dismissedSources.add(this.activeSourceId);
    } else if (action === 'choose-mission') this._chooseMission();
    else if (action === 'draw-pipe') this._beginPipeGuidance();
    else if (action === 'suggest-next') this._requestSuggestion();
    else if (action === 'build-suggestion') this._buildSuggested();
    else if (action === 'endpoint') {
      const id = button.dataset.component;
      if (id) {
        this.input.setActiveMode?.('beamline');
        this.input.selectComponentTool(id);
      }
    } else if (action === 'utility') this._infrastructureAction(button.dataset.utility);
    else if (action === 'designer') {
      const entry = this._entry();
      if (entry) this.game._openDesignerForBeamline(entry.id);
    }
    this.render();
  }

  render() {
    if (!this._el) return;
    const source = this._source();
    const entry = this._entry();
    if (!source || !entry) {
      this._el.classList.add('hidden');
      return;
    }
    this._el.classList.remove('hidden');
    this._el.classList.toggle('collapsed', this.collapsed);
    this._el.classList.toggle('complete', this.completed);
    const type = getBeamlineType(entry.typeId);
    const title = this._el.querySelector('.guided-setup-title');
    if (title) title.textContent = type?.name || COMPONENTS[source.type]?.name || 'New Beamline';
    const chip = this._el.querySelector('.guided-setup-chip');
    if (chip) chip.textContent = this.completed ? 'Setup ✓' : 'Setup';

    const body = this._el.querySelector('.guided-setup-body');
    if (!body) return;
    if (!type) {
      body.innerHTML = '<section class="guided-step active"><span class="guided-step-num">1</span>'
        + '<div><strong>Choose the beamline mission</strong>'
        + '<p>The source narrows the available machine types and their target bands.</p>'
        + '<button type="button" data-guide-action="choose-mission">Choose type</button></div></section>';
      return;
    }

    const pipe = this._pipe();
    const endpointIds = guidedEndpointSuggestions(type.id, comp => this.game.isComponentUnlocked(comp));
    const checklist = infrastructureChecklistForNodes(this._nodes(), this.game.state);
    let html = `<div class="guided-type-badge" style="--guide-accent:#${type.accentColor.toString(16).padStart(6, '0')}">`
      + `<span>${esc(type.particle)}</span><strong>${esc(type.name)}</strong></div>`;

    if (!pipe) {
      html += '<section class="guided-step active"><span class="guided-step-num">1</span><div>'
        + '<strong>Extend beam pipe from the source</strong>'
        + '<p>The pipe tool is anchored at the exit. Drag forward to choose the starter length.</p>'
        + '<button type="button" data-guide-action="draw-pipe">Drag beam pipe</button></div></section>';
    } else if (this.suggestionId) {
      const def = COMPONENTS[this.suggestionId];
      html += '<section class="guided-step active"><span class="guided-step-num">2</span><div>'
        + `<strong>Recommended: ${esc(def?.name || this.suggestionId)}</strong>`
        + `<p>${esc(this.suggestionReason)} · ${esc(money(def?.cost))}</p>`
        + '<div class="guided-actions">'
        + '<button type="button" class="primary" data-guide-action="build-suggestion">Auto-place here</button>'
        + '</div></div></section>';
    } else {
      const messages = {
        analyzing: 'Running the same beam-envelope advisor used by Designer…',
        warming: 'The physics advisor is still warming up. Try again in a moment.',
        unavailable: 'The physics advisor could not analyze this line. Try again or open Designer.',
        none: 'The physics advisor has no component to add right now.',
        'no-room': 'The suggested location has no open pipe span. Extend the pipe or use Designer.',
        idle: 'Analyze the current beam envelope and choose the next useful component.',
      };
      const disabled = this.suggestionStatus === 'analyzing' ? ' disabled' : '';
      html += '<section class="guided-step active"><span class="guided-step-num">2</span><div>'
        + '<strong>Physics build advisor</strong>'
        + `<p>${esc(messages[this.suggestionStatus] || messages.idle)}</p>`
        + `<button type="button" class="primary" data-guide-action="suggest-next"${disabled}>Suggest next component</button>`
        + '</div></section>';
    }

    if (endpointIds.length) {
      html += '<section class="guided-step"><span class="guided-step-num">3</span><div>'
        + '<strong>Choose an endpoint</strong><p>Terminate the line with equipment suited to its mission.</p>'
        + '<div class="guided-actions">';
      for (const id of endpointIds.slice(0, 3)) {
        html += `<button type="button" data-guide-action="endpoint" data-component="${esc(id)}">${esc(COMPONENTS[id]?.name || id)}</button>`;
      }
      html += '</div></div></section>';
    }

    if (checklist.length) {
      const allComplete = checklist.every(row => row.complete);
      html += '<section class="guided-checklist"><div class="guided-checklist-head">'
        + `<strong>${allComplete ? 'Ready to commission' : 'Make it operational'}</strong>`
        + '<span>Derived from installed hardware</span></div>';
      for (const row of checklist) {
        html += `<button type="button" class="guided-check ${row.complete ? 'done' : ''}" data-guide-action="utility" data-utility="${row.utility}">`
          + `<span class="guided-checkmark">${row.complete ? '✓' : '○'}</span>`
          + `<span><strong>${esc(row.label)}</strong><small>${esc(metricText(row))}</small></span>`
          + `<span class="guided-check-action">${row.complete ? 'Connected' : 'Build next ›'}</span></button>`;
      }
      html += '</section>';
    }

    html += '<footer class="guided-setup-footer">'
      + '<button type="button" data-guide-action="designer">Open Beamline Designer</button>'
      + '<button type="button" data-guide-action="collapse">Continue manually</button></footer>';
    body.innerHTML = html;
  }
}
