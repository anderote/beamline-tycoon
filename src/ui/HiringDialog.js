import { ContextWindow } from './ContextWindow.js';
import { traitDesc } from '../game/staff/StaffMember.js';
import { staffHireCost } from '../game/staff/staffSystem.js';

const ROLE_COLORS = {
  operator: '#44aa66',
  technician: '#aa6633',
  scientist: '#4488ff',
  engineer: '#aa8833',
};

function initials(name) {
  if (!name) return '?';
  const parts = name.split(' ');
  if (parts.length >= 2) return (parts[0][0] || '') + (parts[1][0] || '');
  return name.slice(0,2).toUpperCase();
}

function moodBorder(mood) {
  if (mood === 'stressed') return '#ff4444';
  if (mood === 'tired') return '#ddaa22';
  return '#44dd66';
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
      container.innerHTML = '<div style="color:#888;font-size:8px;padding:12px;">No candidates available. (Pool refreshes soon)</div>';
      return;
    }
    let html = '<div class="hiring-grid">';
    for (const c of candidates) {
      const cost = staffHireCost(c.role, game.state.staffCosts || {});
      const afford = funding >= cost;
      const traits = (c.traits || []).map(t => traitDesc(t)).join('<br>');
      const skills = c.skills ? Object.entries(c.skills).map(([k,v]) => `${k}: ${Number(v).toFixed(1)}`).join('<br>') : '';
      const mood = c.mood || 'content';
      const roleColor = ROLE_COLORS[c.role] || '#4466aa';
      html += `<div class="hiring-card">`;
      html += `<div class="hiring-card-header">`;
      html += `<div class="hiring-portrait" style="background:${roleColor};border-color:${moodBorder(mood)};">${initials(c.name)}</div>`;
      html += `<div><div class="hiring-name">${c.name}</div><div class="hiring-role">${c.role}</div></div>`;
      html += `</div>`;
      html += `<div class="hiring-traits">${traits || 'No traits'}</div>`;
      html += `<div class="hiring-skills">${skills}</div>`;
      html += `<div class="hiring-cost">$${cost.toLocaleString()} hire — $${(game.state.staffCosts?.[c.role + 's'] || game.state.staffCosts?.[c.role] || 0)}/tick</div>`;
      html += `<button class="hiring-hire-btn" data-hire-id="${c.id}" ${!afford ? 'disabled title="Insufficient funding"' : ''}>Hire</button>`;
      html += `</div>`;
    }
    html += '</div>';
    // footer: reroll hint
    html += `<div style="margin-top:10px;display:flex;gap:8px;justify-content:space-between;align-items:center;">`;
    html += `<span style="font-size:7px;color:#666;">3 candidates • rerolls when pool < 2</span>`;
    html += `<button data-reroll style="font-family:monospace;font-size:9px;padding:4px 8px;background:rgba(30,30,60,0.8);color:#aaa;border:1px solid rgba(80,80,120,0.3);border-radius:3px;cursor:pointer;">Reroll</button>`;
    html += `</div>`;
    container.innerHTML = html;

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
  const origUpdate = ctx.update.bind(ctx);
  ctx.update = () => { ctx.refresh(); origUpdate(); };

  // auto-refresh on staffChanged
  const handler = (ev) => { if (ev === 'staffChanged') ctx.refresh(); };
  game.on(handler);

  const origClose = ctx.close.bind(ctx);
  ctx.close = () => {
    // remove listener? Game.on has no off, but ok
    origClose();
  };

  ctx.setActions([{ label: 'Close', style: '', onClick: () => ctx.close() }]);

  return ctx;
}
