import { ContextWindow } from './ContextWindow.js';
import { ZONES } from '../data/facility.js';
import { ROLE_COLORS, escapeHtml } from './format.js';
import { renderBioCard } from './StaffBioCard.js';
import { describeJob } from '../game/staff/staffDiagnostics.js';

export function openStaffInspector(game, staffId) {
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
    const mood = staff.mood || 'content';
    const status = staff.status || 'idle';
    const needs = staff.needs || { fatigue:0, hunger:0, morale:0.5 };
    const assignment = staff.assignment || { zoneId:null, beamlineId:null };
    const shift = staff.shift || 'flex';

    container.innerHTML = '';
    container.appendChild(renderBioCard(staff));

    let html = '';
    // Needs with pct bars
    html += `<div class="ctx-section-label">Needs — Mood: ${mood} — ${status}</div>`;
    const needsList = [
      { key:'fatigue', label:'Fatigue', val: needs.fatigue ?? 0, invert:false },
      { key:'hunger', label:'Hunger', val: needs.hunger ?? 0, invert:false },
      { key:'morale', label:'Morale', val: needs.morale ?? 0, invert:true },
    ];
    for (const n of needsList) {
      const v = Math.max(0, Math.min(1, n.val));
      const pct = v * 100;
      let col;
      if (n.key === 'morale') {
        col = v > 0.5 ? '#44dd66' : v > 0.2 ? '#ddaa22' : '#ff4444';
      } else {
        col = v > 0.8 ? '#ff4444' : v > 0.5 ? '#ddaa22' : '#44dd66';
      }
      // for morale show filled as morale, for fatigue/hunger higher is bad but still show bar length = value
      html += `<div class="staff-need-row"><span class="staff-bar-label">${n.label}</span><div class="staff-bar-track"><div class="staff-bar-fill" style="width:${pct}%;background:${col};"></div></div><span class="staff-need-value">${Math.round(pct)}%</span></div>`;
    }

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

    // Assignment
    html += `<div class="ctx-section-label">Assignment</div>`;
    html += `<div class="staff-assignment-list">`;
    html += `<div class="staff-assignment-row">`;
    html += `<label class="staff-assignment-label">Zone</label>`;
    html += `<select class="ui-select staff-assignment-select" data-assign-zone>`;
    html += `<option value="">Unassigned</option>`;
    for (const zid of Object.keys(ZONES)) {
      const sel = assignment.zoneId === zid ? ' selected' : '';
      html += `<option value="${zid}"${sel}>${ZONES[zid].name}</option>`;
    }
    html += `</select></div>`;

    // Beamline assignment
    const beamlines = (() => {
      try { return game.registry ? game.registry.getAll() : []; } catch(_) { return []; }
    })();
    html += `<div class="staff-assignment-row">`;
    html += `<label class="staff-assignment-label">Beam</label>`;
    html += `<select class="ui-select staff-assignment-select" data-assign-beam>`;
    html += `<option value="">None</option>`;
    for (const bl of beamlines) {
      const id = bl.id || bl.beamlineId || 'unknown';
      const sel = assignment.beamlineId === id ? ' selected' : '';
      html += `<option value="${id}"${sel}>${id}</option>`;
    }
    html += `</select></div>`;

    // Shift toggle
    html += `<div class="staff-assignment-row">`;
    html += `<label class="staff-assignment-label">Shift</label>`;
    html += `<select class="ui-select staff-assignment-select" data-assign-shift>`;
    for (const s of ['day','night','flex']) {
      const sel = shift === s ? ' selected' : '';
      html += `<option value="${s}"${sel}>${s}</option>`;
    }
    html += `</select></div>`;
    html += `</div>`;

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

    // Wire assignment dropdowns
    const zoneSel = container.querySelector('[data-assign-zone]');
    const beamSel = container.querySelector('[data-assign-beam]');
    const shiftSel = container.querySelector('[data-assign-shift]');
    if (zoneSel) zoneSel.addEventListener('change', () => {
      const zoneId = zoneSel.value || null;
      const beamId = beamSel ? (beamSel.value || null) : null;
      game.assignStaff(staffId, zoneId, beamId);
      // update title accent if needed
      ctx.update();
    });
    if (beamSel) beamSel.addEventListener('change', () => {
      const zoneId = zoneSel ? (zoneSel.value || null) : (assignment.zoneId || null);
      const beamId = beamSel.value || null;
      game.assignStaff(staffId, zoneId, beamId);
      ctx.update();
    });
    if (shiftSel) shiftSel.addEventListener('change', () => {
      const s = (game.state.staffMembers || []).find(x => x.id === staffId);
      if (s) { s.shift = shiftSel.value; game.emit('staffChanged'); }
      ctx.update();
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
