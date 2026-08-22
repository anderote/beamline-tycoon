import { ContextWindow } from './ContextWindow.js';
import { ROLE_COLORS, escapeHtml } from './format.js';
import { renderBioCard } from './StaffBioCard.js';
import { describeJob } from '../game/staff/staffDiagnostics.js';

export function openStaffInspector(game, staffId, { onPickUp } = {}) {
  const m = (game.state.staffMembers || []).find(s => s.id === staffId);
  if (!m) return null;
  const winId = 'staff-' + staffId;
  const existing = ContextWindow.getWindow(winId);
  if (existing) { existing.focus(); return existing; }

  const ctx = new ContextWindow({
    id: winId,
    title: `${m.name} — ${m.profession}`,
    icon: '👤',
    accentColor: ROLE_COLORS[m.profession] || '#4466aa',
  });

  // store refs for refresh
  ctx._staffId = staffId;
  ctx._game = game;

  function renderInspector(container) {
    const staff = (game.state.staffMembers || []).find(s => s.id === staffId);
    if (!staff) { container.innerHTML = '<div class="ui-empty-state">Staff not found (released)</div>'; return; }
    container.innerHTML = '';
    container.appendChild(renderBioCard(staff));

    let html = '';
    // Work — Task 8 (staff-professions-3, jobs-and-gates) idle legibility:
    // the same per-staffer status/station text the facility staffing banner
    // groups across the whole roster (staffDiagnostics.js's describeJob),
    // so a player who clicked in from the banner reads the exact fact the
    // banner already summarized, not a differently-worded re-derivation.
    const work = describeJob(staff, game);
    html += `<div class="ctx-section-label">Work</div>`;
    html += `<div class="staff-work-status">${escapeHtml(work.status)}</div>`;
    if (work.station) {
      html += `<div class="staff-work-station">${escapeHtml(work.station)}</div>`;
    }
    const officeZone = staff.assignment?.zoneId === 'privateOffice'
      ? 'privateOffice' : staff.assignment?.zoneId === 'officeSpace' ? 'officeSpace' : '';
    html += `<label class="staff-office-assignment">Office assignment
      <select class="staff-office-select">
        <option value="" ${officeZone === '' ? 'selected' : ''}>No dedicated office</option>
        <option value="officeSpace" ${officeZone === 'officeSpace' ? 'selected' : ''}>Shared office</option>
        <option value="privateOffice" ${officeZone === 'privateOffice' ? 'selected' : ''}>Private office</option>
      </select>
    </label>`;

    // History
    if (staff.history && staff.history.length) {
      html += `<div class="ctx-section-label">History</div>`;
      html += `<div class="staff-history">`;
      for (const h of staff.history.slice(-5)) {
        html += `<div class="staff-history-entry">tick ${h.tick}: ${h.event} ${h.note ? '— ' + h.note : ''}</div>`;
      }
      html += `</div>`;
    }

    const rest = document.createElement('div');
    rest.innerHTML = html;
    container.appendChild(rest);
    const officeSelect = rest.querySelector('.staff-office-select');
    officeSelect?.addEventListener('change', () => {
      if (officeSelect.value) game.assignStaffToOffice(staff.id, officeSelect.value);
      else game.assignStaff(staff.id, null);
      ctx.refresh();
    });
  }

  ctx.onTabRender = ctx.onTabRender || function() {};
  // Use a single default tab render (no tabs, body is main)
  // ContextWindow with no tabs uses _renderBody which checks activeTab; we instead directly fill body
  // We'll monkey-patch by setting activeTab null and overriding update
  // Simpler: manually fill body and set actions
  const body = ctx._body;
  if (body) renderInspector(body);

  // Keep actions: Fire button
  // auto-refresh on staffChanged
  const _staffHandler = (ev) => { if (ev === 'staffChanged') { try { ctx.refresh(); } catch(_){} } };
  const offStaff = game.on(_staffHandler);

  ctx.setActions([
    { label: 'Pick up', title: 'Pick up this person with the tweezers', onClick: () => {
      if (typeof onPickUp === 'function') onPickUp(staffId);
      else game.emit?.('staffPickupRequested', staffId);
    }},
    { label: 'Fire', variant: 'danger', onClick: () => {
      if (confirm(`Fire ${m.name}?`)) {
        const ok = game.fireStaffMember(staffId);
        if (ok) ctx.close();
        else {
          // refresh to show log message
          ctx.update();
        }
      }
    }},
    { label: 'Close', style: '', onClick: () => ctx.close() },
  ]);

  // Refresh support
  ctx.refresh = () => {
    if (ctx._body) renderInspector(ctx._body);
    // update title in case name changed
    const staff = (game.state.staffMembers || []).find(s => s.id === staffId);
    if (staff) ctx.setTitle(`${staff.name} — ${staff.profession} (${staff.mood})`);
  };
  // This window has no tabs, so ContextWindow.update() -> _renderBody() would
  // clear the body and find no tab renderer to refill it — every update()
  // blanked the window until the next 'staffChanged' emit. refresh() IS the
  // body render here, so update() is just an alias for it.
  ctx.update = () => ctx.refresh();

  // Unsubscribe from game events when the window closes
  const origClose = ctx.close.bind(ctx);
  ctx.close = () => { offStaff(); origClose(); };

  return ctx;
}
