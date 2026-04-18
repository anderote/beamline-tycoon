// === HUD EXTENSION ===
// Adds HUD update, palette rendering, beam button, and system stats to UIHost.prototype.
// Note: PIXI is a CDN global — not imported.

import { isFacilityCategory } from './Renderer.js';
import { UIHost } from '../ui/UIHost.js';
import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { ZONES, ZONE_FURNISHINGS, ZONE_TIER_THRESHOLDS } from '../data/facility.js';
import { MODES, INFRA_DISTRIBUTION } from '../data/modes.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { DECORATIONS } from '../data/decorations.js';
import { MACHINE_TYPES, MACHINE_TIER, MACHINES } from '../data/machines.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { renderComponentThumbnail } from '../renderer3d/component-builder.js';
import { renderDecorationThumbnail } from '../renderer3d/decoration-builder.js';
import { DEMOLISH_BUTTONS } from '../input/demolishScopes.js';
import { TUTORIAL_STEPS, TUTORIAL_GROUPS } from '../data/tutorial.js';

function _costVal(cost) {
  return (typeof cost === 'object' && cost !== null) ? (cost.funding ?? 0) : cost;
}
function _costLabel(cost) {
  const v = _costVal(cost);
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
}

// Build a 12×12 swatch span for a variant. `color` may be:
//   - a single hex number: solid dot
//   - an array [lightHex, darkHex]: split swatch (light left, dark right),
//     used for checker patterns to show both colors at once
//   - null/undefined: returns null (caller omits the swatch)
function makeVariantSwatch(color) {
  if (color == null) return null;
  const dot = document.createElement('span');
  const base = 'display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle;border:1px solid rgba(255,255,255,0.3);';
  if (Array.isArray(color)) {
    const a = color[0].toString(16).padStart(6, '0');
    const b = color[1].toString(16).padStart(6, '0');
    dot.style.cssText = `${base}background:linear-gradient(90deg,#${a} 0%,#${a} 50%,#${b} 50%,#${b} 100%);`;
  } else {
    dot.style.cssText = `${base}background:#${color.toString(16).padStart(6, '0')};`;
  }
  return dot;
}

// Resolve a variant's preview color from a floor def. Prefers the explicit
// variantPreviewColors entry (may be a pair for split swatches), then falls
// back to variantTints, and finally returns null.
function resolveVariantPreview(def, vi) {
  const preview = def.variantPreviewColors?.[vi];
  if (preview != null) return preview;
  const tint = def.variantTints?.[vi];
  return tint != null ? tint : null;
}

// When multiple variants share a single base texture (e.g. the lab-floor
// epoxy variants which all use tile_labFloor.png tinted in-engine via
// variantTints), the palette thumbnail would otherwise look identical
// across variants. Overlay a multiply-blended tint div so each variant
// shows its actual in-game color.
function applyPreviewTint(previewEl, def, vi) {
  const tint = def?.variantTints?.[vi];
  if (tint == null) return;
  previewEl.style.position = previewEl.style.position || 'relative';
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:absolute;inset:0;background:#${tint.toString(16).padStart(6,'0')};mix-blend-mode:multiply;pointer-events:none;`;
  previewEl.appendChild(overlay);
}

// ── Variant memory ──────────────────────────────────────────────────
// Persist the last variant selected for each build-item key so that
// reopening the variant flyout (or reloading the page) defaults to the
// user's last choice. Backed by localStorage so it survives reloads.
const VARIANT_MEMORY_KEY = 'bt_lastVariantByKey';
let _variantMemoryCache = null;
function _loadVariantMemory() {
  if (_variantMemoryCache) return _variantMemoryCache;
  try {
    const raw = localStorage.getItem(VARIANT_MEMORY_KEY);
    _variantMemoryCache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    _variantMemoryCache = {};
  }
  return _variantMemoryCache;
}
function recallVariant(key) {
  return _loadVariantMemory()[key] ?? 0;
}
function rememberVariant(key, vi) {
  const mem = _loadVariantMemory();
  mem[key] = vi;
  try { localStorage.setItem(VARIANT_MEMORY_KEY, JSON.stringify(mem)); } catch (e) {}
}

// --- HUD updates ---

UIHost.prototype._updateHUD = function() {
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

  // Facility overview (top-left panel) — aggregated stats across all beamlines/machines.
  // Aggregate both legacy registry-backed beamlines and the main-map pipe graph.
  {
    const entries = this.game.registry.getAll();
    const mbs = this.game.state.mainBeamState || {};

    let totalDataRate = entries.reduce((sum, e) => sum + (e.beamState.dataRate || 0), 0);
    let totalBeamPower = entries.reduce((sum, e) => sum + (e.beamState.totalEnergyCost || 0), 0);
    let totalLength = entries.reduce((sum, e) => sum + (e.beamState.totalLength || 0), 0);
    let peakEnergy = 0;
    for (const e of entries) {
      if ((e.beamState.beamEnergy || 0) > peakEnergy) peakEnergy = e.beamState.beamEnergy;
    }

    // Add main-map pipe-graph contribution
    totalDataRate += mbs.dataRate || 0;
    totalBeamPower += mbs.totalEnergyCost || 0;
    totalLength += mbs.totalLength || 0;
    if ((mbs.beamEnergy || 0) > peakEnergy) peakEnergy = mbs.beamEnergy;

    // Power stats from systemStats
    const totalPower = ss && ss.power ? Math.round(ss.power.totalDraw) : 0;
    const rfPower = ss && ss.rfPower ? Math.round(ss.rfPower.totalFwdPower || 0) : 0;
    const coolingPower = ss && ss.cooling ? Math.round(ss.cooling.energyDraw || 0) : 0;

    // Helper: set value and show/hide row based on whether stat is live
    const setStatRow = (id, val, show) => {
      setEl(id, val);
      const el = document.getElementById(id);
      if (el) {
        const row = el.closest('.bsp-row');
        if (row) row.classList.toggle('hidden', !show);
      }
    };

    setStatRow('stat-total-power', totalPower, totalPower > 0);
    setStatRow('stat-rf-power', rfPower, rfPower > 0);
    setStatRow('stat-beam-power', Math.round(totalBeamPower), totalBeamPower > 0);
    setStatRow('stat-cooling-power', coolingPower, coolingPower > 0);
    setStatRow('stat-total-length', Math.round(totalLength), totalLength > 0);
    if (peakEnergy > 0) {
      const e = formatEnergy(peakEnergy);
      setStatRow('stat-peak-energy', e.val, true);
      setEl('stat-peak-energy-unit', e.unit);
    } else {
      setStatRow('stat-peak-energy', '0', false);
    }
    setStatRow('stat-data-rate', totalDataRate ? totalDataRate.toFixed(1) : '0', totalDataRate > 0);

    // Hide entire panel if nothing is live
    const panel = document.getElementById('beam-stats-panel');
    if (panel) {
      const hasVisible = panel.querySelector('.bsp-row:not(.hidden)');
      panel.style.display = hasVisible ? '' : 'none';
    }
  }

  this._updateBeamSummary();

  // Refresh system stats if panel is visible
  this._refreshSystemStatsValues();

  // Refresh any open beamline context windows
  this._refreshContextWindows();

  this._updateTutorialPanel();
};

// === TUTORIAL CHECKLIST ===

UIHost.prototype._initTutorialPanel = function() {
  const panel = document.getElementById('tutorial-panel');
  if (!panel || this._tutorialInited) return;
  this._tutorialInited = true;
  this._tutorialMinimized = true;
  this._tutorialPrevCompleted = new Set();
  panel.classList.add('minimized');

  // Toggle minimize on header click
  const header = document.getElementById('tutorial-header');
  header.addEventListener('click', (e) => {
    if (e.target.id === 'tutorial-dismiss') return;
    this._tutorialMinimized = !this._tutorialMinimized;
    panel.classList.toggle('minimized', this._tutorialMinimized);
  });

  // Dismiss button
  document.getElementById('tutorial-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    this.game.state.tutorialDismissed = true;
    panel.classList.add('hidden');
  });

  // Build the static group/step DOM structure
  const body = document.getElementById('tutorial-body');
  body.innerHTML = '';
  for (const group of TUTORIAL_GROUPS) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tut-group';
    groupDiv.innerHTML = `<div class="tut-group-name">${group.name}</div>`;

    for (const step of TUTORIAL_STEPS.filter(s => s.group === group.id)) {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'tut-step';
      stepDiv.id = `tut-${step.id}`;
      stepDiv.innerHTML =
        `<span class="tut-check">\u25cb</span>` +
        `<span class="tut-name">${step.name}<span class="tut-hint">${step.hint}</span></span>`;
      groupDiv.appendChild(stepDiv);
    }

    body.appendChild(groupDiv);
  }
};

UIHost.prototype._updateTutorialPanel = function() {
  const panel = document.getElementById('tutorial-panel');
  if (!panel) return;

  const state = this.game.state;
  if (state.tutorialDismissed) {
    panel.classList.add('hidden');
    return;
  }

  this._initTutorialPanel();
  panel.classList.remove('hidden');

  // Phase 6: tutorial conditions read directly from state.utilityNetworkData
  // now (no separate `nets` arg). Left as a single-arg call for clarity.
  let completedCount = 0;
  let firstIncomplete = null;

  for (const step of TUTORIAL_STEPS) {
    const el = document.getElementById(`tut-${step.id}`);
    if (!el) continue;

    let done = false;
    try { done = step.condition(state); } catch (_) {}

    const check = el.querySelector('.tut-check');
    if (done) {
      completedCount++;
      if (!el.classList.contains('completed')) {
        el.classList.add('completed');
        check.textContent = '\u2713';
        // Flash animation for newly completed
        if (this._tutorialPrevCompleted && !this._tutorialPrevCompleted.has(step.id)) {
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 500);
        }
      }
      el.classList.remove('next');
    } else {
      el.classList.remove('completed');
      check.textContent = '\u25cb';
      if (!firstIncomplete) {
        firstIncomplete = step;
        el.classList.add('next');
      } else {
        el.classList.remove('next');
      }
    }
  }

  // Track what was completed for flash detection
  this._tutorialPrevCompleted = new Set(
    TUTORIAL_STEPS.filter((s) => {
      try { return s.condition(state, nets); } catch (_) { return false; }
    }).map(s => s.id)
  );

  // Update progress
  const total = TUTORIAL_STEPS.length;
  const pct = Math.round((completedCount / total) * 100);
  const progressText = document.getElementById('tutorial-progress-text');
  const progressFill = document.getElementById('tutorial-progress-fill');
  if (progressText) progressText.textContent = `${completedCount}/${total}`;
  if (progressFill) progressFill.style.width = `${pct}%`;

  // All done state
  if (completedCount === total) {
    panel.classList.add('all-done');
    const title = document.getElementById('tutorial-title');
    if (title) title.textContent = 'All Done!';
  } else {
    panel.classList.remove('all-done');
    const title = document.getElementById('tutorial-title');
    if (title) title.textContent = 'Getting Started';
  }
};

UIHost.prototype._updateBeamSummary = function() {
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

UIHost.prototype._generateCategoryTabs = function() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES[this.activeMode];
  if (!mode || mode.disabled) return;

  // Facility mode has a Labs/Rooms toggle that filters visible tabs
  const isFacility = this.activeMode === 'facility';
  if (isFacility && !this._facilityGroup) this._facilityGroup = 'labs';

  let catKeys = Object.keys(mode.categories);
  if (isFacility) {
    const group = this._facilityGroup;
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'facility-group-toggle';
    toggleBtn.textContent = group === 'labs' ? 'Labs ▸' : 'Rooms ▸';
    toggleBtn.title = 'Toggle Labs / Rooms';
    toggleBtn.addEventListener('click', () => {
      this._facilityGroup = this._facilityGroup === 'labs' ? 'rooms' : 'labs';
      this._generateCategoryTabs();
    });
    tabsContainer.appendChild(toggleBtn);
    catKeys = catKeys.filter(k => mode.categories[k].group === group);
  }

  catKeys.forEach((key, idx) => {
    const cat = mode.categories[key];
    if (cat.separatorBefore) {
      const sep = document.createElement('div');
      sep.className = 'cat-tab-separator';
      tabsContainer.appendChild(sep);
    }
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

  // Phase 6: the legacy #connection-tools rack-paint button row was removed
  // along with CONNECTION_TYPES. Hide the container if the DOM still has it.
  const connContainer = document.getElementById('connection-tools');
  if (connContainer) connContainer.style.display = 'none';

  // Render palette for first category in mode
  if (catKeys.length > 0) {
    this._renderPalette(catKeys[0]);
    this._updateSystemStatsContent(catKeys[0]);
    if (isFacility && this._onTabSelect) this._onTabSelect(catKeys[0]);
  }

  // Machine type selector — only visible in beamline mode
  this._renderMachineTypeSelector();
};

UIHost.prototype._renderMachineTypeSelector = function() {
  // Machine type is now determined by the source component — no separate selector needed.
  // Hide the label and dropdown.
  const label = document.getElementById('beamline-type-label');
  const dropdown = document.getElementById('machine-type-dropdown');
  if (label) { label.style.display = 'none'; label.textContent = ''; }
  if (dropdown) { dropdown.classList.add('hidden'); dropdown.innerHTML = ''; }
};

UIHost.prototype._refreshPalette = function() {
  const activeTab = document.querySelector('.cat-tab.active');
  if (activeTab?.dataset.category) {
    this._renderPalette(activeTab.dataset.category);
  }
};

UIHost.prototype._renderPalette = function(tabCategory) {
  this._removeParamFlyout();
  const palette = document.getElementById('component-palette');
  if (!palette) return;
  palette.innerHTML = '';

  const compCategory = tabCategory;

  let paletteIdx = 0;

  // Infrastructure tab uses FLOORS items instead of COMPONENTS
  if (compCategory === 'infrastructure') {
    for (const [key, infra] of Object.entries(FLOORS)) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= _costVal(infra.cost);
      if (!affordable) item.classList.add('unaffordable');

      // Tile preview
      const previewEl = document.createElement('div');
      previewEl.className = 'palette-preview';
      const rememberedViForPreview = recallVariant(key);
      const tilePath = this.sprites.getTilePath(key, rememberedViForPreview);
      if (tilePath) {
        const img = document.createElement('img');
        img.src = tilePath;
        img.alt = infra.name;
        previewEl.appendChild(img);
        applyPreviewTint(previewEl, infra, rememberedViForPreview);
      } else {
        const swatch = document.createElement('div');
        const c = infra.topColor || infra.color || 0x888888;
        swatch.style.cssText = `width:48px;height:24px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);`;
        previewEl.appendChild(swatch);
      }
      item.appendChild(previewEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = infra.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `${_costLabel(infra.cost)}/tile`;
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

  // Structure mode — Flooring tab: show flooring FLOORS items
  // Structure mode — Walls tab: show wall FLOORS items
  if (compCategory === 'walls') {
    const wallKeys = Object.keys(WALL_TYPES);
    const catDef = MODES.structure.categories.walls;
    const subsections = catDef.subsections;
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    for (const subKey of subKeys) {
      const subDef = subsections[subKey];
      const subItems = wallKeys.filter(k => WALL_TYPES[k]?.subsection === subKey);
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
        const infra = WALL_TYPES[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= _costVal(infra.cost);
        if (!affordable) item.classList.add('unaffordable');

        // Wall preview (variant-aware via remembered selection)
        const rememberedVi = recallVariant(key);
        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const tilePath2 = this.sprites.getTilePath(key, rememberedVi);
        if (tilePath2) {
          const img = document.createElement('img');
          img.src = tilePath2;
          img.alt = infra.name;
          previewEl.appendChild(img);
          applyPreviewTint(previewEl, infra, rememberedVi);
        } else {
          const swatch = document.createElement('div');
          const c = infra.topColor || infra.color || 0x888888;
          swatch.style.cssText = `width:48px;height:32px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 30%,100% 80%,50% 100%,0% 80%,0% 30%);`;
          previewEl.appendChild(swatch);
        }
        item.appendChild(previewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `${_costLabel(infra.cost)}/seg`;
        item.appendChild(costEl);

        if (infra.variants && infra.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            // Pre-select on open so clicks elsewhere still use the remembered variant.
            if (this._onWallSelect) this._onWallSelect(key, defaultVi);

            for (let vi = 0; vi < infra.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.className = 'param-flyout-btn';
              const sw = makeVariantSwatch(resolveVariantPreview(infra, vi));
              if (sw) vBtn.appendChild(sw);
              vBtn.appendChild(document.createTextNode(infra.variants[vi]));
              const variantIdx = vi;
              if (vi === defaultVi) vBtn.classList.add('active');
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rememberVariant(key, variantIdx);
                if (this._onWallSelect) this._onWallSelect(key, variantIdx);
                const previewElNow = item.querySelector('.palette-preview');
                const previewImg = previewElNow?.querySelector('img');
                if (previewImg) {
                  const newPath = this.sprites.getTilePath(key, variantIdx);
                  if (newPath) previewImg.src = newPath;
                }
                if (previewElNow) {
                  previewElNow.querySelectorAll('div').forEach(d => d.remove());
                  applyPreviewTint(previewElNow, infra, variantIdx);
                }
                flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
                vBtn.classList.add('active');
                this._removeParamFlyout();
              });
              flyout.appendChild(vBtn);
            }

            document.body.appendChild(flyout);
            const rect = item.getBoundingClientRect();
            flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
            flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
            this._activeParamFlyout = flyout;

            const closeHandler = (e) => {
              if (!flyout.contains(e.target) && !item.contains(e.target)) {
                this._removeParamFlyout();
                document.removeEventListener('click', closeHandler, true);
              }
            };
            setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
          });
        } else {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            if (this._onWallSelect) this._onWallSelect(key);
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

  if (compCategory === 'doors') {
    const doorKeys = Object.keys(DOOR_TYPES);
    const catDef = MODES.structure.categories.doors;
    const subsections = catDef.subsections;
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    for (const subKey of subKeys) {
      const subDef = subsections[subKey];
      const subItems = doorKeys.filter(k => DOOR_TYPES[k]?.subsection === subKey);
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
        const door = DOOR_TYPES[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= _costVal(door.cost);
        if (!affordable) item.classList.add('unaffordable');

        const rememberedVi = recallVariant(key);
        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const tilePath2 = this.sprites.getTilePath(key, rememberedVi);
        if (tilePath2) {
          const img = document.createElement('img');
          img.src = tilePath2;
          img.alt = door.name;
          previewEl.appendChild(img);
          applyPreviewTint(previewEl, door, rememberedVi);
        } else {
          const swatch = document.createElement('div');
          const c = door.topColor || door.color || 0x888888;
          swatch.style.cssText = `width:48px;height:32px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 30%,100% 80%,50% 100%,0% 80%,0% 30%);`;
          previewEl.appendChild(swatch);
        }
        item.appendChild(previewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = door.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `${_costLabel(door.cost)}/seg`;
        item.appendChild(costEl);

        if (door.variants && door.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            if (this._onDoorSelect) this._onDoorSelect(key, defaultVi);

            for (let vi = 0; vi < door.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.className = 'param-flyout-btn';
              const sw = makeVariantSwatch(resolveVariantPreview(door, vi));
              if (sw) vBtn.appendChild(sw);
              vBtn.appendChild(document.createTextNode(door.variants[vi]));
              const variantIdx = vi;
              if (vi === defaultVi) vBtn.classList.add('active');
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rememberVariant(key, variantIdx);
                if (this._onDoorSelect) this._onDoorSelect(key, variantIdx);
                const previewElNow = item.querySelector('.palette-preview');
                const previewImg = previewElNow?.querySelector('img');
                if (previewImg) {
                  const newPath = this.sprites.getTilePath(key, variantIdx);
                  if (newPath) previewImg.src = newPath;
                }
                if (previewElNow) {
                  previewElNow.querySelectorAll('div').forEach(d => d.remove());
                  applyPreviewTint(previewElNow, door, variantIdx);
                }
                flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
                vBtn.classList.add('active');
                this._removeParamFlyout();
              });
              flyout.appendChild(vBtn);
            }

            document.body.appendChild(flyout);
            const rect = item.getBoundingClientRect();
            flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
            flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
            this._activeParamFlyout = flyout;

            const closeHandler = (e) => {
              if (!flyout.contains(e.target) && !item.contains(e.target)) {
                this._removeParamFlyout();
                document.removeEventListener('click', closeHandler, true);
              }
            };
            setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
          });
        } else {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            if (this._onDoorSelect) this._onDoorSelect(key);
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

  if (compCategory === 'flooring') {
    const flooringKeys = ['labFloor', 'officeFloor', 'concrete', 'hallway'];
    const catDef = MODES.structure.categories.flooring;
    const subsections = catDef.subsections;
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    for (const subKey of subKeys) {
      const subDef = subsections[subKey];
      const subItems = flooringKeys.filter(k => FLOORS[k]?.subsection === subKey);
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
        const infra = FLOORS[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= _costVal(infra.cost);
        if (!affordable) item.classList.add('unaffordable');

        // Tile preview — use the remembered variant so the thumbnail
        // reflects the user's last choice, not always variant 0.
        const rememberedVi = recallVariant(key);
        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const tilePath2 = this.sprites.getTilePath(key, rememberedVi);
        if (tilePath2) {
          const img = document.createElement('img');
          img.src = tilePath2;
          img.alt = infra.name;
          previewEl.appendChild(img);
          applyPreviewTint(previewEl, infra, rememberedVi);
        } else {
          // Color swatch fallback
          const swatch = document.createElement('div');
          const c = infra.topColor || infra.color || 0x888888;
          swatch.style.cssText = `width:48px;height:24px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);`;
          previewEl.appendChild(swatch);
        }
        item.appendChild(previewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `${_costLabel(infra.cost)}/tile`;
        item.appendChild(costEl);

        // If this floor has variants, show a flyout above the item on click
        if (infra.variants && infra.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            for (let vi = 0; vi < infra.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.className = 'param-flyout-btn';
              const swatch = makeVariantSwatch(resolveVariantPreview(infra, vi));
              if (swatch) vBtn.appendChild(swatch);
              vBtn.appendChild(document.createTextNode(infra.variants[vi]));
              const variantIdx = vi;
              if (vi === defaultVi) vBtn.classList.add('active');
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rememberVariant(key, variantIdx);
                if (this._onInfraSelect) this._onInfraSelect(key, variantIdx);
                // Swap the palette thumbnail to reflect the chosen variant.
                const previewElNow = item.querySelector('.palette-preview');
                const previewImg = previewElNow?.querySelector('img');
                if (previewImg) {
                  const newPath = this.sprites.getTilePath(key, variantIdx);
                  if (newPath) previewImg.src = newPath;
                }
                if (previewElNow) {
                  previewElNow.querySelectorAll('div').forEach(d => d.remove());
                  applyPreviewTint(previewElNow, infra, variantIdx);
                }
                flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
                vBtn.classList.add('active');
                this._removeParamFlyout();
              });
              flyout.appendChild(vBtn);
            }

            // Portal to body, positioned above the palette item
            document.body.appendChild(flyout);
            const rect = item.getBoundingClientRect();
            flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
            flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
            this._activeParamFlyout = flyout;

            // Auto-select the remembered variant (falls back to 0).
            if (this._onInfraSelect) this._onInfraSelect(key, defaultVi);

            // Close on outside click
            const closeHandler = (e) => {
              if (!flyout.contains(e.target) && !item.contains(e.target)) {
                this._removeParamFlyout();
                document.removeEventListener('click', closeHandler, true);
              }
            };
            setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
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

  // Surfaces tab (Grounds mode): show outdoor surface infrastructure items
  const surfaceCatDef = MODES.grounds?.categories?.[compCategory];
  if (surfaceCatDef?.isSurfaceTab) {
    const surfaceKeys = Object.keys(FLOORS).filter(k => FLOORS[k].groundsSurface);
    for (const key of surfaceKeys) {
      const infra = FLOORS[key];
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= _costVal(infra.cost);
      if (!affordable) item.classList.add('unaffordable');

      // Tile preview (variant-aware via remembered selection)
      const rememberedVi = recallVariant(key);
      const previewEl = document.createElement('div');
      previewEl.className = 'palette-preview';
      const tilePath2 = this.sprites.getTilePath(key, rememberedVi);
      if (tilePath2) {
        const img = document.createElement('img');
        img.src = tilePath2;
        img.alt = infra.name;
        previewEl.appendChild(img);
        applyPreviewTint(previewEl, infra, rememberedVi);
      } else {
        const swatch = document.createElement('div');
        const c = infra.topColor || infra.color || 0x888888;
        swatch.style.cssText = `width:48px;height:24px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);`;
        previewEl.appendChild(swatch);
      }
      item.appendChild(previewEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = infra.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `${_costLabel(infra.cost)}/tile`;
      item.appendChild(costEl);

      if (infra.variants && infra.variants.length > 1) {
        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          this._removeParamFlyout();
          const flyout = document.createElement('div');
          flyout.className = 'param-flyout';

          const defaultVi = recallVariant(key);
          for (let vi = 0; vi < infra.variants.length; vi++) {
            const vBtn = document.createElement('div');
            vBtn.className = 'param-flyout-btn';
            const swatch = makeVariantSwatch(resolveVariantPreview(infra, vi));
            if (swatch) vBtn.appendChild(swatch);
            vBtn.appendChild(document.createTextNode(infra.variants[vi]));
            const variantIdx = vi;
            if (vi === defaultVi) vBtn.classList.add('active');
            vBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              rememberVariant(key, variantIdx);
              if (this._onInfraSelect) this._onInfraSelect(key, variantIdx);
              const previewElNow = item.querySelector('.palette-preview');
              const previewImg = previewElNow?.querySelector('img');
              if (previewImg) {
                const newPath = this.sprites.getTilePath(key, variantIdx);
                if (newPath) previewImg.src = newPath;
              }
              if (previewElNow) {
                previewElNow.querySelectorAll('div').forEach(d => d.remove());
                applyPreviewTint(previewElNow, infra, variantIdx);
              }
              flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
              vBtn.classList.add('active');
              this._removeParamFlyout();
            });
            flyout.appendChild(vBtn);
          }

          document.body.appendChild(flyout);
          const rect = item.getBoundingClientRect();
          flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
          flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
          this._activeParamFlyout = flyout;

          if (this._onInfraSelect) this._onInfraSelect(key, defaultVi);

          const closeHandler = (e) => {
            if (!flyout.contains(e.target) && !item.contains(e.target)) {
              this._removeParamFlyout();
              document.removeEventListener('click', closeHandler, true);
            }
          };
          setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
        });
      } else {
        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onInfraSelect) this._onInfraSelect(key);
        });
      }

      palette.appendChild(item);
    }
    return;
  }

  // Wall tabs (Grounds mode — fencing): show wall items grouped by subsection.
  const wallCatDef = MODES.grounds?.categories?.[compCategory];
  if (wallCatDef?.isWallTab) {
    // A tab may declare a single wallSubsection OR a subsections map. The map
    // form renders each subsection as a labeled group, like Structure > Walls.
    const subKeys = wallCatDef.subsections
      ? Object.keys(wallCatDef.subsections)
      : [wallCatDef.wallSubsection];
    let renderedSections = 0;

    const renderWallItem = (key, infra, container) => {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= _costVal(infra.cost);
      if (!affordable) item.classList.add('unaffordable');

      const previewEl = document.createElement('div');
      previewEl.className = 'palette-preview';
      const tilePath = this.sprites.getTilePath(key);
      if (tilePath) {
        const img = document.createElement('img');
        img.src = tilePath;
        img.alt = infra.name;
        previewEl.appendChild(img);
      } else {
        const swatch = document.createElement('div');
        const c = infra.topColor || infra.color || 0x888888;
        swatch.style.cssText = `width:48px;height:32px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 30%,100% 80%,50% 100%,0% 80%,0% 30%);`;
        previewEl.appendChild(swatch);
      }
      item.appendChild(previewEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = infra.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `${_costLabel(infra.cost)}`;
      item.appendChild(costEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (this._onWallSelect) this._onWallSelect(key);
      });

      container.appendChild(item);
    };

    for (const subKey of subKeys) {
      if (!subKey) continue;
      const subItems = Object.entries(WALL_TYPES).filter(([, w]) => w.subsection === subKey);
      if (subItems.length === 0) continue;

      const subDef = wallCatDef.subsections?.[subKey];
      if (wallCatDef.subsections) {
        if (renderedSections > 0) {
          const divider = document.createElement('div');
          divider.className = 'palette-subsection-divider';
          palette.appendChild(divider);
        }
        const section = document.createElement('div');
        section.className = 'palette-subsection';
        const label = document.createElement('div');
        label.className = 'palette-subsection-label';
        label.textContent = subDef?.name || subKey;
        section.appendChild(label);
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'palette-subsection-items';
        for (const [key, infra] of subItems) renderWallItem(key, infra, itemsContainer);
        section.appendChild(itemsContainer);
        palette.appendChild(section);
      } else {
        for (const [key, infra] of subItems) renderWallItem(key, infra, palette);
      }
      renderedSections++;
    }
    return;
  }

  // Decoration tabs (Grounds mode): show decoration items for this category
  const decCatDef = MODES.grounds?.categories?.[compCategory];
  if (decCatDef?.isDecorationTab) {
    const decItems = Object.entries(DECORATIONS).filter(([, d]) => d.category === compCategory);
    if (decItems.length === 0) return;

    for (const [key, dec] of decItems) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = paletteIdx;
      const idx = paletteIdx++;

      const affordable = this.game.state.resources.funding >= _costVal(dec.cost);
      if (!affordable) item.classList.add('unaffordable');

      const hasVariants = Array.isArray(dec.variants) && dec.variants.length > 1;
      const initialVariant = hasVariants ? recallVariant(key) : 0;

      // Preview — prefer a 3D-rendered thumbnail of the actual in-game
      // geometry (variant-aware). Falls back to the legacy PixelLab PNG if
      // no thumbnail can be produced.
      const previewEl = document.createElement('div');
      previewEl.className = 'palette-preview';
      const setPreview = (variantIdx) => {
        previewEl.innerHTML = '';
        const thumbUrl = renderDecorationThumbnail(key, 96, variantIdx);
        if (thumbUrl) {
          const img = document.createElement('img');
          img.src = thumbUrl;
          img.alt = dec.name;
          img.width = 96;
          img.height = 96;
          img.style.objectFit = 'contain';
          previewEl.appendChild(img);
        } else {
          const spritePath = this.sprites.getSpritePath(dec.spriteKey);
          const img = document.createElement('img');
          img.src = spritePath || `assets/decorations/${dec.spriteKey}.png`;
          img.alt = dec.name;
          img.onerror = () => { img.style.display = 'none'; };
          previewEl.appendChild(img);
        }
      };
      setPreview(initialVariant);
      item.appendChild(previewEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = dec.name;
      item.appendChild(nameEl);

      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      costEl.textContent = `${_costLabel(dec.cost)}`;
      item.appendChild(costEl);

      if (hasVariants) {
        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          this._removeParamFlyout();
          const flyout = document.createElement('div');
          flyout.className = 'param-flyout';

          const defaultVi = recallVariant(key);
          for (let vi = 0; vi < dec.variants.length; vi++) {
            const vBtn = document.createElement('div');
            vBtn.className = 'param-flyout-btn';
            const swatch = makeVariantSwatch(resolveVariantPreview(dec, vi));
            if (swatch) vBtn.appendChild(swatch);
            vBtn.appendChild(document.createTextNode(dec.variants[vi]));
            const variantIdx = vi;
            if (vi === defaultVi) vBtn.classList.add('active');
            vBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              rememberVariant(key, variantIdx);
              if (this._onDecorationSelect) this._onDecorationSelect(key, variantIdx);
              setPreview(variantIdx);
              flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
              vBtn.classList.add('active');
              this._removeParamFlyout();
            });
            flyout.appendChild(vBtn);
          }

          document.body.appendChild(flyout);
          const rect = item.getBoundingClientRect();
          flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
          flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
          this._activeParamFlyout = flyout;

          // Auto-arm with the remembered variant so clicking the item is
          // enough to start placing — the flyout just lets them re-pick.
          if (this._onDecorationSelect) this._onDecorationSelect(key, defaultVi);

          const closeHandler = (e) => {
            if (!flyout.contains(e.target) && !item.contains(e.target)) {
              this._removeParamFlyout();
              document.removeEventListener('click', closeHandler, true);
            }
          };
          setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
        });
      } else {
        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onDecorationSelect) this._onDecorationSelect(key, 0);
        });
      }

      palette.appendChild(item);
    }
    return;
  }

  // Zone tabs (facility mode): show zone paint tool + furnishings
  const zoneCatDef = MODES.facility?.categories?.[compCategory];
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

    // Zone tile preview — simple colored diamond
    const zPreviewEl = document.createElement('div');
    zPreviewEl.className = 'palette-preview';
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:48px;height:24px;background:${hex};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);opacity:0.7;`;
    zPreviewEl.appendChild(swatch);
    zoneItem.appendChild(zPreviewEl);

    const zoneName = document.createElement('div');
    zoneName.className = 'palette-name';
    zoneName.textContent = zone.name;
    zoneItem.appendChild(zoneName);

    const zoneDesc = document.createElement('div');
    zoneDesc.className = 'palette-cost';
    zoneDesc.textContent = `Requires: ${FLOORS[zone.requiredFloor]?.name || zone.requiredFloor} (drag)`;
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

        const affordable = this.game.state.resources.funding >= _costVal(furn.cost);
        if (!affordable) item.classList.add('unaffordable');

        // Furnishing preview — prefer a 3D thumbnail (parts-based multi-
        // mesh items render with their real geometry); fall back to a
        // hex-clip color swatch for defs without any geometry.
        const fPreviewEl = document.createElement('div');
        fPreviewEl.className = 'palette-preview';
        const thumbUrl = renderComponentThumbnail(key, 96);
        if (thumbUrl) {
          const img = document.createElement('img');
          img.src = thumbUrl;
          img.width = 96;
          img.height = 96;
          img.style.objectFit = 'contain';
          fPreviewEl.appendChild(img);
        } else {
          const swatch = document.createElement('div');
          const c = furn.spriteColor || 0x888888;
          swatch.style.cssText = `width:32px;height:24px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);`;
          fPreviewEl.appendChild(swatch);
        }
        item.appendChild(fPreviewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        const gw = furn.gridW || 1;
        const gh = furn.gridH || 1;
        nameEl.textContent = `${furn.name} (${gw}x${gh})`;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `${_costLabel(furn.cost)}`;
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
    const demolishTools = DEMOLISH_BUTTONS;

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

    // Bulk delete buttons — one per placeable kind. Functional placeholder
    // so the unified removePlaceablesByKind path has UI.
    const game = this.game;
    const bulkDeleteRow = document.createElement('div');
    bulkDeleteRow.className = 'bulk-delete-row';
    bulkDeleteRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; padding:8px 4px;';
    for (const kind of ['beamline', 'furnishing', 'equipment', 'decoration']) {
      const btn = document.createElement('button');
      btn.textContent = `Delete all ${kind}`;
      btn.style.cssText = 'flex:1 1 45%; font-size:11px; padding:4px;';
      btn.onclick = () => {
        if (confirm(`Delete all ${kind} placeables? This cannot be undone.`)) {
          const n = game.removePlaceablesByKind(kind);
          game.log(`Removed ${n} ${kind} placeables`, 'good');
        }
      };
      bulkDeleteRow.appendChild(btn);
    }
    palette.appendChild(bulkDeleteRow);
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

      // Phase 6: the distribution subsection shows the new-system utility-line
      // tools for every infra category that advertises any. Rack-paint buttons
      // are gone.
      const utilityLineTools = subKey === 'distribution' && this.activeMode === 'infra'
        ? (Array.isArray(catDef?.utilityLineTools)
            ? catDef.utilityLineTools
            : (INFRA_DISTRIBUTION[compCategory] || []))
        : [];

      if (subComps.length === 0 && utilityLineTools.length === 0) return;

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'palette-subsection-items';

      // Render new-system utility-line tool buttons at the top. These drive
      // the UtilityLineInputController (click+drag between ports) — distinct
      // from the legacy rack-paint conn tools just below.
      for (const utilityType of utilityLineTools) {
        const descriptor = UTILITY_TYPES[utilityType];
        if (!descriptor) continue;
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const hex = descriptor.color || '#ffffff';
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:36px;height:6px;background:${hex};border-radius:3px;margin:9px auto;box-shadow:0 0 6px ${hex};`;
        previewEl.appendChild(swatch);
        item.appendChild(previewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = descriptor.displayName || utilityType;
        item.appendChild(nameEl);

        const descEl = document.createElement('div');
        descEl.className = 'palette-cost';
        descEl.textContent = '(drag port→port)';
        item.appendChild(descEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          // TODO: Phase 5 will polish tool-picker UI (active-state highlight,
          // mutual exclusion with legacy conn tools in the top bar, etc.).
          document.querySelectorAll('.palette-item.util-line-active')
            .forEach(el => el.classList.remove('util-line-active'));
          item.classList.add('util-line-active');
          if (this._onUtilityLineSelect) this._onUtilityLineSelect(utilityType);
        });

        itemsContainer.appendChild(item);
      }

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

UIHost.prototype._createPaletteItem = function(key, comp, idx) {
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

  // Visually distinguish attachment-type components (placed on beam pipes)
  // from module-type components (placed on the grid).
  if (comp.placement === 'attachment') {
    item.classList.add('attachment-tool');
    item.title = `${comp.name} — attaches to beam pipe`;
  }

  // Sprite preview — use 3D thumbnail if available, otherwise isometric box swatch
  const previewEl = document.createElement('div');
  previewEl.className = 'palette-preview';
  const thumbUrl = renderComponentThumbnail(key, 96);
  if (thumbUrl) {
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.width = 96;
    img.height = 96;
    img.style.objectFit = 'contain';
    previewEl.appendChild(img);
  } else {
    const color = comp.spriteColor || 0x888888;
    const hex = '#' + color.toString(16).padStart(6, '0');
    const darkHex = '#' + this.sprites._darken(color, 0.7).toString(16).padStart(6, '0');
    const rightHex = '#' + this.sprites._darken(color, 0.85).toString(16).padStart(6, '0');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 48 40');
    svg.innerHTML = `<polygon points="24,4 44,14 24,24 4,14" fill="${hex}"/>` +
      `<polygon points="4,14 24,24 24,36 4,26" fill="${darkHex}"/>` +
      `<polygon points="44,14 24,24 24,36 44,26" fill="${rightHex}"/>`;
    previewEl.appendChild(svg);
  }
  item.appendChild(previewEl);

  // RF band badge (top-right corner)
  const bandLabels = { vhf: 'VHF', lband: 'L-band', sband: 'S-band' };
  const bands = comp.rfBands || (comp.rfBand ? [comp.rfBand] : null);
  if (bands) {
    const bandEl = document.createElement('div');
    bandEl.className = 'palette-rf-band';
    for (const b of bands) {
      const line = document.createElement('div');
      line.textContent = bandLabels[b] || b;
      bandEl.appendChild(line);
    }
    // RF output power (green) for infra RF sources
    if (comp.category === 'rfPower' && comp.params?.power) {
      const pwrLine = document.createElement('div');
      pwrLine.className = 'palette-rf-output';
      pwrLine.textContent = `${comp.params.power} kW`;
      bandEl.appendChild(pwrLine);
    }
    // RF power draw (red) for beamline accel components
    if (comp.rfPowerRequired) {
      const rfLine = document.createElement('div');
      rfLine.className = 'palette-rf-draw';
      rfLine.textContent = `${comp.rfPowerRequired} kW`;
      bandEl.appendChild(rfLine);
    }
    item.appendChild(bandEl);
  }

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
    // Components with paramOptions (e.g. source particleType) get a flyout above the item
    if (comp.paramOptions && Object.keys(comp.paramOptions).length > 0) {
      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        // Immediately select the tool with default params so preview shows
        if (!this._selectedParamOverrides) this._selectedParamOverrides = {};
        if (!this._selectedParamOverrides[key]) this._selectedParamOverrides[key] = {};
        for (const [pk, opts] of Object.entries(comp.paramOptions)) {
          if (!this._selectedParamOverrides[key][pk]) {
            this._selectedParamOverrides[key][pk] = comp.params?.[pk] ?? opts[0];
          }
        }
        if (isFacility) {
          if (this._onFacilitySelect) this._onFacilitySelect(key);
        } else {
          if (this._onToolSelect) this._onToolSelect(key);
        }
        // Toggle flyout — remove any existing one first
        this._removeParamFlyout();
        const flyout = document.createElement('div');
        flyout.className = 'param-flyout';

        for (const [paramKey, options] of Object.entries(comp.paramOptions)) {
          for (const opt of options) {
            const btn = document.createElement('div');
            btn.className = 'param-flyout-btn';
            btn.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
            // Highlight if this is the currently selected override
            const current = this._selectedParamOverrides?.[key]?.[paramKey];
            if (current === opt || (!current && opt === (comp.params?.[paramKey] ?? options[0]))) {
              btn.classList.add('active');
            }
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              // Store param override
              if (!this._selectedParamOverrides) this._selectedParamOverrides = {};
              if (!this._selectedParamOverrides[key]) this._selectedParamOverrides[key] = {};
              this._selectedParamOverrides[key][paramKey] = opt;
              // Highlight selected
              flyout.querySelectorAll('.param-flyout-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              // Select the tool
              if (isFacility) {
                if (this._onFacilitySelect) this._onFacilitySelect(key);
              } else {
                if (this._onToolSelect) this._onToolSelect(key);
              }
              this._removeParamFlyout();
            });
            flyout.appendChild(btn);
          }
        }

        // Portal to body, positioned above the palette item
        document.body.appendChild(flyout);
        const rect = item.getBoundingClientRect();
        flyout.style.left = (rect.left + rect.width / 2 - flyout.offsetWidth / 2) + 'px';
        flyout.style.top = (rect.top - flyout.offsetHeight - 4) + 'px';
        this._activeParamFlyout = flyout;

        // Close on outside click
        const closeHandler = (e) => {
          if (!flyout.contains(e.target) && !item.contains(e.target)) {
            this._removeParamFlyout();
            document.removeEventListener('click', closeHandler, true);
          }
        };
        setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
      });
    } else {
      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (isFacility) {
          if (this._onFacilitySelect) this._onFacilitySelect(key);
        } else if (comp.isRack && this._onInfraSelect) {
          this._onInfraSelect(key);
        } else {
          if (this._onToolSelect) this._onToolSelect(key);
        }
      });
    }
  }

  return item;
};

UIHost.prototype._removeParamFlyout = function() {
  if (this._activeParamFlyout) {
    this._activeParamFlyout.remove();
    this._activeParamFlyout = null;
  }
};

UIHost.prototype._showPalettePreview = function(comp) {
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
    html += statRow('Length', `${((comp.subL || 4) * 0.5).toFixed(1)} m`);
    if (comp.stats) {
      for (const [k, v] of Object.entries(comp.stats)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        if (k === 'energyGain') {
          const e = formatEnergy(v);
          html += statRow(label, `${e.val} ${e.unit}`);
        } else if (k === 'gradient') {
          html += statRow('Gradient', `${v} MV/m`);
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

UIHost.prototype._hidePalettePreview = function() {
  const preview = document.getElementById('component-preview');
  if (preview) preview.classList.add('hidden');
};

UIHost.prototype.updatePalette = function(category) {
  this._renderPalette(category);
};

// --- HUD event bindings ---

UIHost.prototype._bindHUDEvents = function() {
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
      const connTools = document.getElementById('connection-tools');
      if (connTools) connTools.style.display = mode === 'infra' ? '' : 'none';
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

  // Wall visibility mode buttons
  document.querySelectorAll('.wall-vis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wall-vis-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.wallVisibilityMode = btn.dataset.wallMode;
      this._cutawayHoverKey = null; // force room re-detection
      this._transparentHoverKey = null; // force tile region re-detection
      this._applyWallVisibility();
      this._applyDoorVisibility();
    });
  });

  // Hide wall visibility control when not in game view
  const wallVisControl = document.getElementById('wall-visibility-control');
  if (wallVisControl && this.game.viewRouter) {
    this.game.viewRouter.on((view) => {
      wallVisControl.classList.toggle('hidden', view !== 'game');
    });
  }
};

// --- System Stats Panel ---

UIHost.prototype._updateSystemStatsVisibility = function() {
  const panel = document.getElementById('system-stats-panel');
  if (!panel) return;
  if (this.activeMode === 'facility' || this.activeMode === 'infra') {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
};

UIHost.prototype._updateSystemStatsContent = function(category) {
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

UIHost.prototype._refreshSystemStatsValues = function() {
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

UIHost.prototype._sstat = function(label, value, unit, quality) {
  const cls = quality ? ` ${quality}` : '';
  return `<span class="sstat"><span class="sstat-label">${label}</span><span class="sstat-val${cls}">${value}</span><span class="sstat-unit">${unit}</span></span>`;
};

UIHost.prototype._ssep = function() { return '<span class="sstat-sep">|</span>'; };

UIHost.prototype._detailRow = function(label, value, unit) {
  return `<div class="sstat-detail-row"><span class="sstat-detail-label">${label}</span><span class="sstat-detail-val">${value}</span><span class="sstat-detail-unit">${unit || ''}</span></div>`;
};

UIHost.prototype._fmtPressure = function(p) {
  if (p >= 1) return p.toFixed(0);
  const exp = Math.floor(Math.log10(p));
  const mantissa = p / Math.pow(10, exp);
  return `${mantissa.toFixed(1)}\u00d710${this._superscript(exp)}`;
};

UIHost.prototype._superscript = function(n) {
  const sup = { '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207b' };
  return String(n).split('').map(c => sup[c] || c).join('');
};

UIHost.prototype._qualityColor = function(q) {
  if (q === 'Excellent' || q === 'Good') return 'good';
  if (q === 'Marginal') return 'warn';
  if (q === 'Poor') return 'bad';
  return '';
};

UIHost.prototype._marginColor = function(m) {
  if (m > 30) return 'good';
  if (m > 10) return 'warn';
  return 'bad';
};

UIHost.prototype._renderVacuumStats = function(d, summary, detail) {
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

UIHost.prototype._renderRfPowerStats = function(d, summary, detail) {
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

UIHost.prototype._renderCryoStats = function(d, summary, detail, append = false) {
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

UIHost.prototype._renderCoolingStats = function(d, summary, detail) {
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

UIHost.prototype._renderPowerStats = function(d, summary, detail) {
  const uc = d.utilization > 90 ? 'bad' : (d.utilization > 70 ? 'warn' : 'good');
  summary.innerHTML = [
    this._sstat('Capacity', this._fmt(d.capacity), 'kW'),
    this._ssep(),
    this._sstat('Draw', d.totalDraw.toFixed(1), 'kW'),
    this._ssep(),
    this._sstat('Util', d.utilization.toFixed(0), '%', uc),
    this._ssep(),
    this._sstat('Transformers', d.substations, ''),
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

UIHost.prototype._renderDataControlsStats = function(d, summary, detail) {
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

UIHost.prototype._renderOpsStats = function(d, summary, detail) {
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
