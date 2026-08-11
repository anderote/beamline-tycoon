// EconomyWindow.js — Context window showing where the money came from and went.
//
// Every figure here is READ from what the tick recorded (Game.getEconomySnapshot),
// never recomputed. A second derivation of an economy term at the display site is
// the defect class closed in Phase 10 — it is how the HUD came to quote a user fee
// 50x off what was really paid. If a number is missing from the snapshot, the fix
// is to record it in tick(), not to work it out again here.
//
// The panel is a reader: it mutates no game state.

import { ContextWindow } from './ContextWindow.js';
import { fmtMoney, fmtNumber } from './format.js';

const WINDOW_ID = 'economy';

const INCOME_COLOR = '#44dd66';
const EXPENSE_COLOR = '#dd7744';

const SPARK_HEIGHT = 54;

// Signed money. fmtMoney floors, so -3.2 would render "$-4"; format the
// magnitude and carry the sign separately.
function fmtSigned(n) {
  const v = n || 0;
  return (v < 0 ? '-' : '+') + fmtMoney(Math.abs(v));
}

export class EconomyWindow {
  /** Open the panel, or close it if it is already open. */
  static toggle(game) {
    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) { existing.close(); return null; }
    return new EconomyWindow(game);
  }

  /** @param {object} game - Game instance */
  constructor(game) {
    this.game = game;

    // The registry dedupes by id; if one is already open just surface it and
    // take no second subscription.
    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    // Per-tick samples the snapshot cannot carry on its own: refills are event
    // costs (zero on most ticks) and capital is attributed by the resource
    // ledger rather than by the tick. Both are windowed to the same span as the
    // net history so the panel never quotes a wider window than it draws.
    this._refillWindow = [];
    this._capitalWindow = [];
    this._lastSampledTick = null;
    this._prevFunding = null;
    this._prevLedger = null;
    this._resetSampling();

    this.ctx = new ContextWindow({
      id: WINDOW_ID,
      title: 'Economy',
      icon: '$',
      accentColor: '#2a5f4a',
      tabs: [{ key: 'flow', label: 'Cash Flow' }],
      onClose: () => this._teardown(),
    });

    this.ctx.onTabRender('flow', (el) => this._render(el));

    // Game.on returns the unsubscribe; hold it and call it on close. Four
    // dialogs leaked listeners this way before it was fixed.
    this._off = this.game.on((event) => {
      if (event === 'loaded' || event === 'started') this._resetSampling();
      if (event !== 'tick' && event !== 'loaded' && event !== 'started') return;
      this.refresh();
    });

    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Sampling
  // ---------------------------------------------------------------------------

  /**
   * Funding movement the ledger accounts for, as of right now.
   *
   * `_resourceLedger` is the running total of credits/debits undo must NOT
   * reverse (tick income and upkeep, hires, research spend, reservoir refills);
   * `_resourceMark` is the boundary it was last folded at. Everything a gesture
   * spends is deliberately dropped from the ledger at gesture close, so the
   * funding movement the ledger does NOT explain is exactly the capital the
   * player built (or recovered by demolishing). Reads only — folding is the
   * ledger's own business.
   */
  _ledgerFunding() {
    const g = this.game;
    const ledger = g._resourceLedger || {};
    const mark = g._resourceMark || {};
    const funding = g.state.resources.funding || 0;
    return (ledger.funding || 0) + (funding - (mark.funding || 0));
  }

  _resetSampling() {
    this._refillWindow.length = 0;
    this._capitalWindow.length = 0;
    this._lastSampledTick = null;
    this._prevFunding = this.game.state.resources.funding || 0;
    this._prevLedger = this._ledgerFunding();
  }

  /** One sample per published snapshot; re-renders must not double-count. */
  _sample(snapshot, capacity) {
    if (!snapshot || snapshot.tick === this._lastSampledTick) return;
    this._lastSampledTick = snapshot.tick;

    const funding = this.game.state.resources.funding || 0;
    const ledger = this._ledgerFunding();
    const capital = (funding - this._prevFunding) - (ledger - this._prevLedger);
    this._prevFunding = funding;
    this._prevLedger = ledger;

    this._push(this._capitalWindow, capital, capacity);
    this._push(this._refillWindow, snapshot.upkeep.refills || 0, capacity);
  }

  _push(arr, value, capacity) {
    arr.push(value);
    if (arr.length > capacity) arr.splice(0, arr.length - capacity);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render(el) {
    const { snapshot, history, historyCapacity } = this.game.getEconomySnapshot();
    if (!snapshot) {
      el.innerHTML = '<div class="ctx-empty">No tick recorded yet.</div>';
      return;
    }
    this._sample(snapshot, historyCapacity);

    const { income, upkeep, net } = snapshot;
    const funding = this.game.state.resources.funding || 0;
    const spanTicks = this._capitalWindow.length;
    const capitalWindow = this._capitalWindow.reduce((s, v) => s + v, 0);
    const refillWindow = this._refillWindow.reduce((s, v) => s + v, 0);

    const netClass = net > 0 ? '' : net < 0 ? ' bad' : ' neutral';
    const beamNote = snapshot.contributingBeamlines === 1
      ? '1 beamline' : `${snapshot.contributingBeamlines} beamlines`;

    const incomeRows = [
      { label: 'Grant',      value: income.grant },
      { label: 'Reputation', value: income.reputation },
      { label: 'Beam',       value: income.beam, note: beamNote },
      { label: 'Data Fees',  value: income.dataFees },
    ];
    const expenseRows = [
      { label: 'Staff',   value: upkeep.staff },
      { label: 'Power',   value: upkeep.power },
      { label: 'Pumps',   value: upkeep.pumps },
      { label: 'Refills', value: upkeep.refills, note: `${fmtMoney(refillWindow)} / ${spanTicks}t` },
    ];

    // Runway: at this net, how long the current balance lasts.
    let runway = 'Sustainable';
    let runwayClass = '';
    if (net < 0) {
      if (funding <= 0) { runway = 'Insolvent'; runwayClass = ' bad'; }
      else {
        const ticks = funding / -net;
        runway = fmtNumber(ticks) + ' t';
        runwayClass = ticks < 60 ? ' bad' : ticks < 300 ? ' warn' : '';
      }
    }

    el.innerHTML = `
      <div class="econ-head">
        <div>
          <div class="econ-head-label">Net per tick</div>
          <div class="econ-head-val${netClass}">${fmtSigned(net)}</div>
        </div>
        <div class="econ-head-right">
          <div class="econ-head-label">Balance</div>
          <div class="econ-head-bal">${fmtMoney(funding)}</div>
        </div>
      </div>
      <canvas class="econ-spark"></canvas>
      <div class="ctx-section-label">Income · ${fmtMoney(income.total)} / t</div>
      ${this._rows(incomeRows, INCOME_COLOR, '')}
      <div class="ctx-section-label">Expenses · ${fmtMoney(upkeep.total)} / t</div>
      ${this._rows(expenseRows, EXPENSE_COLOR, '-')}
      <div class="ctx-section-label">Outlook</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat">
          <div class="ctx-stat-label">Runway</div>
          <div class="ctx-stat-val${runwayClass}">${runway}</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Capital · last ${spanTicks}t</div>
          <div class="ctx-stat-val${capitalWindow < 0 ? ' warn' : ' neutral'}">${fmtSigned(capitalWindow)}</div>
        </div>
      </div>
    `;

    this._drawSpark(el.querySelector('.econ-spark'), history, historyCapacity, el.clientWidth);
  }

  /** Term rows with bars scaled to the largest term in their own section. */
  _rows(rows, color, sign) {
    const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value || 0)), 0);
    return rows.map(({ label, value, note }) => {
      const v = value || 0;
      const pct = max > 0 ? (Math.abs(v) / max) * 100 : 0;
      const dim = v === 0 ? ' econ-row-zero' : '';
      return `
      <div class="econ-row${dim}">
        <span class="econ-row-label">${label}${note ? `<span class="econ-row-note">${note}</span>` : ''}</span>
        <span class="econ-row-bar"><span class="econ-row-fill" style="width:${pct.toFixed(1)}%;background:${color}"></span></span>
        <span class="econ-row-val" style="color:${color}">${v === 0 ? '' : sign}${fmtMoney(Math.abs(v))}</span>
      </div>`;
    }).join('');
  }

  /**
   * Net-per-tick window as signed columns anchored to the right edge, so a
   * partly-filled history reads as filling in rather than as stretched.
   */
  _drawSpark(canvas, history, capacity, bodyWidth) {
    if (!canvas) return;
    const w = Math.max(120, (bodyWidth || 536) - 24);
    canvas.width = w;
    canvas.height = SPARK_HEIGHT;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, w, SPARK_HEIGHT);

    let lo = 0, hi = 0;
    for (const v of history) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const yOf = (v) => SPARK_HEIGHT - ((v - lo) / (hi - lo)) * SPARK_HEIGHT;

    const zeroY = yOf(0);
    c.fillStyle = 'rgba(80, 80, 120, 0.35)';
    c.fillRect(0, Math.round(zeroY), w, 1);

    const bw = w / capacity;
    const left = w - history.length * bw;
    for (let i = 0; i < history.length; i++) {
      const v = history[i];
      const y = yOf(v);
      const x = left + i * bw;
      const top = Math.min(y, zeroY);
      const h = Math.max(1, Math.abs(y - zeroY));
      c.fillStyle = v < 0 ? EXPENSE_COLOR : INCOME_COLOR;
      c.fillRect(x, top, Math.max(1, bw), h);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  refresh() {
    if (!this.ctx || !this.ctx._el) return;
    const net = this.game.getEconomySnapshot().snapshot?.net ?? 0;
    this.ctx.setStatus(fmtSigned(net) + '/t', net < 0 ? '#ff4444' : '#44dd66');
    this.ctx.update();
  }

  _teardown() {
    if (this._off) { this._off(); this._off = null; }
  }

  close() {
    if (this.ctx) this.ctx.close();
  }
}
