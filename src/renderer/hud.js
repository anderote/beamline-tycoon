// === HUD EXTENSION ===
// Adds HUD update, palette rendering, beam button, and system stats to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer, isFacilityCategory } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, ZONE_TIER_THRESHOLDS } from '../data/infrastructure.js';
import { MODES, CONNECTION_TYPES } from '../data/modes.js';
import { DECORATIONS } from '../data/decorations.js';
import { MACHINE_TYPES, MACHINE_TIER, MACHINES } from '../data/machines.js';
import { formatEnergy, UNITS } from '../data/units.js';

// --- HUD updates ---

Renderer.prototype._updateHUD = function() {
  const s = this.game.state;
  const res = s.resources;

  // Resources
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof val === 'string' ? val : this._fmt(val);
  };
  setEl('val-funding', Math.floor(res.funding));
  const ss = this.game.state.systemStats;
  if (ss && ss.power) {
    setEl('val-energy', `${Math.round(ss.power.totalDraw)}/${Math.round(ss.power.capacity)}`);
  } else {
    setEl('val-energy', '--');
  }
  setEl('val-reputation', Math.floor(res.reputation));
  setEl('val-data', Math.floor(res.data));

  // Beam stats (top-left panel) — show selected beamline or facility summary
  const selectedId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
  const selectedEntry = selectedId ? this.game.registry.get(selectedId) : null;

  if (selectedEntry) {
    const bs = selectedEntry.beamState;
    if (bs.beamEnergy) {
      const e = formatEnergy(bs.beamEnergy);
      setEl('stat-beam-energy', e.val);
      setEl('stat-beam-energy-unit', e.unit);
    } else {
      setEl('stat-beam-energy', '0.0');
      setEl('stat-beam-energy-unit', 'GeV');
    }
    setEl('stat-beam-quality', bs.beamQuality ? bs.beamQuality.toFixed(2) : '--');
    setEl('stat-beam-current', bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--');
    setEl('stat-data-rate', bs.dataRate ? bs.dataRate.toFixed(1) : '0');
    setEl('stat-length', bs.totalLength || 0);
    setEl('stat-energy-cost', bs.totalEnergyCost || 0);
  } else {
    // Facility summary — aggregate across all beamlines
    const entries = this.game.registry.getAll();
    const totalDataRate = entries.reduce((sum, e) => sum + (e.beamState.dataRate || 0), 0);
    const totalEnergyCost = entries.reduce((sum, e) => sum + (e.beamState.totalEnergyCost || 0), 0);
    setEl('stat-beam-energy', '--');
    setEl('stat-beam-energy-unit', '');
    setEl('stat-beam-quality', '--');
    setEl('stat-beam-current', '--');
    setEl('stat-data-rate', totalDataRate ? totalDataRate.toFixed(1) : '0');
    setEl('stat-length', '--');
    setEl('stat-energy-cost', totalEnergyCost || 0);
  }

  this._updateBeamSummary();

  // Refresh system stats if panel is visible
  this._refreshSystemStatsValues();

  // Refresh any open beamline context windows
  this._refreshContextWindows();

};

Renderer.prototype._updateBeamSummary = function() {
  const el = document.getElementById('beam-summary');
  if (!el) return;
  const entries = this.game.registry.getAll();
  const running = entries.filter(e => e.status === 'running').length;
  const total = entries.length;
  if (total === 0) {
    el.textContent = 'No beamlines';
    el.className = 'beam-summary';
  } else {
    el.textContent = `${running}/${total} beamlines running`;
    el.className = running > 0 ? 'beam-summary active' : 'beam-summary';
  }
};

// --- Palette rendering ---

Renderer.prototype._generateCategoryTabs = function() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES[this.activeMode];
  if (!mode || mode.disabled) return;

  const catKeys = Object.keys(mode.categories);
  catKeys.forEach((key, idx) => {
    const cat = mode.categories[key];
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (idx === 0 ? ' active' : '');
    btn.dataset.category = key;
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this._renderPalette(key);
      this._updateSystemStatsContent(key);
      if (this._onTabSelect) this._onTabSelect(key);
    });
    tabsContainer.appendChild(btn);
  });

  // Generate connection tool buttons (always visible)
  const connContainer = document.getElementById('connection-tools');
  if (connContainer && connContainer.children.length === 0) {
    for (const [key, conn] of Object.entries(CONNECTION_TYPES)) {
      const btn = document.createElement('button');
      btn.className = 'conn-btn';
      btn.dataset.connType = key;
      btn.textContent = conn.name;
      const hex = '#' + conn.color.toString(16).padStart(6, '0');
      btn.style.color = hex;
      btn.style.borderColor = hex;
      btn.addEventListener('click', () => {
        connContainer.querySelectorAll('.conn-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this._onConnSelect) this._onConnSelect(key);
      });
      connContainer.appendChild(btn);
    }
  }

  // Render palette for first category in mode
  if (catKeys.length > 0) {
    this._renderPalette(catKeys[0]);
    this._updateSystemStatsContent(catKeys[0]);
  }

  // Machine type selector — only visible in beamline mode
  this._renderMachineTypeSelector();
};

Renderer.prototype._renderMachineTypeSelector = function() {
  const label = document.getElementById('beamline-type-label');
  const dropdown = document.getElementById('machine-type-dropdown');
  if (!label || !dropdown) return;

  const editingEntry = this.game.editingBeamlineId ? this.game.registry.get(this.game.editingBeamlineId) : null;
  const currentType = (editingEntry && editingEntry.beamState.machineType) || 'linac';
  const currentName = (typeof MACHINE_TYPES !== 'undefined' && MACHINE_TYPES[currentType])
    ? MACHINE_TYPES[currentType].name : 'Electron Linac';

  // Show current type as subtitle under Beamline button (only in beamline mode)
  if (this.activeMode === 'beamline') {
    label.textContent = currentName;
    label.style.display = '';
  } else {
    label.textContent = '';
    label.style.display = 'none';
  }

  // Build dropdown options
  dropdown.innerHTML = '';
  if (typeof MACHINE_TYPES === 'undefined') return;

  for (const [key, mt] of Object.entries(MACHINE_TYPES)) {
    const opt = document.createElement('div');
    opt.className = 'machine-type-opt';
    const unlocked = this.game.isMachineTypeUnlocked(key);
    if (key === currentType) opt.classList.add('active');
    if (!unlocked) opt.classList.add('locked');

    let html = mt.name;
    if (!unlocked) html += '<span class="mt-lock">\u{1F512}</span>';
    html += `<span class="mt-desc">${mt.desc}</span>`;
    opt.innerHTML = html;

    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!unlocked) {
        this.game.log(`Research required to unlock ${mt.name}`, 'bad');
        return;
      }
      if (this.game.setMachineType(key)) {
        dropdown.classList.add('hidden');
        this._renderMachineTypeSelector();
        this._generateCategoryTabs();
      }
    });

    dropdown.appendChild(opt);
  }

  // Wire label click to toggle dropdown
  label.onclick = (e) => {
    e.stopPropagation();
    if (this.activeMode !== 'beamline') return;
    dropdown.classList.toggle('hidden');
  };

  // Close dropdown when clicking elsewhere
  if (!this._mtDropdownBound) {
    document.addEventListener('click', () => {
      dropdown.classList.add('hidden');
    });
    this._mtDropdownBound = true;
  }
};

Renderer.prototype._refreshPalette = function() {
  const activeTab = document.querySelector('.cat-tab.active');
  if (activeTab?.dataset.category) {
    this._renderPalette(activeTab.dataset.category);
  }
};

Renderer.prototype._renderPalette = function(tabCategory) {
  const palette = document.getElementById('component-palette');
  if (!palette) return;
  palette.innerHTML = '';

  const compCategory = tabCategory;

  let paletteIdx = 0;

  // Infrastructure tab uses INFRASTRUCTURE items instead of COMPONENTS
  if (compCategory === 'infrastructure') {
    for (const [key, infra] of Object.entries(INFRASTRUCTURE)) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= infra.cost;
      if (!affordable) item.classList.add('unaffordable');

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = infra.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `$${infra.cost}/tile`;
      item.appendChild(costEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-name';
      descEl.textContent = infra.isDragPlacement ? '(drag)' : '(click)';
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (this._onInfraSelect) this._onInfraSelect(key);
      });

      palette.appendChild(item);
    }
    return;
  }

  // Structure mode — Flooring tab: show flooring INFRASTRUCTURE items
  if (compCategory === 'flooring') {
    const flooringKeys = ['labFloor', 'officeFloor', 'concrete', 'hallway'];
    const catDef = MODES.structure.categories.flooring;
    const subsections = catDef.subsections;
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    for (const subKey of subKeys) {
      const subDef = subsections[subKey];
      const subItems = flooringKeys.filter(k => INFRASTRUCTURE[k]?.subsection === subKey);
      if (subItems.length === 0) continue;

      if (renderedSections > 0) {
        const divider = document.createElement('div');
        divider.className = 'palette-subsection-divider';
        palette.appendChild(divider);
      }

      const section = document.createElement('div');
      section.className = 'palette-subsection';
      const label = document.createElement('div');
      label.className = 'palette-subsection-label';
      label.textContent = subDef.name;
      section.appendChild(label);

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'palette-subsection-items';

      for (const key of subItems) {
        const infra = INFRASTRUCTURE[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= infra.cost;
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `$${infra.cost}/tile`;
        item.appendChild(costEl);

        // If this floor has variants, show a flyout on click
        if (infra.variants && infra.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            // Toggle variant flyout
            const existing = item.querySelector('.variant-flyout');
            if (existing) { existing.remove(); return; }
            // Remove other flyouts
            palette.querySelectorAll('.variant-flyout').forEach(f => f.remove());
            const flyout = document.createElement('div');
            flyout.className = 'variant-flyout';
            flyout.style.cssText = 'display:flex;gap:4px;padding:4px 0;margin-top:4px;border-top:1px solid rgba(255,255,255,0.1);flex-wrap:wrap;';
            for (let vi = 0; vi < infra.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.style.cssText = 'padding:3px 6px;font-size:9px;background:rgba(255,255,255,0.08);border-radius:3px;cursor:pointer;color:#ccc;';
              vBtn.textContent = infra.variants[vi];
              const variantIdx = vi;
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._onInfraSelect) this._onInfraSelect(key, variantIdx);
                // Highlight selected variant
                flyout.querySelectorAll('div').forEach(d => d.style.background = 'rgba(255,255,255,0.08)');
                vBtn.style.background = 'rgba(100,180,255,0.3)';
              });
              flyout.appendChild(vBtn);
            }
            item.appendChild(flyout);
            // Auto-select first variant
            if (this._onInfraSelect) this._onInfraSelect(key, 0);
          });
        } else {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            if (this._onInfraSelect) this._onInfraSelect(key);
          });
        }

        itemsContainer.appendChild(item);
      }

      section.appendChild(itemsContainer);
      palette.appendChild(section);
      renderedSections++;
    }
    return;
  }

  // Structure mode — Decoration tabs: show decoration items for this category
  const decCatDef = MODES.structure?.categories?.[compCategory];
  if (decCatDef?.isDecorationTab) {
    const decItems = Object.entries(DECORATIONS).filter(([, d]) => d.category === compCategory);
    if (decItems.length === 0) return;

    for (const [key, dec] of decItems) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= dec.cost;
      if (!affordable) item.classList.add('unaffordable');

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = dec.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `$${dec.cost}`;
      item.appendChild(costEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-name';
      descEl.style.fontSize = '9px';
      descEl.style.color = '#8a8';
      descEl.textContent = dec.placement === 'outdoor' ? 'Outdoor' : 'Indoor';
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (this._onDecorationSelect) this._onDecorationSelect(key);
      });

      palette.appendChild(item);
    }
    return;
  }

  // Structure mode — Zone tabs: show zone paint tool + furnishings
  const zoneCatDef = MODES.structure?.categories?.[compCategory];
  if (zoneCatDef?.isZoneTab) {
    const zoneType = zoneCatDef.zoneType;
    const zone = ZONES[zoneType];
    if (!zone) return;

    // Zone section — the zone paint tool
    const zoneSection = document.createElement('div');
    zoneSection.className = 'palette-subsection';
    const zoneLabel = document.createElement('div');
    zoneLabel.className = 'palette-subsection-label';
    zoneLabel.textContent = 'Zone';
    zoneSection.appendChild(zoneLabel);

    const zoneItems = document.createElement('div');
    zoneItems.className = 'palette-subsection-items';

    const zoneItem = document.createElement('div');
    zoneItem.className = 'palette-item';
    zoneItem.dataset.paletteIndex = paletteIdx;
    const zoneIdx = paletteIdx++;
    const hex = '#' + zone.color.toString(16).padStart(6, '0');
    zoneItem.style.borderLeft = `4px solid ${hex}`;

    const zoneName = document.createElement('div');
    zoneName.className = 'palette-name';
    zoneName.textContent = zone.name;
    zoneItem.appendChild(zoneName);

    const zoneDesc = document.createElement('div');
    zoneDesc.className = 'palette-cost';
    zoneDesc.textContent = `Requires: ${INFRASTRUCTURE[zone.requiredFloor]?.name || zone.requiredFloor} (drag)`;
    zoneItem.appendChild(zoneDesc);

    zoneItem.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(zoneIdx);
      if (this._onZoneSelect) this._onZoneSelect(zoneType);
    });
    zoneItems.appendChild(zoneItem);
    zoneSection.appendChild(zoneItems);
    palette.appendChild(zoneSection);

    // Furnishings section
    const furnEntries = Object.entries(ZONE_FURNISHINGS).filter(([, f]) => f.zoneType === zoneType);
    if (furnEntries.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'palette-subsection-divider';
      palette.appendChild(divider);

      const furnSection = document.createElement('div');
      furnSection.className = 'palette-subsection';
      const furnLabel = document.createElement('div');
      furnLabel.className = 'palette-subsection-label';
      furnLabel.textContent = 'Furnishings';
      furnSection.appendChild(furnLabel);

      const furnItems = document.createElement('div');
      furnItems.className = 'palette-subsection-items';

      for (const [key, furn] of furnEntries) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= furn.cost;
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = furn.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `$${furn.cost}`;
        item.appendChild(costEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onFurnishingSelect) this._onFurnishingSelect(key);
        });

        furnItems.appendChild(item);
      }

      furnSection.appendChild(furnItems);
      palette.appendChild(furnSection);
    }
    return;
  }

  // Demolish mode tools
  if (compCategory === 'demolish') {
    const demolishTools = [
      { key: 'demolishComponent', name: 'Remove Components', desc: 'Click beamline components to remove', color: '#c44' },
      { key: 'demolishConnection', name: 'Remove Pipes', desc: 'Click utility pipes/cables to remove', color: '#c84' },
      { key: 'demolishFurnishing', name: 'Remove Furniture', desc: 'Click to remove placed furnishings', color: '#a48' },
      { key: 'demolishZone', name: 'Remove Zone', desc: 'Click or drag to remove zone overlays', color: '#a84' },
      { key: 'demolishFloor', name: 'Remove Floor', desc: 'Click or drag to remove flooring tiles', color: '#a44' },
    ];

    for (const tool of demolishTools) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;
      item.style.borderLeft = `4px solid ${tool.color}`;

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = tool.name;
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-cost';
      descEl.textContent = tool.desc;
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (this._onDemolishSelect) this._onDemolishSelect(tool.key);
      });

      palette.appendChild(item);
    }
    return;
  }

  // Get subsection definitions from category
  const mode = MODES[this.activeMode];
  const catDef = mode?.categories?.[compCategory];
  const subsections = catDef?.subsections;

  // Collect components for this category
  const catComps = [];
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (comp.category !== compCategory) continue;
    catComps.push({ key, comp });
  }

  if (subsections && Object.keys(subsections).length > 0) {
    // Render with subsection grouping
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    subKeys.forEach((subKey, subIdx) => {
      const subDef = subsections[subKey];
      const subComps = catComps.filter(({ comp }) => {
        if (comp.subsection) return comp.subsection === subKey;
        return subIdx === 0; // default to first subsection
      });
      if (subComps.length === 0) return;

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'palette-subsection-items';

      for (const { key, comp } of subComps) {
        const item = this._createPaletteItem(key, comp, paletteIdx);
        if (!item) continue;
        paletteIdx++;
        itemsContainer.appendChild(item);
      }

      // Skip empty subsections (all items locked)
      if (itemsContainer.children.length === 0) return;

      // Divider between rendered subsections
      if (renderedSections > 0) {
        const divider = document.createElement('div');
        divider.className = 'palette-subsection-divider';
        palette.appendChild(divider);
      }

      const section = document.createElement('div');
      section.className = 'palette-subsection';

      const label = document.createElement('div');
      label.className = 'palette-subsection-label';
      label.textContent = subDef.name;
      section.appendChild(label);

      section.appendChild(itemsContainer);
      palette.appendChild(section);
      renderedSections++;
    });
  } else {
    // No subsections — flat rendering
    for (const { key, comp } of catComps) {
      const item = this._createPaletteItem(key, comp, paletteIdx);
      if (!item) continue;
      paletteIdx++;
      palette.appendChild(item);
    }
  }
};

Renderer.prototype._createPaletteItem = function(key, comp, idx) {
  const unlocked = this.game.isComponentUnlocked(comp);
  if (!unlocked) return null;

  // Machine tier gating — hide components above current machine type tier
  if (typeof MACHINE_TIER !== 'undefined' && typeof MACHINE_TYPES !== 'undefined') {
    const compTier = MACHINE_TIER[key] || 1;
    const editingEntry = this.game.editingBeamlineId ? this.game.registry.get(this.game.editingBeamlineId) : null;
    const currentType = (editingEntry && editingEntry.beamState.machineType) || 'linac';
    const currentMachineTier = MACHINE_TYPES[currentType]?.tier || 1;
    if (compTier > currentMachineTier) return null;
  }

  const isFacility = isFacilityCategory(comp.category);

  // Zone-tier check for facility items
  let zoneBlocked = false;
  if (isFacility && this.game.getZoneTierForCategory) {
    const zoneTier = this.game.getZoneTierForCategory(comp.category);
    const compTier = comp.zoneTier != null ? comp.zoneTier : 1;
    zoneBlocked = zoneTier < compTier;
  }

  const item = document.createElement('div');
  item.className = 'palette-item';
  item.dataset.paletteIndex = idx;

  const affordable = this.game.canAfford(comp.cost);
  if (!affordable) item.classList.add('unaffordable');
  if (zoneBlocked) item.classList.add('zone-blocked');

  // Name
  const nameEl = document.createElement('div');
  nameEl.className = 'palette-name';
  nameEl.textContent = comp.name;
  item.appendChild(nameEl);

  // Cost
  const costEl = document.createElement('div');
  costEl.className = 'palette-cost';
  const costs = Object.entries(comp.cost).map(([r, a]) =>
    r === 'funding' ? `$${this._fmt(a)}` : `${this._fmt(a)} ${r}`
  ).join(', ');
  if (zoneBlocked) {
    const neededTiles = ZONE_TIER_THRESHOLDS[( (comp.zoneTier != null ? comp.zoneTier : 1)) - 1];
    let zoneName = '';
    for (const z of Object.values(ZONES)) {
      const gates = Array.isArray(z.gatesCategory) ? z.gatesCategory : [z.gatesCategory];
      if (gates.includes(comp.category)) { zoneName = z.name; break; }
    }
    costEl.textContent = `Needs ${neededTiles} ${zoneName} tiles`;
  } else {
    costEl.textContent = costs;
  }
  item.appendChild(costEl);

  // Hover preview
  item.addEventListener('mouseenter', () => {
    this._showPalettePreview(comp);
  });
  item.addEventListener('mouseleave', () => {
    this._hidePalettePreview();
  });

  if (!zoneBlocked) {
    item.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(idx);
      if (isFacility) {
        if (this._onFacilitySelect) this._onFacilitySelect(key);
      } else {
        if (this._onToolSelect) this._onToolSelect(key);
      }
    });
  }

  return item;
};

Renderer.prototype._showPalettePreview = function(comp) {
  const preview = document.getElementById('component-preview');
  if (!preview) return;

  const nameEl = document.getElementById('preview-name');
  if (nameEl) nameEl.textContent = comp.name;

  const descEl = document.getElementById('preview-desc');
  if (descEl) descEl.textContent = comp.desc || '';

  // Draw schematic for supported component types
  const schematicCanvas = document.getElementById('preview-schematic');
  if (schematicCanvas) {
    if (this._schematicDrawers[comp.id]) {
      schematicCanvas.style.display = 'block';
      this.drawSchematic(schematicCanvas, comp.id);
    } else {
      schematicCanvas.style.display = 'none';
    }
  }

  const statsEl = document.getElementById('preview-stats');
  if (statsEl) {
    const costs = Object.entries(comp.cost).map(([r, a]) =>
    r === 'funding' ? `$${this._fmt(a)}` : `${this._fmt(a)} ${r}`
  ).join(', ');
    const statRow = (label, val) =>
      `<div class="prev-stat-row"><span>${label}</span><span class="prev-stat-val">${val}</span></div>`;

    let html = '';
    html += statRow('Cost', costs);
    html += statRow('Energy Cost', `${comp.energyCost} kW`);
    html += statRow('Length', `${comp.length} m`);
    if (comp.stats) {
      for (const [k, v] of Object.entries(comp.stats)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        if (k === 'energyGain') {
          const e = formatEnergy(v);
          html += statRow(label, `${e.val} ${e.unit}`);
        } else {
          const unit = typeof UNITS !== 'undefined' && UNITS[k] ? ` ${UNITS[k]}` : '';
          html += statRow(label, `${v}${unit}`);
        }
      }
    }
    statsEl.innerHTML = html;
  }

  preview.classList.remove('hidden');

  // Position to the right of the component-popup if visible, otherwise at its default CSS position
  const mainPopup = document.getElementById('component-popup');
  const mainVisible = mainPopup && !mainPopup.classList.contains('hidden');
  if (mainVisible) {
    const mainRect = mainPopup.getBoundingClientRect();
    preview.style.left = (mainRect.right + 8) + 'px';
    preview.style.bottom = '';
    preview.style.top = mainRect.top + 'px';
  } else {
    // Use default CSS positioning (lower-left)
    preview.style.left = '';
    preview.style.top = '';
    preview.style.bottom = '';
  }
};

Renderer.prototype._hidePalettePreview = function() {
  const preview = document.getElementById('component-preview');
  if (preview) preview.classList.add('hidden');
};

Renderer.prototype.updatePalette = function(category) {
  this._renderPalette(category);
};

// --- HUD event bindings ---

Renderer.prototype._bindHUDEvents = function() {
  // Mode switcher
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (MODES[mode]?.disabled) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.activeMode = mode;
      this._generateCategoryTabs();
      this._updateSystemStatsVisibility();
    });
  });

  // Category tab clicks
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const category = tab.dataset.category;
      this._renderPalette(category);
      if (this._onTabSelect) this._onTabSelect(category);
    });
  });

  // Research button — opens tech tree
  const resBtn = document.getElementById('btn-research');
  if (resBtn) {
    resBtn.addEventListener('click', () => {
      const overlay = document.getElementById('research-overlay');
      if (overlay) {
        overlay.classList.toggle('hidden');
        if (!overlay.classList.contains('hidden')) {
          this._treeLayout = null; // force relayout
          this._renderTechTree();
        }
      }
    });
  }

  // Goals button
  const goalsBtn = document.getElementById('btn-goals');
  if (goalsBtn) {
    goalsBtn.addEventListener('click', () => {
      const overlay = document.getElementById('goals-overlay');
      if (overlay) {
        overlay.classList.toggle('hidden');
        if (!overlay.classList.contains('hidden')) {
          this._renderGoalsOverlay();
        }
      }
    });
  }

  // System stats panel toggle
  const sysStatsPanel = document.getElementById('system-stats-panel');
  const sysStatsHeader = document.getElementById('system-stats-header');
  const sysStatsToggle = document.getElementById('system-stats-toggle');
  if (sysStatsPanel && sysStatsHeader && sysStatsToggle) {
    sysStatsHeader.addEventListener('click', () => {
      sysStatsPanel.classList.toggle('expanded');
      sysStatsToggle.textContent = sysStatsPanel.classList.contains('expanded') ? '-' : '+';
    });
  }

  // Overlay close buttons
  document.querySelectorAll('.overlay-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlayId = btn.dataset.close;
      if (overlayId) {
        const overlay = document.getElementById(overlayId);
        if (overlay) overlay.classList.add('hidden');
      }
    });
  });
};

// --- System Stats Panel ---

Renderer.prototype._updateSystemStatsVisibility = function() {
  const panel = document.getElementById('system-stats-panel');
  if (!panel) return;
  if (this.activeMode === 'facility') {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
};

Renderer.prototype._updateSystemStatsContent = function(category) {
  this._activeStatsCategory = category;
  const panel = document.getElementById('system-stats-panel');
  if (!panel || panel.classList.contains('hidden')) return;

  // Map category key to system stats key and display name
  const catMap = {
    vacuum:       { key: 'vacuum',       name: 'VACUUM' },
    rfPower:      { key: 'rfPower',      name: 'RF POWER' },
    cooling:      { key: 'cooling',      name: 'COOLING' },
    dataControls: { key: 'dataControls', name: 'DATA/CTRL' },
    power:        { key: 'power',        name: 'POWER' },
    ops:          { key: 'ops',          name: 'OPS' },
  };

  const mapped = catMap[category];
  if (!mapped) return;

  const title = document.getElementById('system-stats-title');
  if (title) {
    title.textContent = mapped.name;
    // Set color from category
    const cat = MODES.facility?.categories[category];
    if (cat) title.style.color = cat.color;
  }

  this._activeStatsKey = mapped.key;
  this._refreshSystemStatsValues();
};

Renderer.prototype._refreshSystemStatsValues = function() {
  const panel = document.getElementById('system-stats-panel');
  if (!panel || panel.classList.contains('hidden')) return;

  const stats = this.game.state.systemStats;
  if (!stats) return;

  const key = this._activeStatsKey;
  if (!key || !stats[key]) return;

  const data = stats[key];
  const summary = document.getElementById('system-stats-summary');
  const detail = document.getElementById('system-stats-detail');
  if (!summary || !detail) return;

  // Build summary and detail based on which system
  switch (key) {
    case 'vacuum':
      this._renderVacuumStats(data, summary, detail);
      break;
    case 'rfPower':
      this._renderRfPowerStats(data, summary, detail);
      break;
    case 'cooling': {
      this._renderCoolingStats(data, summary, detail);
      const cryoData = stats.cryo;
      if (cryoData) this._renderCryoStats(cryoData, summary, detail, true);
      break;
    }
    case 'power':
      this._renderPowerStats(data, summary, detail);
      break;
    case 'dataControls':
      this._renderDataControlsStats(data, summary, detail);
      break;
    case 'ops':
      this._renderOpsStats(data, summary, detail);
      break;
  }
};

Renderer.prototype._sstat = function(label, value, unit, quality) {
  const cls = quality ? ` ${quality}` : '';
  return `<span class="sstat"><span class="sstat-label">${label}</span><span class="sstat-val${cls}">${value}</span><span class="sstat-unit">${unit}</span></span>`;
};

Renderer.prototype._ssep = function() { return '<span class="sstat-sep">|</span>'; };

Renderer.prototype._detailRow = function(label, value, unit) {
  return `<div class="sstat-detail-row"><span class="sstat-detail-label">${label}</span><span class="sstat-detail-val">${value}</span><span class="sstat-detail-unit">${unit || ''}</span></div>`;
};

Renderer.prototype._fmtPressure = function(p) {
  if (p >= 1) return p.toFixed(0);
  const exp = Math.floor(Math.log10(p));
  const mantissa = p / Math.pow(10, exp);
  return `${mantissa.toFixed(1)}\u00d710${this._superscript(exp)}`;
};

Renderer.prototype._superscript = function(n) {
  const sup = { '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207b' };
  return String(n).split('').map(c => sup[c] || c).join('');
};

Renderer.prototype._qualityColor = function(q) {
  if (q === 'Excellent' || q === 'Good') return 'good';
  if (q === 'Marginal') return 'warn';
  if (q === 'Poor') return 'bad';
  return '';
};

Renderer.prototype._marginColor = function(m) {
  if (m > 30) return 'good';
  if (m > 10) return 'warn';
  return 'bad';
};

Renderer.prototype._renderVacuumStats = function(d, summary, detail) {
  const pq = this._qualityColor(d.pressureQuality);
  summary.innerHTML = [
    this._sstat('Pressure', this._fmtPressure(d.avgPressure), 'mbar', pq),
    this._ssep(),
    this._sstat('Pump Spd', this._fmt(d.totalPumpSpeed), 'L/s'),
    this._ssep(),
    this._sstat('Volume', this._fmt(d.beamlineVolume), 'L'),
    this._ssep(),
    this._sstat('Pumps', d.pumpCount, ''),
    this._ssep(),
    this._sstat('Gauges', d.gaugeCount, ''),
    this._ssep(),
    this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    this._ssep(),
    this._sstat('Quality', d.pressureQuality, '', pq),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('Roughing Pumps', dd.roughingPumps)}
    ${this._detailRow('Turbo Pumps', dd.turboPumps)}
    ${this._detailRow('Ion Pumps', dd.ionPumps)}
    ${this._detailRow('NEG Pumps', dd.negPumps)}
    ${this._detailRow('Ti-Sub Pumps', dd.tiSubPumps)}
    ${this._detailRow('Gate Valves', dd.gateValves)}
    ${this._detailRow('Pirani Gauges', dd.piraniGauges)}
    ${this._detailRow('CC Gauges', dd.ccGauges)}
    ${this._detailRow('BA Gauges', dd.baGauges)}
    ${this._detailRow('Bakeout Systems', dd.bakeoutSystems)}
  </div>`;
};

Renderer.prototype._renderRfPowerStats = function(d, summary, detail) {
  summary.innerHTML = [
    this._sstat('Fwd', this._fmt(d.totalFwdPower), 'kW'),
    this._ssep(),
    this._sstat('Refl', this._fmt(d.totalReflPower), 'kW'),
    this._ssep(),
    this._sstat('Wall', this._fmt(d.wallPower), 'kW'),
    this._ssep(),
    this._sstat('VSWR', d.vswr, ''),
    this._ssep(),
    this._sstat('Sources', d.sourceCount, ''),
    this._ssep(),
    this._sstat('Eff', d.avgEfficiency.toFixed(0), '%'),
    this._ssep(),
    this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('Klystrons', dd.klystrons)}
    ${this._detailRow('SSAs', dd.ssas)}
    ${this._detailRow('IOTs', dd.iots)}
    ${this._detailRow('Magnetrons', dd.magnetrons)}
    ${this._detailRow('Modulators', dd.modulators)}
    ${this._detailRow('Circulators', dd.circulators)}
    ${this._detailRow('Waveguides', dd.waveguides)}
    ${this._detailRow('LLRF Controllers', dd.llrfControllers)}
    ${this._detailRow('Master Oscillators', dd.masterOscillators)}
    ${this._detailRow('Vector Modulators', dd.vectorModulators)}
  </div>`;
};

Renderer.prototype._renderCryoStats = function(d, summary, detail, append = false) {
  const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
  const cryoSummary = [
    this._sstat('Cryo Cap', this._fmt(d.coolingCapacity), 'W'),
    this._ssep(),
    this._sstat('Cryo Load', this._fmt(d.heatLoad), 'W'),
    this._ssep(),
    this._sstat('Temp', d.opTemp > 0 ? d.opTemp.toFixed(1) : '--', 'K'),
    this._ssep(),
    this._sstat('Cryo Margin', d.coolingCapacity > 0 ? d.margin.toFixed(0) : '--', '%', mc),
  ].join('');

  const dd = d.detail;
  const cryoDetail = `<div class="sstat-detail-grid" style="margin-top:6px;border-top:1px solid #333;padding-top:4px;">
    <div style="grid-column:1/-1;color:#4aa;font-size:10px;margin-bottom:2px;">CRYOGENICS</div>
    ${this._detailRow('He Compressors', dd.compressors)}
    ${this._detailRow('Cold Box 4K', dd.coldBox4K)}
    ${this._detailRow('Sub-Cooling 2K', dd.subCooling2K)}
    ${this._detailRow('Cryo Housings', dd.cryoHousings)}
    ${this._detailRow('LN2 Pre-coolers', dd.ln2Precoolers)}
    ${this._detailRow('He Recovery', dd.heRecovery > 0 ? 'Yes' : 'No')}
    ${this._detailRow('Cryocoolers', dd.cryocoolers)}
    ${this._detailRow('Static Load', dd.staticLoad.toFixed(1), 'W')}
    ${this._detailRow('Dynamic Load', dd.dynamicLoad.toFixed(1), 'W')}
  </div>`;

  if (append) {
    summary.innerHTML += cryoSummary;
    detail.innerHTML += cryoDetail;
  } else {
    summary.innerHTML = cryoSummary;
    detail.innerHTML = cryoDetail;
  }
};

Renderer.prototype._renderCoolingStats = function(d, summary, detail) {
  const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
  summary.innerHTML = [
    this._sstat('Capacity', this._fmt(d.coolingCapacity), 'kW'),
    this._ssep(),
    this._sstat('Load', d.heatLoad.toFixed(1), 'kW'),
    this._ssep(),
    this._sstat('Flow', this._fmt(Math.round(d.flowRate)), 'L/min'),
    this._ssep(),
    this._sstat('Margin', d.coolingCapacity > 0 ? d.margin.toFixed(0) : '--', '%', mc),
    this._ssep(),
    this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('LCW Skids', dd.lcwSkids)}
    ${this._detailRow('Chillers', dd.chillers)}
    ${this._detailRow('Cooling Towers', dd.coolingTowers)}
    ${this._detailRow('Heat Exchangers', dd.heatExchangers)}
    ${this._detailRow('Water Loads', dd.waterLoads)}
    ${this._detailRow('Deionizer', dd.deionizers > 0 ? 'Yes' : 'No')}
    ${this._detailRow('Emergency Cooling', dd.emergencyCooling > 0 ? 'Yes' : 'No')}
  </div>`;
};

Renderer.prototype._renderPowerStats = function(d, summary, detail) {
  const uc = d.utilization > 90 ? 'bad' : (d.utilization > 70 ? 'warn' : 'good');
  summary.innerHTML = [
    this._sstat('Capacity', this._fmt(d.capacity), 'kW'),
    this._ssep(),
    this._sstat('Draw', d.totalDraw.toFixed(1), 'kW'),
    this._ssep(),
    this._sstat('Util', d.utilization.toFixed(0), '%', uc),
    this._ssep(),
    this._sstat('Substations', d.substations, ''),
    this._ssep(),
    this._sstat('Panels', d.panels, ''),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('Beamline Draw', dd.beamlineDraw.toFixed(1), 'kW')}
    ${this._detailRow('Vacuum Draw', dd.vacuumDraw.toFixed(1), 'kW')}
    ${this._detailRow('RF Draw', dd.rfDraw.toFixed(1), 'kW')}
    ${this._detailRow('Cryo Draw', dd.cryoDraw.toFixed(1), 'kW')}
    ${this._detailRow('Cooling Draw', dd.coolingDraw.toFixed(1), 'kW')}
  </div>`;
};

Renderer.prototype._renderDataControlsStats = function(d, summary, detail) {
  const mpsColor = d.mpsStatus === 'Active' ? 'good' : '';
  summary.innerHTML = [
    this._sstat('IOCs', d.iocs, ''),
    this._ssep(),
    this._sstat('Interlocks', d.interlocks, ''),
    this._ssep(),
    this._sstat('Monitors', d.monitors, ''),
    this._ssep(),
    this._sstat('Timing', d.timingSystems, ''),
    this._ssep(),
    this._sstat('MPS', d.mpsStatus, '', mpsColor),
    this._ssep(),
    this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('Rack/IOCs', dd.rackIocs)}
    ${this._detailRow('PPS Interlocks', dd.ppsInterlocks)}
    ${this._detailRow('Rad Monitors', dd.radiationMonitors)}
    ${this._detailRow('Timing Systems', dd.timingSystems)}
    ${this._detailRow('MPS Units', dd.mps)}
    ${this._detailRow('Laser Systems', dd.laserSystems)}
  </div>`;
};

Renderer.prototype._renderOpsStats = function(d, summary, detail) {
  summary.innerHTML = [
    this._sstat('Shielding', d.shielding, ''),
    this._ssep(),
    this._sstat('Beam Dumps', d.beamDumps, ''),
    this._ssep(),
    this._sstat('Tgt Handling', d.targetHandling, ''),
    this._ssep(),
    this._sstat('Rad Waste', d.radWasteStorage, ''),
    this._ssep(),
    this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
  ].join('');

  const dd = d.detail;
  detail.innerHTML = `<div class="sstat-detail-grid">
    ${this._detailRow('Shielding Blocks', dd.shielding)}
    ${this._detailRow('Beam Dumps', dd.beamDumps)}
    ${this._detailRow('Target Handling', dd.targetHandling)}
    ${this._detailRow('Rad Waste Storage', dd.radWasteStorage)}
  </div>`;
};
