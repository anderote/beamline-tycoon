// ControlRoomWindow.js — facility-wide live operations console.

import { ContextWindow } from './ContextWindow.js';
import { BeamlineWindow } from './BeamlineWindow.js';
import { buildControlRoomModel, sparklinePoints } from './control-room-model.js';
import { escapeHtml, fmtMoney, fmtNumber } from './format.js';

const WINDOW_ID = 'control-room';
const HISTORY_CAPACITY = 90;
const PLOT_WIDTH = 258;
const PLOT_HEIGHT = 48;

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
}

function signedMoney(value) {
  const n = value || 0;
  return `${n < 0 ? '-' : '+'}${fmtMoney(Math.abs(n))}`;
}

function statusLabel(status) {
  if (status === 'running') return 'LIVE';
  if (status === 'held') return 'HELD';
  if (status === 'faulted') return 'FAULT';
  return 'STANDBY';
}

function statusColor(status) {
  if (status === 'running') return '#55e38a';
  if (status === 'held' || status === 'faulted') return '#ff6b61';
  return '#8d91a9';
}

function metric(label, value, tone = '') {
  return `<div class="control-room-metric">
    <span>${escapeHtml(label)}</span>
    <strong class="${tone}">${escapeHtml(value)}</strong>
  </div>`;
}

function plot(title, value, unit, values, color, options = {}) {
  const points = sparklinePoints(values, PLOT_WIDTH, PLOT_HEIGHT, options);
  return `<figure class="control-room-plot">
    <figcaption><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}${escapeHtml(unit)}</strong></figcaption>
    <svg viewBox="0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}" role="img" aria-label="${escapeHtml(title)} recent history">
      <path class="control-room-plot-grid" d="M0 12H${PLOT_WIDTH}M0 24H${PLOT_WIDTH}M0 36H${PLOT_WIDTH}"></path>
      ${points ? `<polyline points="${points}" style="--plot-color:${escapeHtml(color)}"></polyline>` : ''}
    </svg>
  </figure>`;
}

export class ControlRoomWindow {
  static toggle(game) {
    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) { existing.close(); return null; }
    return new ControlRoomWindow(game);
  }

  constructor(game) {
    this.game = game;
    this.selectedBeamlineId = game?.selectedBeamlineId || game?.registry?.getAll?.()[0]?.id || null;
    this._history = new Map();
    this._lastSampledTick = null;

    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    this.ctx = new ContextWindow({
      id: WINDOW_ID,
      title: 'Control Room',
      icon: '◉',
      accentColor: '#176d73',
      tabs: [{ key: 'operations', label: 'Live Operations' }],
      onClose: () => this._teardown(),
    });
    this.ctx.onTabRender('operations', element => this._render(element));

    this._off = typeof game?.on === 'function' ? game.on(event => {
      if (!['tick', 'loaded', 'started', 'beamlineChanged', 'beamToggled',
        'staffChanged', 'infrastructureValidated', 'resourcesChanged'].includes(event)) return;
      if (event === 'loaded' || event === 'started') this._resetHistory();
      this.refresh();
    }) : null;

    this.refresh();
  }

  _resetHistory() {
    this._history.clear();
    this._lastSampledTick = null;
  }

  _sample(model) {
    if (model.tick === this._lastSampledTick) return;
    this._lastSampledTick = model.tick;
    const liveIds = new Set();
    for (const line of model.beamlines) {
      liveIds.add(line.id);
      let history = this._history.get(line.id);
      if (!history) {
        history = { quality: [], data: [] };
        this._history.set(line.id, history);
      }
      history.quality.push(line.beamQuality);
      history.data.push(line.effectiveDataRate);
      if (history.quality.length > HISTORY_CAPACITY) history.quality.shift();
      if (history.data.length > HISTORY_CAPACITY) history.data.shift();
    }
    for (const id of this._history.keys()) {
      if (!liveIds.has(id)) this._history.delete(id);
    }
  }

  _ensureSelection(model) {
    if (!model.beamlines.some(line => line.id === this.selectedBeamlineId)) {
      this.selectedBeamlineId = model.beamlines[0]?.id || null;
    }
  }

  _render(element) {
    const model = buildControlRoomModel(this.game);
    this._ensureSelection(model);
    this._sample(model);
    const selected = model.beamlines.find(line => line.id === this.selectedBeamlineId) || null;

    element.innerHTML = `
      ${this._renderFacilityStrip(model)}
      <div class="control-room-layout">
        <aside class="control-room-lines" aria-label="Beamlines">
          <div class="control-room-section-title">Beamlines</div>
          ${model.beamlines.length ? model.beamlines.map(line => this._renderLine(line)).join('')
            : '<div class="control-room-empty">No beamlines commissioned.</div>'}
        </aside>
        <section class="control-room-detail">
          ${selected ? this._renderSelected(model, selected) : this._renderNoSelection(model)}
        </section>
      </div>`;

    element.querySelectorAll('[data-control-room-line]').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedBeamlineId = button.dataset.controlRoomLine;
        this.game.selectedBeamlineId = this.selectedBeamlineId;
        this.refresh();
      });
    });
  }

  _renderFacilityStrip(model) {
    const net = model.economy?.net ?? 0;
    return `<div class="control-room-facility-strip">
      <div class="control-room-facility-state ${model.status === 'FACILITY FAULT' ? 'bad' : ''}">
        <span class="control-room-live-dot"></span>
        <strong>${escapeHtml(model.status)}</strong>
      </div>
      ${metric('Lines live', `${model.runningCount} / ${model.beamlines.length}`)}
      ${metric('Facility uptime', percent(model.uptimeFraction))}
      ${metric('Net / tick', model.economy ? signedMoney(net) : '--', net < 0 ? 'bad' : 'good')}
      ${metric('Balance', fmtMoney(model.funding), 'neutral')}
    </div>`;
  }

  _renderLine(line) {
    const selected = line.id === this.selectedBeamlineId;
    return `<button type="button" class="control-room-line${selected ? ' active' : ''}"
        data-control-room-line="${escapeHtml(line.id)}" style="--line-color:${escapeHtml(line.accentColor)}">
      <span class="control-room-line-head">
        <span class="control-room-line-dot" style="--status-color:${statusColor(line.status)}"></span>
        <strong>${escapeHtml(line.name)}</strong>
        <em>${statusLabel(line.status)}</em>
      </span>
      <span class="control-room-line-meta">
        <span>Q ${percent(line.beamQuality)}</span>
        <span>${fmtNumber(line.beamEnergy)} MeV</span>
      </span>
    </button>`;
  }

  _renderSelected(model, line) {
    const history = this._history.get(line.id) || { quality: [], data: [] };
    const status = statusLabel(line.status);
    const crew = model.staff;
    const service = line.serviceContract || 'No endpoint contract';
    const dataMax = Math.max(1, ...history.data);

    return `<div class="control-room-detail-head">
        <div>
          <span class="control-room-kicker">Selected beamline</span>
          <h2>${escapeHtml(line.name)}</h2>
        </div>
        <span class="control-room-badge" style="--status-color:${statusColor(line.status)}">${status}</span>
      </div>
      <div class="control-room-primary-metrics">
        ${metric('Beam quality', percent(line.beamQuality), line.beamQuality < 0.5 ? 'bad' : 'good')}
        ${metric('Beam energy', `${fmtNumber(line.beamEnergy)} MeV`, 'neutral')}
        ${metric('Delivered data', `${fmtNumber(line.effectiveDataRate)} /t`, 'neutral')}
        ${metric('Line uptime', percent(line.uptimeFraction), 'neutral')}
      </div>
      <div class="control-room-section-title">Rolling telemetry · ${history.quality.length} ticks</div>
      <div class="control-room-plots">
        ${plot('Beam quality', percent(line.beamQuality), '', history.quality, '#55e38a', { min: 0, max: 1 })}
        ${plot('Delivered data', fmtNumber(line.effectiveDataRate), ' /t', history.data, '#51b9ff', { min: 0, max: dataMax })}
      </div>
      <div class="control-room-secondary-grid">
        <div>
          <div class="control-room-section-title">Business channel</div>
          <dl class="control-room-readout">
            <div><dt>Service</dt><dd>${escapeHtml(service)}</dd></div>
            <div><dt>Service revenue</dt><dd>${fmtMoney(line.serviceRevenue)} /t</dd></div>
            <div><dt>Facility income</dt><dd>${model.economy ? `${fmtMoney(model.economy.totalIncome)} /t` : '--'}</dd></div>
            <div><dt>Facility upkeep</dt><dd>${model.economy ? `${fmtMoney(model.economy.totalUpkeep)} /t` : '--'}</dd></div>
          </dl>
        </div>
        <div>
          <div class="control-room-section-title">Shift status</div>
          <dl class="control-room-readout">
            <div><dt>On task</dt><dd>${crew.onTask} / ${crew.total}</dd></div>
            <div><dt>Idle</dt><dd>${crew.idle}</dd></div>
            <div><dt>Needs attention</dt><dd class="${crew.attention ? 'warn' : ''}">${crew.attention}</dd></div>
            <div><dt>Data buffer</dt><dd>${fmtNumber(line.rawDataStored)}</dd></div>
          </dl>
        </div>
      </div>
      ${this._renderAlerts(model, line)}`;
  }

  _renderAlerts(model, line) {
    const alerts = [...model.blockers];
    if (line.status === 'running' && line.totalLossFraction > 0.05) {
      alerts.push({ code: 'beam_loss', message: `Beam loss is ${percent(line.totalLossFraction)}.` });
    }
    if (line.rawDataDropped > 0) {
      alerts.push({ code: 'data_dropped', message: `${fmtNumber(line.rawDataDropped)} data units have been dropped.` });
    }

    return `<div class="control-room-section-title">Active alarms</div>
      <div class="control-room-alerts">
        ${alerts.length ? alerts.slice(0, 4).map(alert => `<div class="control-room-alert">
          <span>!</span><p><strong>${escapeHtml(alert.code.replaceAll('_', ' '))}</strong>${escapeHtml(alert.message)}</p>
        </div>`).join('') : '<div class="control-room-all-clear"><span>✓</span> No active alarms</div>'}
      </div>`;
  }

  _renderNoSelection(model) {
    return `<div class="control-room-no-line">
      <span>◌</span>
      <strong>No beamline telemetry</strong>
      <p>${model.blockers.length ? escapeHtml(model.blockers[0].message) : 'Commission a beamline to begin live monitoring.'}</p>
    </div>`;
  }

  _updateActions(model) {
    const selected = model.beamlines.find(line => line.id === this.selectedBeamlineId) || null;
    if (!selected) {
      this.ctx.setActions([]);
      return;
    }
    const running = selected.status === 'running' || selected.status === 'held';
    this.ctx.setActions([
      {
        label: running ? 'Stop Selected Beam' : 'Start Selected Beam',
        style: running ? 'color:#ff8b83' : 'color:#79e8a0',
        onClick: () => {
          this.game.runUndoableMutation(() => this.game.toggleBeam(selected.id));
          this.refresh();
        },
      },
      {
        label: 'Open Beamline Detail',
        onClick: () => new BeamlineWindow(this.game, selected.id),
      },
    ]);
  }

  refresh() {
    if (!this.ctx?._el) return;
    const model = buildControlRoomModel(this.game);
    this._ensureSelection(model);
    this._sample(model);
    const color = model.status === 'FACILITY FAULT' ? '#ff6b61'
      : model.status === 'BEAM LIVE' ? '#55e38a' : '#a4a8bd';
    this.ctx.setStatus(model.status, color);
    this._updateActions(model);
    this.ctx.update();
  }

  _teardown() {
    this._off?.();
    this._off = null;
  }
}

export default ControlRoomWindow;
