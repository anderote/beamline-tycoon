import { ContextWindow } from './ContextWindow.js';
import { staffHireCost } from '../game/staff/staffSystem.js';
import { renderBioCard } from './StaffBioCard.js';

// Task 7 (staff-professions-3, jobs-and-gates) follow-up, fix round 2: an
// admin's paperwork discount (state.staffHireDiscount — jobEffects/
// paperwork.js), applied the exact same way Game.js's hireStaffMember
// actually charges it. Exported and used for BOTH the displayed price AND
// the affordability check below, from this one function, on purpose: a
// reviewer traced a real bug in an earlier draft of this file where the
// price label read the discounted cost but the affordability check (and so
// hireBtn.disabled) still read the undiscounted one — a player holding a
// 40% discount could see "Insufficient funding" and a disabled Hire button
// for a candidate they could actually afford, making the discount this
// task exists to grant invisible and unusable at exactly the funding
// boundary where it matters. Routing both consumers through this single
// function is what makes that specific class of bug structurally
// impossible going forward, not just fixed once — see
// test/test-hiring-dialog.js's own boundary-case test.
export function hiringCandidateCost(candidate, game) {
  const discount = game.state.staffHireDiscount || 0;
  return Math.round(staffHireCost(candidate, game.state.staffCosts || {}) * (1 - discount));
}

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
      container.innerHTML = '<div class="ui-empty-state">No candidates available. (Pool refreshes soon)</div>';
      return;
    }
    // Footer markup (reroll hint) is a plain string; candidate cards are
    // built as real elements so renderBioCard's HTMLElement can drop in.
    const footerHtml = `<div class="hiring-footer">` +
      `<span class="hiring-note">One candidate per profession</span>` +
      `<button type="button" class="ui-button ui-button-compact" data-reroll>Reroll all</button>` +
      `</div>`;

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'hiring-grid';
    for (const c of candidates) {
      // Both the price label below and the afford/disabled gate derive from
      // this ONE call — see hiringCandidateCost's own header for the bug
      // that shape closes.
      const cost = hiringCandidateCost(c, game);
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
      if (game.refreshStaffCandidates) game.refreshStaffCandidates();
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
