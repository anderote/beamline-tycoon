import {
  DESIGNER_OPTIMIZER_PRESETS,
  DESIGNER_OPTIMIZER_TARGETS,
  describeDesignerOptimizerScopes,
  formatDesignerOptimizationMetric,
  scoreDesignerOptimization,
  summarizeDesignerOptimization,
} from '../beamline/designer-optimizer.js';
import { pushEscHandler } from './esc-stack.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function targetDirection(def) {
  if (def.goal === 'minimize') return 'MINIMIZE';
  if (def.goal === 'target') return 'REACH';
  return 'MAXIMIZE';
}

function isImproved(key, before, after, target) {
  const def = DESIGNER_OPTIMIZER_TARGETS[key];
  const a = before?.[key];
  const b = after?.[key];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (def.goal === 'minimize') return b < a;
  if (def.goal === 'target' && Number.isFinite(target?.value)) {
    return Math.abs(b - target.value) < Math.abs(a - target.value);
  }
  return b > a;
}

function isWorse(key, before, after, target) {
  const def = DESIGNER_OPTIMIZER_TARGETS[key];
  const a = before?.[key];
  const b = after?.[key];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (def.goal === 'minimize') return b > a;
  if (def.goal === 'target' && Number.isFinite(target?.value)) {
    return Math.abs(b - target.value) > Math.abs(a - target.value);
  }
  return b < a;
}

export class BeamlineOptimizerDialog {
  constructor({ onRun, onApply, onCancel = null } = {}) {
    this.root = document.getElementById('dsgn-optimizer-dialog');
    this.onRun = onRun;
    this.onApply = onApply;
    this.onCancel = onCancel;
    this.context = null;
    this.result = null;
    this.busy = false;
    this._escUnsub = null;
    this._openToken = 0;
  }

  get isOpen() {
    return !!this.context && !this.root?.classList.contains('hidden');
  }

  open({
    nodes = [], selectedIndex = -1, initialResult = null,
    defaultScope = 'all', energyTargetGeV = null,
  } = {}) {
    if (!this.root) return false;
    const scopes = describeDesignerOptimizerScopes({ nodes, selectedIndex });
    let scope = scopes.find(option => option.id === defaultScope && !option.disabled)?.id;
    if (!scope) scope = scopes.find(option => option.id === 'all' && !option.disabled)?.id;
    if (!scope) scope = scopes.find(option => !option.disabled)?.id;
    if (!scope) return false;

    const selectedType = nodes[selectedIndex]?.type;
    const preset = selectedType === 'buncher' || selectedType === 'rfq'
      || selectedType === 'harmonicLinearizer'
      ? 'bunch'
      : (scope === 'optics' ? 'focus' : 'balanced');
    const baseline = summarizeDesignerOptimization(initialResult);
    this.context = {
      nodes,
      selectedIndex,
      initialResult,
      scopes,
      scope,
      preset,
      baseline,
      energyTargetGeV: Number.isFinite(energyTargetGeV)
        ? energyTargetGeV
        : Math.max((baseline?.energy || 0) * 1.25, 0.001),
    };
    this.result = null;
    this.busy = false;
    this._openToken++;
    this._render();
    this.root.classList.remove('hidden');
    this._escUnsub?.();
    this._escUnsub = pushEscHandler(() => {
      this.close();
      return true;
    });
    this.root.querySelector('#dsgn-optimizer-scope')?.focus();
    return true;
  }

  close() {
    if (!this.context) return;
    this._openToken++;
    this.onCancel?.();
    this.context = null;
    this.result = null;
    this.busy = false;
    this._escUnsub?.();
    this._escUnsub = null;
    this.root?.classList.add('hidden');
    if (this.root) this.root.innerHTML = '';
  }

  setProgress(progress) {
    if (!this.isOpen || !progress) return;
    const status = this.root.querySelector('#dsgn-optimizer-progress-label');
    const fill = this.root.querySelector('#dsgn-optimizer-progress-fill');
    const current = Math.max(0, progress.evaluations || 0);
    const total = Math.max(1, progress.total || 1);
    if (status) {
      const name = progress.knob
        ? `${progress.knob.componentName || progress.knob.type} · ${progress.knob.key.replace(/([A-Z])/g, ' $1')}`
        : 'preparing sweep';
      status.textContent = `SOLVE ${Math.min(current, total)} / ${total} · ${name}`;
    }
    if (fill) fill.style.width = `${Math.min(100, current / total * 100)}%`;
  }

  _scopeOptionHtml(option) {
    const selected = option.id === this.context.scope ? ' selected' : '';
    const disabled = option.disabled ? ' disabled' : '';
    const suffix = option.disabled ? 'no controls' : `${option.count} components · ${option.controls} controls`;
    return `<option value="${option.id}"${selected}${disabled}>`
      + `${escapeHtml(option.label)} — ${suffix}</option>`;
  }

  _targetHtml(key) {
    const def = DESIGNER_OPTIMIZER_TARGETS[key];
    const checked = DESIGNER_OPTIMIZER_PRESETS[this.context.preset]?.includes(key) ? ' checked' : '';
    const targetInput = key === 'energy'
      ? `<label class="dsgn-optimizer-target-value">`
        + `<input type="number" min="0" step="any" value="${this.context.energyTargetGeV}" `
        + 'data-optimizer-target-value="energy" aria-label="Target output energy in GeV"> GeV</label>'
      : `<span class="dsgn-optimizer-target-direction">${targetDirection(def)}</span>`;
    return `<label class="dsgn-optimizer-target" title="${escapeHtml(def.description)}">`
      + `<input type="checkbox" data-optimizer-target="${key}"${checked}>`
      + `<span class="dsgn-optimizer-target-copy"><strong>${escapeHtml(def.label)}</strong>`
      + `<small>${escapeHtml(def.description)}</small></span>${targetInput}</label>`;
  }

  _render() {
    if (!this.root || !this.context) return;
    this.root.innerHTML = `
      <div class="dsgn-optimizer-backdrop" data-optimizer-close></div>
      <section class="dsgn-optimizer-sheet" role="dialog" aria-modal="true"
               aria-labelledby="dsgn-optimizer-title">
        <header class="dsgn-optimizer-header">
          <div>
            <span class="dsgn-optimizer-kicker">SOLVER WORKBENCH</span>
            <h2 id="dsgn-optimizer-title">Beamline Optimizer</h2>
            <p>Sweep real component setpoints through the beam solver, compare the result, then apply only the best measured settings.</p>
          </div>
          <button type="button" class="dsgn-optimizer-close" data-optimizer-close aria-label="Close optimizer">&times;</button>
        </header>
        <div class="dsgn-optimizer-body">
          <section class="dsgn-optimizer-setup">
            <label class="dsgn-optimizer-field">
              <span>Optimization scope</span>
              <select id="dsgn-optimizer-scope">${this.context.scopes.map(option => this._scopeOptionHtml(option)).join('')}</select>
            </label>
            <label class="dsgn-optimizer-field">
              <span>Target preset</span>
              <select id="dsgn-optimizer-preset">
                <option value="balanced">Balanced transport</option>
                <option value="focus">Tight, clean focus</option>
                <option value="bunch">Short, bright bunch</option>
                <option value="energy">Target energy</option>
              </select>
            </label>
            <div class="dsgn-optimizer-targets" role="group" aria-label="Optimization targets">
              ${Object.keys(DESIGNER_OPTIMIZER_TARGETS).map(key => this._targetHtml(key)).join('')}
            </div>
          </section>
          <section class="dsgn-optimizer-results" aria-live="polite">
            <div class="dsgn-optimizer-progress">
              <div class="dsgn-optimizer-progress-copy">
                <span id="dsgn-optimizer-progress-label">READY TO SWEEP</span>
                <span id="dsgn-optimizer-progress-note">No draft values change until you apply a result.</span>
              </div>
              <div class="dsgn-optimizer-progress-track"><span id="dsgn-optimizer-progress-fill"></span></div>
            </div>
            <div id="dsgn-optimizer-comparison" class="dsgn-optimizer-comparison">
              <div class="dsgn-optimizer-empty">
                <strong>Choose a scope and targets</strong>
                <span>The optimizer will make bounded passes over every eligible control and retain only solver-measured improvements.</span>
              </div>
            </div>
          </section>
        </div>
        <footer class="dsgn-optimizer-footer">
          <span id="dsgn-optimizer-error" class="dsgn-optimizer-error"></span>
          <button type="button" class="dsgn-optimizer-secondary" data-optimizer-close>Cancel</button>
          <button type="button" id="dsgn-optimizer-run" class="dsgn-optimizer-run">Run sweep</button>
          <button type="button" id="dsgn-optimizer-apply" class="dsgn-optimizer-apply" disabled>Apply best settings</button>
        </footer>
      </section>`;
    const preset = this.root.querySelector('#dsgn-optimizer-preset');
    if (preset) preset.value = this.context.preset;
    this._bind();
  }

  _bind() {
    this.root.querySelectorAll('[data-optimizer-close]').forEach(button => {
      button.addEventListener('click', () => this.close());
    });
    this.root.querySelector('#dsgn-optimizer-scope')?.addEventListener('change', event => {
      this.context.scope = event.target.value;
      this._clearResult('SCOPE CHANGED · READY TO SWEEP');
    });
    this.root.querySelector('#dsgn-optimizer-preset')?.addEventListener('change', event => {
      this.context.preset = event.target.value;
      const enabled = new Set(DESIGNER_OPTIMIZER_PRESETS[this.context.preset] || []);
      this.root.querySelectorAll('[data-optimizer-target]').forEach(input => {
        input.checked = enabled.has(input.dataset.optimizerTarget);
      });
      this._clearResult('TARGETS CHANGED · READY TO SWEEP');
    });
    this.root.querySelectorAll('[data-optimizer-target], [data-optimizer-target-value]').forEach(input => {
      input.addEventListener('change', () => this._clearResult('TARGETS CHANGED · READY TO SWEEP'));
    });
    this.root.querySelector('#dsgn-optimizer-run')?.addEventListener('click', () => {
      Promise.resolve(this._run()).catch(error => this._showError(error));
    });
    this.root.querySelector('#dsgn-optimizer-apply')?.addEventListener('click', () => {
      Promise.resolve(this._apply()).catch(error => this._showError(error));
    });
  }

  _collectTargets() {
    const targets = [];
    this.root.querySelectorAll('[data-optimizer-target]:checked').forEach(input => {
      const target = { key: input.dataset.optimizerTarget };
      if (target.key === 'energy') {
        const value = Number(this.root.querySelector('[data-optimizer-target-value="energy"]')?.value);
        if (Number.isFinite(value) && value >= 0) target.value = value;
      }
      targets.push(target);
    });
    return targets;
  }

  _clearResult(label) {
    if (this.busy) return;
    this.result = null;
    const comparison = this.root.querySelector('#dsgn-optimizer-comparison');
    const apply = this.root.querySelector('#dsgn-optimizer-apply');
    const status = this.root.querySelector('#dsgn-optimizer-progress-label');
    const fill = this.root.querySelector('#dsgn-optimizer-progress-fill');
    if (comparison) comparison.innerHTML = '<div class="dsgn-optimizer-empty"><strong>Configuration updated</strong><span>Run a new sweep to compare candidate settings.</span></div>';
    if (apply) apply.disabled = true;
    if (status) status.textContent = label;
    if (fill) fill.style.width = '0%';
    this._setError('');
  }

  _setBusy(busy) {
    this.busy = busy;
    const run = this.root.querySelector('#dsgn-optimizer-run');
    const apply = this.root.querySelector('#dsgn-optimizer-apply');
    if (run) {
      run.disabled = busy;
      run.textContent = busy ? 'Sweeping…' : 'Run sweep';
    }
    if (apply) apply.disabled = busy || !this.result?.updates?.length;
    this.root.querySelectorAll(
      '#dsgn-optimizer-scope, #dsgn-optimizer-preset, '
      + '[data-optimizer-target], [data-optimizer-target-value]',
    ).forEach(control => { control.disabled = busy; });
  }

  async _run() {
    if (this.busy || typeof this.onRun !== 'function') return;
    const targets = this._collectTargets();
    if (!targets.length) {
      this._setError('Select at least one target.');
      return;
    }
    if (targets.some(target => target.key === 'energy' && !Number.isFinite(target.value))) {
      this._setError('Enter a valid output-energy target.');
      return;
    }
    this._setError('');
    this.result = null;
    this._setBusy(true);
    const token = this._openToken;
    const comparison = this.root.querySelector('#dsgn-optimizer-comparison');
    if (comparison) comparison.innerHTML = '<div class="dsgn-optimizer-radar"><span></span><strong>Evaluating beam physics</strong><small>Each point is a complete lattice solve.</small></div>';
    try {
      const result = await this.onRun({
        scope: this.context.scope,
        selectedIndex: this.context.selectedIndex,
        targets,
      });
      if (!this.isOpen || token !== this._openToken || result?.canceled) return;
      this.result = result;
      this._renderResult();
    } finally {
      if (this.isOpen && token === this._openToken) this._setBusy(false);
    }
  }

  _renderResult() {
    const comparison = this.root.querySelector('#dsgn-optimizer-comparison');
    const status = this.root.querySelector('#dsgn-optimizer-progress-label');
    const note = this.root.querySelector('#dsgn-optimizer-progress-note');
    const fill = this.root.querySelector('#dsgn-optimizer-progress-fill');
    const apply = this.root.querySelector('#dsgn-optimizer-apply');
    if (!comparison || !this.result) return;
    const targets = this.result.targets || [];
    const rows = targets.map(target => {
      const key = target.key;
      const def = DESIGNER_OPTIMIZER_TARGETS[key];
      const improved = isImproved(key, this.result.before, this.result.after, target);
      const worse = isWorse(key, this.result.before, this.result.after, target);
      const tone = improved ? 'better' : (worse ? 'worse' : 'same');
      const arrow = improved ? '▲' : (worse ? '▼' : '—');
      return `<div class="dsgn-optimizer-result-row ${tone}">`
        + `<span><strong>${escapeHtml(def.label)}</strong><small>${targetDirection(def)}</small></span>`
        + `<span>${formatDesignerOptimizationMetric(key, this.result.before)}</span>`
        + `<span class="dsgn-optimizer-result-arrow">${arrow}</span>`
        + `<span>${formatDesignerOptimizationMetric(key, this.result.after)}</span></div>`;
    }).join('');
    const beforeScore = scoreDesignerOptimization(this.result.before, targets, this.result.before);
    const afterScore = scoreDesignerOptimization(this.result.after, targets, this.result.before);
    const gain = Number.isFinite(beforeScore) && Number.isFinite(afterScore)
      ? Math.max(0, Math.round((afterScore - beforeScore) * 100))
      : 0;
    comparison.innerHTML = '<div class="dsgn-optimizer-result-head"><span>Target</span><span>Before</span><span></span><span>Best</span></div>'
      + rows
      + `<div class="dsgn-optimizer-result-summary"><strong>${this.result.updates.length ? `+${gain} objective points` : 'Current settings retained'}</strong>`
      + `<span>${this.result.evaluations} solves · ${this.result.knobs.length} controls · ${this.result.updates.length} component updates</span></div>`;
    if (status) status.textContent = this.result.updates.length ? 'BETTER SOLUTION FOUND' : 'NO BETTER SOLUTION FOUND';
    if (note) note.textContent = this.result.updates.length
      ? 'Review the measured comparison, then apply it as one undoable edit.'
      : 'The current setpoints scored at least as well as every sampled candidate.';
    if (fill) fill.style.width = '100%';
    if (apply) apply.disabled = !this.result.updates.length;
  }

  async _apply() {
    if (this.busy || !this.result?.updates?.length || typeof this.onApply !== 'function') return;
    this._setBusy(true);
    try {
      const applied = await this.onApply(this.result);
      if (applied !== false) this.close();
    } finally {
      if (this.isOpen) this._setBusy(false);
    }
  }

  _setError(message) {
    const error = this.root?.querySelector('#dsgn-optimizer-error');
    if (error) error.textContent = message || '';
  }

  _showError(error) {
    console.error('[designer] optimizer failed', error);
    this._setError(error?.message || 'Optimizer failed. Try the sweep again.');
    if (this.isOpen) this._setBusy(false);
  }
}
