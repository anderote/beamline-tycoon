// src/ui/DesignLibrary.js — Designs library overlay for browsing and managing saved designs.

import { COMPONENTS } from '../data/components.js';

const CATEGORIES = [
  { key: 'all', name: 'All' },
  { key: 'linac', name: 'Linacs' },
  { key: 'storageRing', name: 'Storage Rings' },
  { key: 'fel', name: 'FEL' },
  { key: 'synchrotron', name: 'Synchrotrons' },
  { key: 'collider', name: 'Colliders' },
  { key: 'other', name: 'Other' },
];

export class DesignLibrary {
  constructor(game, designer, renderer) {
    this.game = game;
    this.designer = designer;
    this.renderer = renderer;
    this.overlay = document.getElementById('designs-overlay');
    this.activeCategory = 'all';
    this.onPlace = null;  // callback set externally for "Place" action
    this._suppressHashUpdate = false;

    this._bindClose();
  }

  _bindClose() {
    const closeBtn = this.overlay.querySelector('[data-close="designs-overlay"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
  }

  open() {
    this.overlay.classList.remove('hidden');
    this._renderTabs();
    this._renderGrid();
    window.location.hash = 'designs';
  }

  close() {
    this.overlay.classList.add('hidden');
    if (!this._suppressHashUpdate && window.location.hash === '#designs') {
      window.location.hash = 'game';
    }
    this._suppressHashUpdate = false;
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
      focusing: 'rgba(68, 136, 204, 0.6)',
      rf: 'rgba(204, 68, 68, 0.6)',
      diagnostic: 'rgba(200, 200, 200, 0.4)',
      beamOptics: 'rgba(68, 170, 204, 0.6)',
      endpoint: 'rgba(150, 150, 150, 0.5)',
    };
    return map[category] || 'rgba(100, 100, 140, 0.4)';
  }
}
