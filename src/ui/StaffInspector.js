import { ContextWindow } from './ContextWindow.js';
import { ZONES } from '../data/facility.js';
import { traitDesc } from '../game/staff/StaffMember.js';
import { ROLE_COLORS, staffInitials, staffMoodColor } from './format.js';

export function openStaffInspector(game, staffId) {
  const m = (game.state.staffMembers || []).find(s => s.id === staffId);
  if (!m) return null;
  const winId = 'staff-' + staffId;
  const existing = ContextWindow.getWindow(winId);
  if (existing) { existing.focus(); return existing; }

  const ctx = new ContextWindow({
    id: winId,
    title: `${m.name} — ${m.role}`,
    icon: '👤',
    accentColor: ROLE_COLORS[m.role] || '#4466aa',
  });

  // store refs for refresh
  ctx._staffId = staffId;
  ctx._game = game;

  function renderInspector(container) {
    const staff = (game.state.staffMembers || []).find(s => s.id === staffId);
    if (!staff) { container.innerHTML = '<div style="color:#888;font-size:8px;padding:12px;">Staff not found (released)</div>'; return; }
    const name = staff.name || staff.id;
    const role = staff.role || 'unknown';
    const mood = staff.mood || 'content';
    const status = staff.status || 'idle';
    const needs = staff.needs || { fatigue:0, hunger:0, morale:0.5 };
    const skills = staff.skills || {};
    const traits = staff.traits || [];
    const assignment = staff.assignment || { zoneId:null, beamlineId:null };
    const shift = staff.shift || 'flex';

    let html = '';
    // Header: name + mood + status
    html += `<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">`;
    html += `<div style="width:32px;height:32px;border:2px solid ${staffMoodColor(mood)};background:#1a1a2e;border-radius:3px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:8px;color:#fff;flex-shrink:0;">${staffInitials(name)}</div>`;
    html += `<div>`;
    html += `<div style="color:#ccddff;font-size:10px;">${name}</div>`;
    html += `<div style="color:#888;font-size:7px;text-transform:capitalize;">${role} — ${mood} — ${status}</div>`;
    html += `</div></div>`;

    // Traits
    html += `<div class="ctx-section-label">Traits</div>`;
    if (traits.length === 0) html += `<div style="color:#666;font-size:7px;">None</div>`;
    else {
      html += `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:6px;">`;
      for (const t of traits) {
        const d = traitDesc(t);
        html += `<div style="background:rgba(20,20,40,0.8);border:1px solid rgba(80,80,120,0.25);border-radius:3px;padding:4px 6px;color:#aacc88;font-size:7px;">${d}</div>`;
      }
      html += `</div>`;
    }

    // Skills with bars 0-10
    html += `<div class="ctx-section-label">Skills (0–10)</div>`;
    const skillKeys = ['operating','technical','research','construction'];
    for (const k of skillKeys) {
      const v = typeof skills[k] === 'number' ? skills[k] : 0;
      const pct = Math.max(0, Math.min(10, v)) / 10 * 100;
      const col = v >= 7 ? '#44dd66' : v >= 4 ? '#ddaa22' : '#888';
      html += `<div class="staff-skill-row"><span class="staff-skill-name">${k}</span><div class="staff-bar-track"><div class="staff-bar-fill" style="width:${pct}%;background:${col};"></div></div><span class="staff-skill-val">${v.toFixed(1)}</span></div>`;
    }

    // Needs with pct bars
    html += `<div class="ctx-section-label">Needs — Mood: ${mood}</div>`;
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
      html += `<div class="staff-need-row"><span class="staff-bar-label">${n.label}</span><div class="staff-bar-track"><div class="staff-bar-fill" style="width:${pct}%;background:${col};"></div></div><span style="font-size:7px;color:#888;width:32px;text-align:right;">${Math.round(pct)}%</span></div>`;
    }

    // Assignment
    html += `<div class="ctx-section-label">Assignment</div>`;
    html += `<div style="display:flex;flex-direction:column;gap:6px;">`;
    html += `<div style="display:flex;gap:6px;align-items:center;">`;
    html += `<label style="font-size:7px;color:#888;width:40px;">Zone</label>`;
    html += `<select data-assign-zone style="flex:1;background:rgba(20,20,40,0.9);color:#aaa;border:1px solid rgba(80,80,120,0.3);border-radius:3px;font-family:monospace;font-size:10px;padding:3px;">`;
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
    html += `<div style="display:flex;gap:6px;align-items:center;">`;
    html += `<label style="font-size:7px;color:#888;width:40px;">Beam</label>`;
    html += `<select data-assign-beam style="flex:1;background:rgba(20,20,40,0.9);color:#aaa;border:1px solid rgba(80,80,120,0.3);border-radius:3px;font-family:monospace;font-size:10px;padding:3px;">`;
    html += `<option value="">None</option>`;
    for (const bl of beamlines) {
      const id = bl.id || bl.beamlineId || 'unknown';
      const sel = assignment.beamlineId === id ? ' selected' : '';
      html += `<option value="${id}"${sel}>${id}</option>`;
    }
    html += `</select></div>`;

    // Shift toggle
    html += `<div style="display:flex;gap:6px;align-items:center;">`;
    html += `<label style="font-size:7px;color:#888;width:40px;">Shift</label>`;
    html += `<select data-assign-shift style="flex:1;background:rgba(20,20,40,0.9);color:#aaa;border:1px solid rgba(80,80,120,0.3);border-radius:3px;font-family:monospace;font-size:10px;padding:3px;">`;
    for (const s of ['day','night','flex']) {
      const sel = shift === s ? ' selected' : '';
      html += `<option value="${s}"${sel}>${s}</option>`;
    }
    html += `</select></div>`;
    html += `</div>`;

    // History
    if (staff.history && staff.history.length) {
      html += `<div class="ctx-section-label">History</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:2px;">`;
      for (const h of staff.history.slice(-5)) {
        html += `<div style="font-size:7px;color:#666;">tick ${h.tick}: ${h.event} ${h.note ? '— ' + h.note : ''}</div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;

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
    { label: 'Fire', style: 'color:#ff8888;border-color:rgba(180,80,80,0.4)', onClick: () => {
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
    if (staff) ctx.setTitle(`${staff.name} — ${staff.role} (${staff.mood})`);
  };
  // Make update() call refresh
  const origUpdate = ctx.update.bind(ctx);
  ctx.update = () => { ctx.refresh(); origUpdate(); };

  // Unsubscribe from game events when the window closes
  const origClose = ctx.close.bind(ctx);
  ctx.close = () => { offStaff(); origClose(); };

  return ctx;
}
