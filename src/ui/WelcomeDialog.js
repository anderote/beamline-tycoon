// src/ui/WelcomeDialog.js — first-run welcome/goals popup.
// Shown automatically on a fresh game (game.state.welcomeSeen unset) once the
// player is actually looking at the game; reopenable anytime via Menu > Guide.
// Draggable by its header (same pattern as the component popup in overlays.js).

import { makeDraggable } from './draggable.js';

const MODE_ROWS = [
  ['1', 'Beamline',  '#6ee06e', 'sources, magnets, RF cavities, diagnostics + beam pipes'],
  ['2', 'Infra',     '#e0c86e', 'power, vacuum, RF power, cooling & data utilities'],
  ['3', 'Facility',  '#6ec8e0', 'assign zones — labs, control room, offices, cafeteria'],
  ['4', 'Structure', '#c8b49a', 'floors, walls, doors & shielding'],
  ['5', 'Grounds',   '#9ade7a', 'outdoor decoration — paths, trees, fences, lighting'],
  ['6', 'Demolish',  '#ff7a66', 'tear things back down'],
];

// Only bindings verified in InputHandler.js / ThreeRenderer.js.
const CONTROL_ROWS = [
  ['WASD',   'pan camera (Shift = fast)'],
  ['Scroll', 'zoom in / out'],
  ['Q / E',  'rotate the view'],
  ['Mid-drag', 'orbit the camera'],
  ['F',      'rotate item while placing'],
  ['M',      'mirror utility ports while placing'],
  ['Space',  'place item / beam ON-OFF'],
  ['Ctrl+Z', 'undo'],
  ['Ctrl+Shift+Z', 'redo'],
  ['Esc',    'cancel tool / close windows'],
];

export class WelcomeDialog {
  constructor(onDismiss) {
    this.onDismiss = onDismiss || null;
    this.el = null;
  }

  open() {
    if (!this.el) this._build();
    this.el.classList.remove('hidden');
  }

  close() {
    if (this.el) this.el.classList.add('hidden');
    if (this.onDismiss) this.onDismiss();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'welcome-dialog';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'welcome-dialog-title');

    const modeRows = MODE_ROWS.map(([key, name, color, desc]) =>
      `<div class="welcome-kbd welcome-mode-key">${key}</div>` +
      `<div class="welcome-mode-name" style="color:${color}">${name}</div>` +
      `<div class="welcome-mode-desc">${desc}</div>`
    ).join('');

    const controlRows = CONTROL_ROWS.map(([key, desc]) =>
      `<div class="welcome-control"><span class="welcome-kbd">${key}</span>` +
      `<span class="welcome-control-desc">${desc}</span></div>`
    ).join('');

    el.innerHTML = `
      <div class="welcome-header">
        <span class="welcome-title" id="welcome-dialog-title">Welcome to Beamline Tycoon</span>
        <button type="button" class="welcome-close" title="Close" aria-label="Close">×</button>
      </div>
      <div class="welcome-body">
        <div class="welcome-tagline">Your particle accelerator empire starts as an empty field. Here's the plan, Director:</div>
        <div class="welcome-section-title">Goals</div>
        <ul class="welcome-goals">
          <li>Pour a concrete pad and raise an <b>accelerator hall</b> (Structure mode) to house your beamline components.</li>
          <li>Lay laboratory flooring and assign lab space with <b>zones</b> (Facility mode).</li>
          <li>Purchase better equipment and <b>research upgrades</b> to improve your beamline's properties.</li>
          <li><b>Hire staff</b> to keep the whole thing running.</li>
        </ul>
        <div class="welcome-section-title">Build Modes <span class="welcome-subtle">— bottom bar, keys 1–6</span></div>
        <div class="welcome-modes">${modeRows}</div>
        <div class="welcome-section-title">Controls</div>
        <div class="welcome-controls">${controlRows}</div>
        <div class="welcome-tip">Press <span class="welcome-kbd welcome-kbd-inline">\`</span> anytime for the full hotkey bar &nbsp;·&nbsp; reopen this guide via <b>Menu &gt; Guide</b></div>
      </div>
      <div class="welcome-footer">
        <button type="button" class="welcome-go">LET'S GO</button>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('.welcome-go').addEventListener('click', () => this.close());
    el.querySelector('.welcome-close').addEventListener('click', () => this.close());

    // Draggable by header (mirrors the component-popup drag in overlays.js).
    makeDraggable(el, el.querySelector('.welcome-header'), {
      exclude: '.welcome-close',
      freezeTransform: true,
      grabCursor: true,
    });
  }
}
