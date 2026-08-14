import { ContextWindow } from './ContextWindow.js';
import { staffHireCost } from '../game/staff/staffSystem.js';
import { renderBioCard } from './StaffBioCard.js';

export function openHiringDialog(game) {
  const winId = 'hiring-dialog';
  const existing = ContextWindow.getWindow(winId);
  if (existing) { existing.focus(); return existing; }

  const ctx = new ContextWindow({
    id: winId,
    title: 'Hire Staff — Candidates',
    icon: '🧑‍🔬',
    accentColor: '#44aa66',
  });

  function renderHiring(container) {
    const candidates = game.state.staffCandidates || [];
    const funding = game.state.resources?.funding ?? 0;
    if (candidates.length === 0) {
      container.innerHTML = '<div style="color:#888;font-size:8px;padding:12px;">No candidates available. (Pool refreshes soon)</div>';
      return;
    }
    // Footer markup (reroll hint) is a plain string; candidate cards are
    // built as real elements so renderBioCard's HTMLElement can drop in.
    const footerHtml = `<div style="margin-top:10px;display:flex;gap:8px;justify-content:space-between;align-items:center;">` +
      `<span style="font-size:7px;color:#666;">3 candidates • rerolls when pool < 2</span>` +
      `<button data-reroll style="font-family:monospace;font-size:9px;padding:4px 8px;background:rgba(30,30,60,0.8);color:#aaa;border:1px solid rgba(80,80,120,0.3);border-radius:3px;cursor:pointer;">Reroll</button>` +
      `</div>`;

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'hiring-grid';
    for (const c of candidates) {
      // Task 7 (staff-professions-3, jobs-and-gates) follow-up, fix round 1:
      // an admin's paperwork discount (state.staffHireDiscount) is applied
      // right here, the same way Game.js's hireStaffMember actually charges
      // it — this used to quote staffHireCost's bare number, which the real
      // hire would then undercut, the same "displayed number does not match
      // what happens" shape as the placement-ghost bug this plan already
      // fixed once (there: showed affordable, then refused; here: quotes
      // high, charges low — the benign direction, but still a wrong number
      // on screen).
      const discount = game.state.staffHireDiscount || 0;
      const cost = Math.round(staffHireCost(c, game.state.staffCosts || {}) * (1 - discount));
      const afford = funding >= cost;

      const card = document.createElement('div');
      card.className = 'hiring-card';
      card.appendChild(renderBioCard(c, { compact: true }));

      const costLine = document.createElement('div');
      costLine.className = 'hiring-cost';
      costLine.textContent = `$${cost.toLocaleString()} hire — $${(game.state.staffCosts?.[c.profession] || 0)}/tick`;
      card.appendChild(costLine);

      const hireBtn = document.createElement('button');
      hireBtn.className = 'hiring-hire-btn';
      hireBtn.setAttribute('data-hire-id', c.id);
      hireBtn.textContent = 'Hire';
      if (!afford) { hireBtn.disabled = true; hireBtn.title = 'Insufficient funding'; }
      card.appendChild(hireBtn);

      grid.appendChild(card);
    }
    container.appendChild(grid);

    const footer = document.createElement('div');
    footer.innerHTML = footerHtml;
    container.appendChild(footer.firstElementChild);

    // Wire hire buttons
    container.querySelectorAll('[data-hire-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.getAttribute('data-hire-id');
        const res = game.hireStaffMember(cid);
        if (res) {
          // refresh hiring dialog (candidates mutated)
          renderHiring(container);
          // if pool still has candidates, keep dialog open; hiring updates staff bar via staffChanged
        } else {
          // show feedback: re-render to update disabled state
          renderHiring(container);
        }
      });
    });
    const reroll = container.querySelector('[data-reroll]');
    if (reroll) reroll.addEventListener('click', () => {
      if (game._refreshStaffCandidates) game._refreshStaffCandidates();
      game.emit('staffChanged');
      renderHiring(container);
    });
  }

  const body = ctx._body;
  if (body) renderHiring(body);

  ctx.refresh = () => { if (ctx._body) renderHiring(ctx._body); };
  // Tab-less window: ContextWindow.update() -> _renderBody() would wipe the
  // body with no tab renderer to refill it. refresh() is the body render.
  ctx.update = () => ctx.refresh();

  // auto-refresh on staffChanged
  const handler = (ev) => { if (ev === 'staffChanged') ctx.refresh(); };
  const offStaff = game.on(handler);

  const origClose = ctx.close.bind(ctx);
  ctx.close = () => {
    offStaff();
    origClose();
  };

  ctx.setActions([{ label: 'Close', style: '', onClick: () => ctx.close() }]);

  return ctx;
}
