// === HUD EXTENSION ===
// Adds HUD update, palette rendering, beam button, and system stats to UIHost.prototype.

import { isFacilityCategory } from '../renderer/Renderer.js';
import { UIHost } from './UIHost.js';
import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { ZONES, ZONE_FURNISHINGS, ZONE_TIER_THRESHOLDS, itemMatchesZone } from '../data/facility.js';
import { MODES, INFRA_DISTRIBUTION } from '../data/modes.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { openBeamlineTypePicker, beamlineTypeHidesComponent } from './BeamlineTypePicker.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { RF_BANDS } from '../utility/types/rfWaveguide.js';
import { DECORATIONS } from '../data/decorations.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { renderComponentThumbnail } from '../renderer3d/component-builder.js';
import { renderDecorationThumbnail } from '../renderer3d/decoration-builder.js';
import { DEMOLISH_BUTTONS } from '../input/demolishScopes.js';
import { ContextWindow } from './ContextWindow.js';
import { openWikiWindow } from './WikiWindow.js';
import { openStaffInspector } from './StaffInspector.js';
import { openHiringDialog } from './HiringDialog.js';
import { fmtMoney, ROLE_COLORS, staffInitials, staffMoodClass } from './format.js';
import { beamlineEnergyDraw, facilityEnergyDraw } from '../game/aggregates.js';
import { makeUtilityEndpointIndex } from '../utility/utility-endpoints.js';
import { portWorldPosition } from '../utility/ports.js';

function _costVal(cost) {
  return (typeof cost === 'object' && cost !== null) ? (cost.funding ?? 0) : cost;
}
function _costLabel(cost) {
  return fmtMoney(_costVal(cost));
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

  // Facility overview (top-left panel) — aggregated stats across the facility.
  //
  // This panel used to sum the per-beamline beamState values AND add
  // state.mainBeamState on top, described as "the main-map pipe-graph
  // contribution". It is not a separate contribution: _deriveBeamGraph walks
  // EVERY beamline source in state.placeables and _ensureBeamlineForSource-
  // Placeable gives each of those sources a registry entry, so the two cover
  // the same machines and every figure here read roughly double. Each
  // quantity now comes from exactly one place:
  //   data rate  — the sum of the published effectiveDataRate, i.e. the rate
  //                the facility is PAID for (raw dataRate is the un-derated
  //                physics number; a cut fiber earns nothing);
  //   beam power — beamlineEnergyDraw, the same value economy.js bills;
  //   length / peak energy — the roll-up _updateAggregateBeamline already
  //                writes onto state.
  {
    const entries = this.game.registry.getAll();

    const totalDataRate = entries.reduce((sum, e) => sum + (e.beamState.effectiveDataRate || 0), 0);
    const totalBeamPower = beamlineEnergyDraw(s);
    const totalLength = s.totalLength || 0;
    const peakEnergy = s.beamEnergy || 0;

    // Power stats. facilityEnergyDraw is the basis for the power bill and for
    // systemStats.power.totalDraw alike — quoting it directly keeps the panel
    // from drifting off the invoice if computeSystemStats hasn't run yet.
    const totalPower = Math.round(facilityEnergyDraw(s));
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

  // If the Goals overlay is open, keep its tutorial progress fresh.
  const goalsOverlay = document.getElementById('goals-overlay');
  if (goalsOverlay && !goalsOverlay.classList.contains('hidden')) {
    this._renderGoalsOverlay();
  }

  // Staff bar (top bar portraits)
  this._renderStaffBar();

  // Pause/speed buttons (also refreshed directly on 'speedChanged')
  this._updateSimControls();
};

// Reflect state.paused / state.speed on the top-bar sim controls.
UIHost.prototype._updateSimControls = function() {
  const s = this.game.state;
  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    pauseBtn.classList.toggle('active', !!s.paused);
    // Paused shows a play glyph (click resumes); running shows pause bars.
    pauseBtn.innerHTML = s.paused ? '&#9654;' : '&#10074;&#10074;';
    pauseBtn.title = s.paused ? 'Resume (P)' : 'Pause (P)';
  }
  document.querySelectorAll('#sim-controls .speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.speed, 10) === (s.speed || 1));
  });
};

UIHost.prototype._updateBeamSummary = function() {
  const el = document.getElementById('beam-summary');
  if (!el) return;
  const entries = this.game.registry.getAll();
  const running = entries.filter(e => e.status === 'running').length;
  const total = entries.length;
  const blockers = this.game.state.infraBlockers || [];
  const canRun = this.game.state.infraCanRun !== false;
  if (!canRun && blockers.length > 0) {
    const hardCount = blockers.filter(b => b.severity === 'hard').length;
    // The bar only carries a chip — the full breakdown is in the fault popup,
    // which the chip reopens after it has been dismissed.
    el.textContent = `⚠ ${hardCount} FAULT${hardCount === 1 ? '' : 'S'}`;
    el.className = 'beam-summary fault';
    el.title = 'Beam tripped — click for details\n'
      + blockers.map(b => b.message || b.code).join('\n');
    el.onclick = () => this._showInfraBlockerPanel();
  } else if (total === 0) {
    el.textContent = 'No beamlines';
    el.className = 'beam-summary';
    el.title = '';
    el.onclick = null;
  } else {
    el.textContent = `${running}/${total} beamlines running`;
    el.className = running > 0 ? 'beam-summary active' : 'beam-summary';
    el.title = '';
    el.onclick = null;
  }
  this._renderInfraBlockerList();
};

// --- Infrastructure fault popup ---
//
// The top-left popup that owns the whole fault story: a headline ("beam
// tripped"), a dismiss button, and one row per offending COMPONENT (not per
// port) — a cavity missing power, RF and cryo is one problem to the player,
// three blockers to the gate. Rows that resolve to a world position are
// clickable and frame the camera on the offender, which is the whole point —
// with on-pipe placements wired individually, "20 hard blockers" is otherwise
// an unnavigable list.
//
// Dismissal is keyed to the blocker signature, so closing it stays closed
// while the same fault persists but a NEW fault pops back up. The top-bar
// chip reopens it on demand.
//
// Panel DOM is created here rather than in index.html so this HUD element is
// self-contained; styles are inline for the same reason.
const BLOCKER_PANEL_ID = 'infra-blocker-panel';
const BLOCKER_ROWS_SHOWN = 10;

function ensureBlockerPanel() {
  let panel = document.getElementById(BLOCKER_PANEL_ID);
  if (panel) return panel;
  const host = document.getElementById('game') || document.body;
  if (!host) return null;
  panel = document.createElement('div');
  panel.id = BLOCKER_PANEL_ID;
  // Left column, under the facility overview. The top-right column is taken
  // by the music player and the infra-mode utility stats panel, which stack
  // downward from ~56px and would bury this.
  panel.style.cssText = [
    'position:absolute', 'top:150px', 'left:10px', 'z-index:102',
    'width:250px', 'max-height:44vh', 'overflow-y:auto',
    'font-family:monospace', 'font-size:10px',
    'background:rgba(30,8,8,0.94)', 'border:1px solid rgba(255,90,90,0.45)',
    'border-radius:3px', 'padding:5px 6px', 'color:#ffa08c',
    'box-shadow:0 4px 14px rgba(0,0,0,0.5)',
    'display:none',
  ].join(';');
  host.appendChild(panel);
  return panel;
}

// Park the panel below the top bar and below the facility overview, whose
// height depends on how many stat rows are live (and which hides itself
// entirely when none are). Both are measured rather than assumed — a fixed
// offset slid under the top bar as soon as the overview collapsed.
function positionBlockerPanel(panel) {
  const bar = document.getElementById('top-bar');
  let top = bar ? bar.offsetTop + bar.offsetHeight + 6 : 42;
  const above = document.getElementById('beam-stats-panel');
  if (above && above.style.display !== 'none' && above.offsetHeight > 0) {
    top = Math.max(top, above.offsetTop + above.offsetHeight + 8);
  }
  panel.style.top = `${top}px`;
}

UIHost.prototype._renderInfraBlockerList = function() {
  const panel = ensureBlockerPanel();
  if (!panel) return;
  const state = this.game.state;
  const blockers = state.infraBlockers || [];

  // Signature guard: this runs every tick, and the DOM rebuild below walks
  // every utility endpoint (state.placeables plus every pipe placement) to
  // resolve offender positions. A steady fault costs one string join.
  const sig = blockers
    .map(b => `${b.code}@${b.location?.placeableId || ''}:${b.location?.portName || ''}`)
    .join('|');
  // Reposition regardless: the facility overview above grows and shrinks with
  // what is live, independently of the blocker set — as does the top bar,
  // which wraps to extra rows on a narrow window.
  if (blockers.length > 0) positionBlockerPanel(panel);
  if (sig === this._infraBlockerSig) return;
  this._infraBlockerSig = sig;

  panel.textContent = '';
  if (blockers.length === 0) {
    panel.style.display = 'none';
    // Clearing the faults clears the dismissal too, so an identical fault set
    // coming back later is treated as news rather than as still-dismissed.
    this._infraBlockerDismissedSig = null;
    return;
  }
  // A dismissal only silences the exact fault set it was aimed at; the
  // signature changing means something new went wrong, so speak up again.
  panel.style.display = this._infraBlockerDismissedSig === sig ? 'none' : '';

  // Only build the endpoint index when something actually needs locating.
  const needsIndex = blockers.some(b => b.location?.placeableId);
  const byId = needsIndex ? makeUtilityEndpointIndex(state) : new Map();

  // Group by offender. Keyed on placeableId; blockers with no component
  // (staffing, per-network faults) each stand alone.
  const groups = new Map();
  for (const b of blockers) {
    const id = b.location?.placeableId;
    const key = id || `#${groups.size}`;
    let g = groups.get(key);
    if (!g) {
      const ep = id ? byId.get(id) : null;
      g = {
        ep,
        // Frame on the offending PORT, not the component centre — that is the
        // spot the player has to drag a line to.
        world: ep ? portWorldPosition(ep, COMPONENTS[ep.type], b.location.portName) : null,
        title: ep ? (COMPONENTS[ep.type]?.name || ep.type) : (b.message || b.code),
        utilities: [],
        codes: [],
      };
      groups.set(key, g);
    }
    g.codes.push(b.code);
    if (g.ep) {
      const util = COMPONENTS[g.ep.type]?.ports?.[b.location.portName]?.utility;
      if (util && !g.utilities.includes(util)) g.utilities.push(util);
    }
  }

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;';

  const headText = document.createElement('div');
  headText.style.cssText = 'flex:1;font-size:9px;letter-spacing:0.5px;color:#ff7766;line-height:1.5;';
  const title = document.createElement('div');
  title.textContent = 'INFRA FAULT — BEAM TRIPPED';
  title.style.cssText = 'color:#ff5544;';
  headText.appendChild(title);
  const unwired = blockers.filter(b => b.fromUnconnectedCheck).length;
  const sub = document.createElement('div');
  // The unwired count is called out separately because it is the one class
  // of blocker the player fixes by drawing a line, and on-pipe placements
  // produce it a dozen at a time.
  sub.textContent = `${blockers.length} BLOCKER${blockers.length > 1 ? 'S' : ''}`
    + (unwired > 0 ? ` · ${unwired} UNWIRED SINK${unwired > 1 ? 'S' : ''}` : '');
  headText.appendChild(sub);
  header.appendChild(headText);

  const close = document.createElement('button');
  close.textContent = '×';
  close.title = 'Dismiss (reopen from the fault chip in the top bar)';
  close.style.cssText = [
    'flex-shrink:0', 'width:14px', 'height:14px', 'line-height:1',
    'background:rgba(70,20,20,0.8)', 'border:1px solid rgba(255,90,90,0.45)',
    'border-radius:2px', 'color:#ffa08c', 'font-family:monospace',
    'font-size:11px', 'cursor:pointer', 'padding:0',
  ].join(';');
  close.addEventListener('click', () => {
    this._infraBlockerDismissedSig = sig;
    panel.style.display = 'none';
  });
  header.appendChild(close);
  panel.appendChild(header);

  const list = [...groups.values()];
  for (const g of list.slice(0, BLOCKER_ROWS_SHOWN)) {
    const row = document.createElement('div');
    const locatable = !!g.world;
    row.style.cssText = [
      'padding:3px 4px', 'margin-bottom:2px', 'border-radius:2px',
      'background:rgba(70,20,20,0.55)',
      `cursor:${locatable ? 'pointer' : 'default'}`,
      'display:flex', 'gap:6px', 'align-items:baseline',
    ].join(';');

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;color:#ffcbbc;';
    label.textContent = g.title;
    row.appendChild(label);

    if (g.utilities.length > 0) {
      const tags = document.createElement('span');
      tags.style.cssText = 'flex-shrink:0;';
      for (const u of g.utilities) {
        const tag = document.createElement('span');
        tag.textContent = '●';
        tag.title = `${UTILITY_TYPES[u]?.displayName || u} not connected`;
        tag.style.cssText = `color:${UTILITY_TYPES[u]?.color || '#fff'};margin-left:3px;`;
        tags.appendChild(tag);
      }
      row.appendChild(tags);
    }

    if (locatable) {
      const { x, z } = g.world;
      row.title = `${g.title} — ${g.codes.join(', ')}\nClick to locate`;
      row.addEventListener('click', () => {
        this.renderer?.focusOnWorld?.(x, z);
      });
      const locate = document.createElement('span');
      locate.textContent = '⌖';
      locate.style.cssText = 'flex-shrink:0;color:#ff9a80;';
      row.appendChild(locate);
    } else {
      row.title = g.codes.join(', ');
    }
    panel.appendChild(row);
  }

  if (list.length > BLOCKER_ROWS_SHOWN) {
    const more = document.createElement('div');
    more.textContent = `… and ${list.length - BLOCKER_ROWS_SHOWN} more`;
    more.style.cssText = 'font-size:9px;color:#cc8877;padding:2px 4px;';
    panel.appendChild(more);
  }
};

// Undo a dismissal and force a rebuild — the top-bar fault chip's click target.
UIHost.prototype._showInfraBlockerPanel = function() {
  this._infraBlockerDismissedSig = null;
  this._infraBlockerSig = null;
  this._renderInfraBlockerList();
};

// --- Palette rendering ---

UIHost.prototype._generateCategoryTabs = function() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES[this.activeMode];
  if (!mode || mode.disabled) return;

  // Beamline mode leads with the New Beamline button — RCT2's ride list, and
  // the only entry point to the type picker. It doubles as the readout for
  // which type the palette below is currently filtered to.
  if (this.activeMode === 'beamline') {
    tabsContainer.appendChild(this._buildNewBeamlineButton());
  }

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
};

/**
 * The New Beamline button, rebuilt on every tab regeneration so its label
 * always reports the live filter state:
 *   - no type      → "+ New Beamline"
 *   - pending pick → the type name, still waiting for a source to be placed
 *   - typed line   → the type name of the beamline under edit
 */
UIHost.prototype._buildNewBeamlineButton = function() {
  const btn = document.createElement('button');
  btn.className = 'new-beamline-btn';

  const typeId = this.game.getActiveBeamlineTypeId?.();
  const type = typeId ? getBeamlineType(typeId) : null;
  const pending = !!this.game.pendingBeamlineTypeId;

  if (type) {
    btn.textContent = (pending ? '▸ ' : '◆ ') + type.name;
    btn.classList.add('has-type');
    if (pending) btn.classList.add('pending');
    const accent = '#' + type.accentColor.toString(16).padStart(6, '0');
    btn.style.borderColor = accent;
    btn.style.color = accent;
    btn.title = pending
      ? `${type.name} — place a source to start it. Click to pick a different type.`
      : `Palette filtered to ${type.name}. Click to start another beamline.`;
  } else {
    btn.textContent = '+ New Beamline';
    btn.title = 'Choose what your next beamline is for';
  }

  btn.addEventListener('click', () => this._openBeamlineTypePicker());
  return btn;
};

/**
 * Re-sync the New Beamline button and the palette to the active type without
 * rebuilding the tab bar — the player's current tab survives, which matters
 * because this runs on every beamline click.
 */
UIHost.prototype._syncBeamlineTypeChrome = function() {
  const old = document.querySelector('#category-tabs .new-beamline-btn');
  if (old) old.replaceWith(this._buildNewBeamlineButton());
  this._refreshPalette();
};

/**
 * Open the type picker and apply whatever it returns to the build palette.
 *
 * Two outcomes, both starting from the same armed pick: a custom build leaves
 * the player with a filtered palette and nothing placed, while a stock
 * blueprint goes straight to a placement ghost that carries its own source
 * (see main.js's startDesignPlacement for why the arming has to come first).
 */
UIHost.prototype._openBeamlineTypePicker = function() {
  openBeamlineTypePicker(this.game, {
    onConfirm: (typeId, design) => {
      this.game.startNewBeamline(typeId);
      // Rebuild tabs (the button label) and the palette (the filter) together,
      // landing on Sources — the only category you can actually start from.
      this._generateCategoryTabs();
      this._applyPaletteHotkeyBadges();
      if (design) this.game._startDesignPlacement?.(design);
    },
  });
};

UIHost.prototype._refreshPalette = function() {
  const activeTab = document.querySelector('.cat-tab.active');
  if (activeTab?.dataset.category) {
    this._renderPalette(activeTab.dataset.category);
  }
};

UIHost.prototype._renderPalette = function(tabCategory) {
  this._renderPaletteImpl(tabCategory);
  this._applyPaletteHotkeyBadges();
};

UIHost.prototype._renderPaletteImpl = function(tabCategory) {
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
      item.dataset.paletteKey = key;
      item.dataset.paletteKind = 'floor';
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
        this._selectPaletteTool('floor', key);
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
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'wall';
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

        this._attachSimpleHoverPreview(item, infra.name, infra.desc, [
          ['Cost', `${_costLabel(infra.cost)}/segment`],
          ['Placement', 'Drag along tile edges'],
        ]);

        if (infra.variants && infra.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            // Pre-select on open so clicks elsewhere still use the remembered variant.
            this._selectPaletteTool('wall', key, defaultVi);

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
                this._selectPaletteTool('wall', key, variantIdx);
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
            this._selectPaletteTool('wall', key);
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
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'door';
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

        this._attachSimpleHoverPreview(item, door.name, door.desc, [
          ['Cost', `${_costLabel(door.cost)}/segment`],
          ['Placement', 'Place on a wall edge'],
        ]);

        if (door.variants && door.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            this._selectPaletteTool('door', key, defaultVi);

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
                this._selectPaletteTool('door', key, variantIdx);
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
            this._selectPaletteTool('door', key);
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
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'floor';
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

        const floorStats = [
          ['Cost', `${_costLabel(infra.cost)}/tile`],
          ['Placement', infra.isLinePlacement ? 'Drag a line' : 'Drag an area'],
        ];
        if (infra.requiresFoundation) {
          floorStats.push(['Requires', FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation]);
        }
        this._attachSimpleHoverPreview(item, infra.name, infra.desc, floorStats);

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
                this._selectPaletteTool('floor', key, variantIdx);
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
            this._selectPaletteTool('floor', key, defaultVi);

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
            this._selectPaletteTool('floor', key);
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
      item.dataset.paletteKey = key;
      item.dataset.paletteKind = 'floor';
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

      this._attachSimpleHoverPreview(item, infra.name, infra.desc, [
        ['Cost', `${_costLabel(infra.cost)}/tile`],
        ['Placement', 'Drag an area'],
      ]);

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
              this._selectPaletteTool('floor', key, variantIdx);
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

          this._selectPaletteTool('floor', key, defaultVi);

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
          this._selectPaletteTool('floor', key);
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
      item.dataset.paletteKey = key;
      item.dataset.paletteKind = 'wall';
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

      this._attachSimpleHoverPreview(item, infra.name, infra.desc, [
        ['Cost', `${_costLabel(infra.cost)}/segment`],
        ['Placement', 'Drag along tile edges'],
      ]);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        this._selectPaletteTool('wall', key);
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
      item.dataset.paletteKey = key;
      item.dataset.paletteKind = 'decoration';
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

      const decStats = [['Cost', _costLabel(dec.cost)]];
      if (dec.morale) decStats.push(['Morale', `+${dec.morale}`]);
      if (dec.placement === 'outdoor') decStats.push(['Placement', 'Outdoor only']);
      if (dec.blocksBuild) decStats.push(['Blocks building', 'Yes']);
      this._attachSimpleHoverPreview(item, dec.name, dec.desc, decStats);

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
              this._selectPaletteTool('decoration', key, variantIdx);
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
          this._selectPaletteTool('decoration', key, defaultVi);

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
          this._selectPaletteTool('decoration', key, 0);
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
    zoneItem.dataset.paletteKey = zoneType;
    zoneItem.dataset.paletteKind = 'zone';
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

    this._attachSimpleHoverPreview(zoneItem, zone.name, zone.desc, [
      ['Requires', FLOORS[zone.requiredFloor]?.name || zone.requiredFloor],
      ['Placement', 'Drag an area'],
    ]);

    zoneItem.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(zoneIdx);
      this._selectPaletteTool('zone', zoneType);
    });
    zoneItems.appendChild(zoneItem);
    zoneSection.appendChild(zoneItems);
    palette.appendChild(zoneSection);

    // Furnishings section
    const furnEntries = Object.entries(ZONE_FURNISHINGS).filter(([, f]) => itemMatchesZone(f, zoneType));
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
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'furnishing';
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

        const furnStats = [
          ['Cost', _costLabel(furn.cost)],
          ['Size', `${gw}×${gh}`],
        ];
        if (furn.energyCost) furnStats.push(['Energy', `${furn.energyCost} kW`]);
        furnStats.push(['Zone', zone.name]);
        this._attachSimpleHoverPreview(item, furn.name, furn.desc, furnStats);

        const furnHasVariants = Array.isArray(furn.variants) && furn.variants.length > 1;
        if (furnHasVariants) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            for (let vi = 0; vi < furn.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.className = 'param-flyout-btn';
              const swatch = makeVariantSwatch(resolveVariantPreview(furn, vi));
              if (swatch) vBtn.appendChild(swatch);
              vBtn.appendChild(document.createTextNode(furn.variants[vi]));
              const variantIdx = vi;
              if (vi === defaultVi) vBtn.classList.add('active');
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rememberVariant(key, variantIdx);
                this._selectPaletteTool('furnishing', key, variantIdx);
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

            // Auto-arm with the remembered variant so clicking is enough to start placing.
            this._selectPaletteTool('furnishing', key, defaultVi);

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
            this._selectPaletteTool('furnishing', key);
          });
        }

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
      item.dataset.paletteKey = tool.key;
      item.dataset.paletteKind = 'demolish';
      const idx = paletteIdx++;
      item.style.borderLeft = `4px solid ${tool.color}`;

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = tool.cardName || tool.name;
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-cost';
      descEl.textContent = tool.sub || tool.desc;
      item.appendChild(descEl);

      this._attachSimpleHoverPreview(item, tool.name, tool.desc);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        this._selectPaletteTool('demolish', tool.key);
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

      // Each infra category's `transport` subsection shows the new-system
      // utility-line tools for that category's utility type(s). Rendered
      // first so the player sees the transport option before equipment.
      const utilityLineTools = subKey === 'transport' && this.activeMode === 'infra'
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
        item.dataset.paletteKey = utilityType;
        item.dataset.paletteKind = 'utility';
        const idx = paletteIdx++;

        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const hex = descriptor.color || '#ffffff';
        const swatch = document.createElement('div');
        // Outlined, not just glowing: HV cable is black so it reads as trunk in
        // the world, and a black swatch with a black glow is invisible against
        // the palette's dark chrome. The rule stays 1px on every utility so the
        // swatches remain a set rather than one special case.
        swatch.style.cssText = `width:36px;height:6px;background:${hex};border-radius:3px;`
          + `margin:9px auto;border:1px solid rgba(255,255,255,0.4);box-sizing:border-box;`
          + `box-shadow:0 0 6px ${hex};`;
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
          this._selectPaletteTool('utility', utilityType);
        });

        // Hover popup — show descriptor-based info instead of the stale
        // component-popup content from whichever item was hovered last.
        item.addEventListener('mouseenter', () => {
          this._showUtilityLinePreview(descriptor);
        });
        item.addEventListener('mouseleave', () => {
          this._hidePalettePreview();
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

UIHost.prototype._applyPaletteHotkeyBadges = function() {
  const HOTKEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
  const items = document.querySelectorAll('#component-palette .palette-item');
  items.forEach((item, idx) => {
    if (idx >= HOTKEYS.length) return;
    let badge = item.querySelector(':scope > .palette-hotkey');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'palette-hotkey';
      item.appendChild(badge);
    }
    badge.textContent = HOTKEYS[idx];
  });
};

// Thin binding to the shared predicate — see BeamlineTypePicker.js for the
// rule itself and why it lives there.
UIHost.prototype._beamlineTypeHidesComponent = function(key, comp) {
  return beamlineTypeHidesComponent(this.game.getActiveBeamlineTypeId?.(), key, comp);
};

// The RF sink port of a component, as {band, frequency} in Hz — the band an
// accelerating structure NEEDS, as opposed to the bands a tube can serve.
// Null for anything that doesn't take RF.
function rfSinkPort(comp) {
  const ports = comp && comp.ports;
  if (!ports) return null;
  for (const spec of Object.values(ports)) {
    if (!spec || spec.utility !== 'rfWaveguide' || spec.role !== 'sink') continue;
    const p = spec.params || {};
    if (!p.band && !(p.frequency > 0)) continue;
    return { band: p.band || null, frequency: p.frequency || 0 };
  }
  return null;
}

// Hz → the shortest reading that keeps the number recognisable: 1300 MHz, not
// 1.3 GHz (the catalogue and the literature both quote these in MHz).
function formatRfFrequency(hz) {
  const mhz = hz / 1e6;
  return `${mhz >= 100 ? Math.round(mhz) : Math.round(mhz * 10) / 10} MHz`;
}

UIHost.prototype._createPaletteItem = function(key, comp, idx) {
  const unlocked = this.game.isComponentUnlocked(comp);
  if (!unlocked) return null;

  // Beamline-type filter. This slot used to hold a MACHINE_TIER gate keyed on
  // the editing beamline's machine type, which was dead machinery — nothing
  // ever set machineType to anything but 'linac' — and whose only live effect
  // was to hide four components forever. It was removed with a note asking for
  // "a real machine-type progression path" before tier gating came back. This
  // is that path: a beamline's TYPE (src/data/beamline-types.js), chosen once
  // in the New Beamline picker and never inferred, decides what its palette
  // contains. Untyped beamlines — every pre-picker save, every scenario — see
  // the whole catalogue, exactly as they do today.
  if (this._beamlineTypeHidesComponent(key, comp)) return null;

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
  item.dataset.paletteKey = key;
  item.dataset.paletteKind = isFacility ? 'facility' : 'component';

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

  // RF band badge (top-right corner).
  //
  // Sources declare `rfBands` — what the tube can cover. Accelerating
  // structures declare a FREQUENCY, and their band is derived onto the rf_in
  // port (utility-ports-v2). Reading only the raw field left every cavity in
  // the beamline palette unlabelled, which is the half that actually needs
  // it: a source powers any frequency in a band it covers, but one network
  // carries one frequency, so "which band, and what frequency inside it" is
  // the decision being made at the moment of placing the cavity.
  const bandLabels = Object.fromEntries(RF_BANDS.map(b => [b.id, b.label]));
  const rfSink = rfSinkPort(comp);
  const bands = comp.rfBands
    || (comp.rfBand ? [comp.rfBand] : null)
    || (rfSink && rfSink.band ? [rfSink.band] : null);
  if (bands) {
    const bandEl = document.createElement('div');
    bandEl.className = 'palette-rf-band';
    for (const b of bands) {
      const line = document.createElement('div');
      line.textContent = bandLabels[b] || b;
      bandEl.appendChild(line);
    }
    // The exact frequency, for the components that need one specific network.
    if (rfSink && rfSink.frequency > 0) {
      const freqLine = document.createElement('div');
      freqLine.className = 'palette-rf-freq';
      freqLine.textContent = formatRfFrequency(rfSink.frequency);
      bandEl.appendChild(freqLine);
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
        this._selectPaletteTool(isFacility ? 'facility' : 'component', key);
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
              this._selectPaletteTool(isFacility ? 'facility' : 'component', key);
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
        // (The old comp.isRack → infra-select branch died with the rack
        // system in Phase 6 — no COMPONENTS entry sets isRack anymore.)
        this._selectPaletteTool(isFacility ? 'facility' : 'component', key);
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

UIHost.prototype._showUtilityLinePreview = function(descriptor) {
  const preview = document.getElementById('component-preview');
  if (!preview || !descriptor) return;

  const nameEl = document.getElementById('preview-name');
  if (nameEl) nameEl.textContent = descriptor.displayName || descriptor.type;

  const descEl = document.getElementById('preview-desc');
  if (descEl) {
    descEl.textContent = `${descriptor.displayName || descriptor.type} transport line. Click a source port on one placeable and drag to a matching sink port on another. Lines must connect two valid ports of the same utility type.`;
  }

  // Hide schematic — not meaningful for abstract utility lines.
  const schematicCanvas = document.getElementById('preview-schematic');
  if (schematicCanvas) schematicCanvas.style.display = 'none';

  const statsEl = document.getElementById('preview-stats');
  if (statsEl) {
    const statRow = (label, val) =>
      `<div class="prev-stat-row"><span>${label}</span><span class="prev-stat-val">${val}</span></div>`;
    const hex = descriptor.color || '#ffffff';
    const styleLabel = {
      cylinder: 'Round pipe',
      rectWaveguide: 'Rectangular waveguide',
      jacketedCylinder: 'Vacuum-jacketed pipe',
    }[descriptor.geometryStyle] || descriptor.geometryStyle;
    let html = '';
    html += statRow('Type', descriptor.type);
    html += statRow('Color', `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;background:${hex};box-shadow:0 0 6px ${hex}"></span>`);
    html += statRow('Profile', styleLabel);
    if (descriptor.pipeRadiusMeters != null) {
      html += statRow('Diameter', `${(descriptor.pipeRadiusMeters * 200).toFixed(1)} cm`);
    }
    if (descriptor.capacityUnit) {
      html += statRow('Capacity unit', descriptor.capacityUnit);
    }
    statsEl.innerHTML = html;
  }

  preview.classList.remove('hidden');

  const mainPopup = document.getElementById('component-popup');
  const mainVisible = mainPopup && !mainPopup.classList.contains('hidden');
  if (mainVisible) {
    const mainRect = mainPopup.getBoundingClientRect();
    preview.style.left = (mainRect.right + 8) + 'px';
    preview.style.bottom = '';
    preview.style.top = mainRect.top + 'px';
  } else {
    preview.style.left = '';
    preview.style.top = '';
    preview.style.bottom = '';
  }
};

// Generic preview for non-component palette items (floors, walls, doors,
// zones, furnishings, decorations). Populates the same lower-left
// #component-preview panel used by beamline/infra components.
// `stats` is an array of [label, value] pairs.
UIHost.prototype._showSimplePalettePreview = function(name, desc, stats = []) {
  const preview = document.getElementById('component-preview');
  if (!preview) return;

  const nameEl = document.getElementById('preview-name');
  if (nameEl) nameEl.textContent = name;

  const descEl = document.getElementById('preview-desc');
  if (descEl) descEl.textContent = desc || '';

  // No schematic for these item types.
  const schematicCanvas = document.getElementById('preview-schematic');
  if (schematicCanvas) schematicCanvas.style.display = 'none';

  const statsEl = document.getElementById('preview-stats');
  if (statsEl) {
    statsEl.innerHTML = stats.map(([label, val]) =>
      `<div class="prev-stat-row"><span>${label}</span><span class="prev-stat-val">${val}</span></div>`
    ).join('');
  }

  preview.classList.remove('hidden');

  // Position to the right of the component-popup if visible, otherwise at
  // the default CSS position (lower-left) — same rule as component previews.
  const mainPopup = document.getElementById('component-popup');
  const mainVisible = mainPopup && !mainPopup.classList.contains('hidden');
  if (mainVisible) {
    const mainRect = mainPopup.getBoundingClientRect();
    preview.style.left = (mainRect.right + 8) + 'px';
    preview.style.bottom = '';
    preview.style.top = mainRect.top + 'px';
  } else {
    preview.style.left = '';
    preview.style.top = '';
    preview.style.bottom = '';
  }
};

// Attach mouseenter/mouseleave handlers so hovering a palette item shows
// the simple preview, matching the hover behavior of component items.
UIHost.prototype._attachSimpleHoverPreview = function(item, name, desc, stats = []) {
  item.addEventListener('mouseenter', () => {
    this._showSimplePalettePreview(name, desc, stats);
  });
  item.addEventListener('mouseleave', () => {
    this._hidePalettePreview();
  });
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
  // The build palette is filtered by the type of the beamline being edited, so
  // any change of edit/selection focus can change what it is allowed to show.
  // Nothing else in the app listens to these two events; without this the
  // filter goes stale the moment the player clicks a beamline of another type.
  if (typeof this.game?.on === 'function') {
    this.game.on((ev) => {
      if (ev !== 'editModeChanged' && ev !== 'beamlineSelected') return;
      if (this.activeMode !== 'beamline') return;
      this._syncBeamlineTypeChrome();
    });
  }

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

  // Sim controls: pause toggle + fixed speed steps
  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => this.game.togglePause());
  }
  document.querySelectorAll('#sim-controls .speed-btn').forEach(btn => {
    btn.addEventListener('click', () => this.game.setSpeed(parseInt(btn.dataset.speed, 10)));
  });
  if (this.game && this.game.on) {
    this.game.on((event) => {
      // 'loaded'/'restored' cover a save or undo snapshot restoring a
      // different paused/speed state.
      if (event === 'speedChanged' || event === 'loaded' || event === 'restored') this._updateSimControls();
    });
  }
  this._updateSimControls();

  // Staff: Hire button opens hiring dialog (3 candidates)
  const hireBtn = document.getElementById('btn-hire');
  if (hireBtn) {
    hireBtn.addEventListener('click', () => {
      this._openHiringDialog();
    });
  }

  // Manual: "?" button in the top-right HUD cluster + F1 / ? hotkeys.
  this._bindManualEntryPoints();

  // StaffChanged event refreshes staff bar and any open inspector/hiring windows
  if (this.game && this.game.on) {
    this.game.on((event) => {
      if (event === 'staffChanged') {
        this._renderStaffBar();
        // refresh any open staff inspector windows
        try { this._refreshStaffWindows(); } catch (_) {}
        // hiring dialog auto-refreshes via its own listener, but also poke here
        const hiring = document.querySelector('[data-ctx-id="hiring-dialog"]');
        if (hiring) this._openHiringDialog();
      }
    });
  }
};

// --- Manual / wiki entry points ---

// One window-level F1/? listener for the whole app, pointed at the HUD host
// that bound most recently.
let _manualKeysBound = false;
let _manualKeyHost = null;

/**
 * Component key the manual should open to, or null for the contents page.
 * Preference order: the palette item under the cursor, then the armed tool
 * (palette clicks arm `component:<key>` — see InputHandler.selectPaletteTool).
 * Both are read-only peeks, so the palette needs no changes of its own.
 */
UIHost.prototype._contextualManualComponent = function() {
  const hovered = this._hoveredPaletteComponent;
  if (hovered && COMPONENTS[hovered]) return hovered;
  const toolId = this.renderer?._inputHandler?.activeTool?.id;
  if (typeof toolId === 'string' && toolId.startsWith('component:')) {
    const key = toolId.slice('component:'.length);
    if (COMPONENTS[key]) return key;
  }
  return null;
};

/** Open the manual, landing on the contextual component page when there is one. */
UIHost.prototype._openManual = function({ toggle = false, contextual = false } = {}) {
  const componentId = contextual ? this._contextualManualComponent() : null;
  openWikiWindow({ componentId, toggle: toggle && !componentId });
};

UIHost.prototype._bindManualEntryPoints = function() {
  // "?" button, appended to the top-right button cluster so it never has to
  // be hand-maintained in index.html alongside the other hud-btns.
  const topButtons = document.getElementById('top-buttons');
  if (topButtons && !document.getElementById('btn-manual')) {
    const btn = document.createElement('button');
    btn.id = 'btn-manual';
    btn.className = 'hud-btn hud-help-btn';
    btn.textContent = '?';
    btn.title = 'Operator Manual (F1)';
    btn.setAttribute('aria-label', 'Open the operator manual');
    btn.addEventListener('click', () => this._openManual({ toggle: true, contextual: true }));
    // Sit just left of the Menu dropdown.
    const menuWrapper = document.getElementById('menu-wrapper');
    if (menuWrapper) topButtons.insertBefore(btn, menuWrapper);
    else topButtons.appendChild(btn);
  }

  // Hovered palette item — a passive read for contextual opens.
  const palette = document.getElementById('component-palette');
  if (palette && !palette.dataset.manualHoverBound) {
    palette.dataset.manualHoverBound = '1';
    palette.addEventListener('mouseover', (e) => {
      const item = e.target.closest?.('.palette-item');
      this._hoveredPaletteComponent =
        item && item.dataset.paletteKind === 'component' ? item.dataset.paletteKey : null;
    });
    palette.addEventListener('mouseleave', () => { this._hoveredPaletteComponent = null; });
  }

  // F1 (and Shift+/ "?") open the manual. Esc closing is inherited from the
  // ContextWindow esc-stack slot. One listener, retargeted at whichever host
  // bound last, so a rebuilt HUD never stacks duplicate handlers.
  _manualKeyHost = this;
  if (!_manualKeysBound) {
    _manualKeysBound = true;
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key !== 'F1' && e.key !== '?') return;
      e.preventDefault();
      _manualKeyHost?._openManual({ toggle: true, contextual: true });
    });
  }
};

// --- System Stats Panel ---

// The stats panel sits directly under the top bar. Its CSS `top` is a fallback
// for a single-row bar only: the bar WRAPS to a second and third row on a
// narrow window (see #top-bar's flex-wrap), and the panel stacks below it
// (z-index 99 vs 100), so a fixed offset slides the panel underneath the bar
// and leaves half a row of it peeking out. Measure the bar, as the blocker
// panel and the music player already do.
function positionSystemStatsPanel(panel) {
  if (!panel) return;
  const bar = document.getElementById('top-bar');
  if (!bar) return;
  panel.style.top = `${bar.offsetTop + bar.offsetHeight}px`;
}

UIHost.prototype._updateSystemStatsVisibility = function() {
  const panel = document.getElementById('system-stats-panel');
  if (!panel) return;
  if (this.activeMode === 'facility' || this.activeMode === 'infra') {
    panel.classList.remove('hidden');
    positionSystemStatsPanel(panel);
    // The bar re-wraps on resize, which changes its height without touching
    // anything this panel would otherwise hear about.
    if (!this._systemStatsResizeBound) {
      this._systemStatsResizeBound = true;
      window.addEventListener('resize', () => {
        const p = document.getElementById('system-stats-panel');
        if (p && !p.classList.contains('hidden')) positionSystemStatsPanel(p);
      });
    }
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
    ${this._detailRow('TWTs', dd.twts)}
    ${this._detailRow('Gyrotrons', dd.gyrotrons)}
    ${this._detailRow('Modulators', dd.modulators)}
    ${this._detailRow('Circulators', dd.circulators)}
    ${this._detailRow('Couplers', dd.couplers)}
    ${this._detailRow('LLRF Controllers', dd.llrfControllers)}
  </div>`;
};

UIHost.prototype._renderCryoStats = function(d, summary, detail, append = false) {
  const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
  // Bath temperature is now a live value that climbs under load, so it needs
  // to read as an alarm before the quench rather than after it. Niobium loses
  // superconductivity at 9.25 K, and cavity Q0 has already collapsed by ~35x
  // on the way from 2 K to 4.2 K.
  let tempColor = '';
  if (d.quenched) tempColor = '#f44';
  else if (d.warming || d.opTemp > 4.8) tempColor = '#fa4';
  else if (d.opTemp > 2.5) tempColor = '#fd4';
  const tempLabel = d.quenched ? 'QUENCH' : (d.warming ? 'Temp ↑' : 'Temp');

  const cryoSummary = [
    this._sstat('Cryo Cap', this._fmt(d.coolingCapacity), 'W'),
    this._ssep(),
    this._sstat('Cryo Load', this._fmt(d.heatLoad), 'W'),
    this._ssep(),
    this._sstat(tempLabel, d.opTemp > 0 ? d.opTemp.toFixed(2) : '--', 'K', tempColor),
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
    ${this._detailRow('He Recovery',
      `${Math.round((dd.heRecoveryFraction || 0) * 100)}% / ${Math.round((dd.heRecoveryCeiling || 0) * 100)}% cap`)}
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
    ${this._detailRow('Fan-Coil Coolers', dd.fanCoils)}
    ${this._detailRow('Package Chillers', dd.packageChillers)}
    ${this._detailRow('LCW Skids', dd.lcwSkids)}
    ${this._detailRow('Dual-Circuit Chillers', dd.dualCircuitChillers)}
    ${this._detailRow('Chillers', dd.chillers)}
    ${this._detailRow('Dry Cooler Banks', dd.dryCoolerBanks)}
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

// === STAFF HUD (top bar portraits, inspector, hiring dialog) ===

function _staffFatigueClass(fatigue) {
  if (fatigue > 0.8) return 'high';
  if (fatigue > 0.5) return 'mid';
  return '';
}

UIHost.prototype._renderStaffBar = function() {
  const bar = document.getElementById('staff-bar');
  if (!bar) return;
  const members = (this.game && this.game.state && this.game.state.staffMembers) || [];
  // Clear
  bar.innerHTML = '';
  if (members.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  for (const m of members) {
    const mood = m.mood || 'content';
    const fatigue = (m.needs && typeof m.needs.fatigue === 'number') ? m.needs.fatigue : 0;
    const pct = Math.max(0, Math.min(1, fatigue)) * 100;
    const roleColor = ROLE_COLORS[m.role] || '#4466aa';
    const el = document.createElement('div');
    el.className = 'staff-portrait ' + staffMoodClass(mood);
    el.title = `${m.name} (${m.role}) — mood: ${mood}, fatigue: ${Math.round(pct)}%, status: ${m.status || 'idle'}`;
    el.dataset.staffId = m.id;
    el.style.background = roleColor;
    // initials
    const initials = document.createElement('span');
    initials.className = 'staff-portrait-initials';
    initials.textContent = staffInitials(m.name);
    el.appendChild(initials);
    // role dot
    const dot = document.createElement('span');
    dot.className = 'staff-role-dot';
    dot.style.background = roleColor;
    dot.style.borderColor = 'rgba(0,0,0,0.5)';
    // fatigue track
    const track = document.createElement('div');
    track.className = 'staff-fatigue-track';
    const fill = document.createElement('div');
    fill.className = 'staff-fatigue-fill ' + _staffFatigueClass(fatigue);
    fill.style.width = pct + '%';
    track.appendChild(fill);
    el.appendChild(track);
    el.addEventListener('click', () => {
      this._openStaffInspector(m.id);
    });
    bar.appendChild(el);
  }
};

UIHost.prototype._openStaffInspector = function(staffId) {
  openStaffInspector(this.game, staffId);
};

UIHost.prototype._openHiringDialog = function() {
  openHiringDialog(this.game);
};

UIHost.prototype._refreshStaffWindows = function() {
  // Try to refresh any open staff inspector windows via ContextWindow registry
  const members = (this.game && this.game.state && this.game.state.staffMembers) || [];
  for (const m of members) {
    const win = ContextWindow.getWindow('staff-' + m.id);
    if (win && typeof win.refresh === 'function') {
      try { win.refresh(); } catch (_) {}
    }
  }
  const hiring = ContextWindow.getWindow('hiring-dialog');
  if (hiring && typeof hiring.refresh === 'function') {
    try { hiring.refresh(); } catch (_) {}
  }
};

