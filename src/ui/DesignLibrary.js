// src/ui/DesignLibrary.js — Designs library overlay for browsing and managing saved designs.
//
// Two stores are shown through one set of tabs, and they are not the same kind
// of thing. `state.savedDesigns` is the player's: editable, deletable, saved
// with the game. STOCK_DESIGNS is data shipped with the code — it cannot be
// edited or deleted, it is identical in every save, and it is versioned with
// the validator that measured it. The Stock tab is therefore read-only, and
// "Duplicate to My Designs" is the one deliberate door between them: it copies
// a blueprint into the player's store, where it becomes an ordinary design that
// no longer tracks the shipped one.

import { COMPONENTS } from '../data/components.js';
import { pushEscHandler } from './esc-stack.js';
import { STOCK_DESIGNS } from '../data/stock-designs.js';
import { getBeamlineType } from '../data/beamline-types.js';
import {
  stockDesignCost, formatMeasuredPerformance, MEASURED_CAVEAT,
} from './BeamlineTypePicker.js';

const CATEGORIES = [
  { key: 'all', name: 'All' },
  // Stock sits next to All rather than at the end: it is the folder a new
  // player should open first, and it is the only tab that is always populated.
  { key: 'stock', name: 'Stock' },
  { key: 'linac', name: 'Linacs' },
  { key: 'storageRing', name: 'Storage Rings' },
  { key: 'fel', name: 'FEL' },
  { key: 'synchrotron', name: 'Synchrotrons' },
  { key: 'collider', name: 'Colliders' },
  { key: 'other', name: 'Other' },
];

/**
 * Which saved-design category a duplicated blueprint lands in.
 *
 * The categories above predate beamline types and are a coarse shape taxonomy
 * ("is it a ring?"), not a synonym for BEAMLINE_TYPES — so this is a nearest
 * bucket, and anything unmapped is a linac because every type in the roster
 * except lightSource is built on a linear machine.
 */
const CATEGORY_FOR_TYPE = {
  lightSource: 'storageRing',
  xfel: 'fel',
  euvFel: 'fel',
  collider: 'collider',
};

export class DesignLibrary {
  constructor(game, designer, renderer) {
    this.game = game;
    this.designer = designer;
    this.renderer = renderer;
    this.overlay = document.getElementById('designs-overlay');
    this.activeCategory = 'all';
    this.onPlace = null;  // callback set externally for "Place" action
    this._suppressHashUpdate = false;
    this._modal = false;

    this._bindClose();
  }

  _bindClose() {
    const closeBtn = this.overlay.querySelector('[data-close="designs-overlay"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
  }

  open(modal = false) {
    this._modal = !!modal;
    // Esc closes the library. Pushed on open, so a modal library over the
    // designer sits above the designer's handler on the esc-stack — the
    // old capture-phase stopPropagation workaround is gone.
    if (!this._escUnsub) {
      this._escUnsub = pushEscHandler(() => {
        this.close();
        return true;
      });
    }
    this.overlay.classList.remove('hidden');
    this.overlay.classList.toggle('designs-modal', this._modal);
    this._renderTabs();
    this._renderGrid();
    if (!this._modal) window.location.hash = 'designs';
  }

  close() {
    this._escUnsub?.();
    this._escUnsub = null;
    this.overlay.classList.add('hidden');
    this.overlay.classList.remove('designs-modal');
    if (!this._modal && !this._suppressHashUpdate && window.location.hash === '#designs') {
      window.location.hash = 'game';
    }
    this._suppressHashUpdate = false;
    this._modal = false;
  }

  get isOpen() {
    return !this.overlay.classList.contains('hidden');
  }

  _renderTabs() {
    const container = document.getElementById('designs-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'designs-cat-tab' + (cat.key === this.activeCategory ? ' active' : '');
      btn.textContent = cat.name;
      btn.addEventListener('click', () => {
        this.activeCategory = cat.key;
        this._renderTabs();
        this._renderGrid();
      });
      container.appendChild(btn);
    }
  }

  _renderGrid() {
    const grid = document.getElementById('designs-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // The Stock tab is a catalogue, not a workspace: no "New Design" card,
    // because nothing the player makes can ever land in it.
    if (this.activeCategory === 'stock') {
      for (const design of STOCK_DESIGNS) {
        grid.appendChild(this._createStockCard(design));
      }
      return;
    }

    // "New Design" card
    const newCard = document.createElement('div');
    newCard.className = 'design-card design-card-new';
    newCard.textContent = '+ New Design';
    newCard.addEventListener('click', () => {
      this.close();
      this.designer.openDesign(null);
    });
    grid.appendChild(newCard);

    // Saved design cards
    const designs = this.game.getDesignsByCategory(this.activeCategory);
    for (const design of designs) {
      grid.appendChild(this._createCard(design));
    }
  }

  _createCard(design) {
    const card = document.createElement('div');
    card.className = 'design-card';

    // Mini schematic preview
    const preview = document.createElement('div');
    preview.className = 'design-card-preview';
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 60;
    this._drawMiniSchematic(canvas, design);
    preview.appendChild(canvas);
    card.appendChild(preview);

    // Body
    const body = document.createElement('div');
    body.className = 'design-card-body';

    const name = document.createElement('div');
    name.className = 'design-card-name';
    name.textContent = design.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'design-card-meta';
    const compCount = design.components.length;
    const totalLength = design.components.reduce((sum, c) => {
      const comp = COMPONENTS[c.type];
      return sum + (comp ? (comp.subL || 4) * 0.5 : 0);
    }, 0);
    const totalCost = design.components.reduce((sum, c) => {
      const comp = COMPONENTS[c.type];
      return sum + (comp?.cost?.funding || 0);
    }, 0);
    meta.textContent = `${compCount} parts \u00b7 ${totalLength.toFixed(1)}m \u00b7 $${totalCost.toLocaleString()}`;
    body.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'design-card-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      this.designer.openDesign(design);
    });
    actions.appendChild(editBtn);

    const placeBtn = document.createElement('button');
    placeBtn.textContent = 'Place';
    placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      if (this.onPlace) this.onPlace(design);
    });
    actions.appendChild(placeBtn);

    const dupeBtn = document.createElement('button');
    dupeBtn.textContent = 'Duplicate';
    dupeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.addDesign({
        name: design.name + ' (copy)',
        category: design.category,
        components: design.components.map(c => ({ ...c, params: { ...c.params } })),
      });
      this._renderGrid();
    });
    actions.appendChild(dupeBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${design.name}"?`)) {
        this.game.deleteDesign(design.id);
        this._renderGrid();
      }
    });
    actions.appendChild(deleteBtn);

    body.appendChild(actions);
    card.appendChild(body);

    // Click card to edit
    card.addEventListener('click', () => {
      this.close();
      this.designer.openDesign(design);
    });

    return card;
  }

  /**
   * A stock blueprint's card: everything _createCard shows, minus every action
   * that would mutate it.
   *
   * No Edit, no Delete, and the card body is not clickable — opening the
   * designer on a STOCK_DESIGNS entry would hand the player an editor over an
   * object with no id in `state.savedDesigns`, so saving would either do
   * nothing or silently fork it. Duplicate is that fork, made explicit.
   */
  _createStockCard(design) {
    const card = document.createElement('div');
    card.className = 'design-card design-card-stock';

    const preview = document.createElement('div');
    preview.className = 'design-card-preview';
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 60;
    this._drawMiniSchematic(canvas, design);
    preview.appendChild(canvas);
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'design-card-body';

    const head = document.createElement('div');
    head.className = 'design-card-head';
    const name = document.createElement('div');
    name.className = 'design-card-name';
    name.textContent = design.name;
    head.appendChild(name);
    const badge = document.createElement('span');
    badge.className = 'design-card-badge';
    badge.textContent = 'STOCK';
    badge.title = 'Ships with the game. Read-only — duplicate it to edit.';
    head.appendChild(badge);
    body.appendChild(head);

    const type = getBeamlineType(design.typeId);
    const meta = document.createElement('div');
    meta.className = 'design-card-meta';
    meta.textContent = [
      type ? type.name : design.typeId,
      `T${design.tier}`,
      `${design.components.length} parts`,
      `$${stockDesignCost(design).toLocaleString()}`,
    ].join(' · ');
    body.appendChild(meta);

    // Only ever the measured figure, never a derived one — a blueprint with no
    // entry in stock-designs.measured.json simply has no performance line.
    const perf = formatMeasuredPerformance(design.id);
    if (perf) {
      const measured = document.createElement('div');
      measured.className = 'design-card-measured';
      measured.textContent = `◈ ${perf}`;
      measured.title = MEASURED_CAVEAT;
      body.appendChild(measured);
    }

    const blurb = document.createElement('div');
    blurb.className = 'design-card-blurb';
    blurb.textContent = design.blurb;
    body.appendChild(blurb);

    const actions = document.createElement('div');
    actions.className = 'design-card-actions';

    const placeBtn = document.createElement('button');
    placeBtn.textContent = 'Place';
    placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      // Same callback the player's own designs go through, so the blueprint's
      // typeId gets armed on the way to the ghost (see main.js).
      if (this.onPlace) this.onPlace(design);
    });
    actions.appendChild(placeBtn);

    const dupeBtn = document.createElement('button');
    dupeBtn.textContent = 'Duplicate to My Designs';
    dupeBtn.title = 'Copy this blueprint into your own designs, where you can edit it.';
    dupeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Deep-copy the params: the copy is the player's to retune, and sharing
      // the objects would let editing it rewrite the shipped blueprint for the
      // rest of the session.
      this.game.addDesign({
        name: design.name,
        category: CATEGORY_FOR_TYPE[design.typeId] || 'linac',
        components: design.components.map(c => ({ ...c, params: { ...(c.params || {}) } })),
      });
      this.game.log?.(`Copied "${design.name}" to My Designs`, 'good');
      // Jump to where the copy actually landed, or the click looks like a no-op.
      this.activeCategory = 'all';
      this._renderTabs();
      this._renderGrid();
    });
    actions.appendChild(dupeBtn);

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  _drawMiniSchematic(canvas, design) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (design.components.length === 0) return;

    const compW = Math.min(40, (canvas.width - 20) / design.components.length);
    const compH = 20;
    const y = (canvas.height - compH) / 2;
    let x = 10;

    for (const c of design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      const color = this._getCategoryColor(comp.category);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, compW - 2, compH);

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, compW - 2, compH);

      x += compW;
    }
  }

  _getCategoryColor(category) {
    const map = {
      source: 'rgba(68, 204, 68, 0.6)',
      optics: 'rgba(68, 136, 204, 0.6)',
      rf: 'rgba(204, 68, 68, 0.6)',
      diagnostic: 'rgba(200, 200, 200, 0.4)',
      endpoint: 'rgba(150, 150, 150, 0.5)',
    };
    return map[category] || 'rgba(100, 100, 140, 0.4)';
  }
}
