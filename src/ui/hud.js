// === HUD EXTENSION ===
// Adds HUD update, palette rendering, beam button, and system stats to UIHost.prototype.

import { isFacilityCategory } from '../renderer/Renderer.js';
import { UIHost } from './UIHost.js';
import { COMPONENTS } from '../data/components.js';
import {
  FLOORS, WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WALL_PAINTS, variantCost,
  floorRequirementLabel,
} from '../data/structure.js';
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
import { windowPreviewDataUrl } from './window-preview.js';
import { DEMOLISH_FILTERS, defaultDemolishFilters } from '../input/demolishScopes.js';
import { buildPaletteIndex, searchPalette } from './palette-search.js';
import {
  componentPaletteEntries,
  groupDecorationPaletteEntries,
  resolvePaletteCollection,
  standardPaletteKind,
} from './palette-collection.js';
import { ContextWindow } from './ContextWindow.js';
import { openWikiWindow } from './WikiWindow.js';
import { openStaffInspector } from './StaffInspector.js';
import { openHiringDialog } from './HiringDialog.js';
import { facilityStaffingReport, facilityProgressReport } from '../game/staff/staffDiagnostics.js';
import { professionDef } from '../data/professions.js';
import { fmtMoney, ROLE_COLORS, staffInitials, staffMoodClass, escapeHtml } from './format.js';
import { paletteUtilityTags, utilityStatRows } from './utility-supply.js';
import { appendRequiredPortRequirements } from './required-port-preview.js';
import { beamlineEnergyDraw, facilityEnergyDraw } from '../game/aggregates.js';
import { canAffordFunding } from '../game/affordability.js';
import { makeUtilityEndpointIndex } from '../utility/utility-endpoints.js';
import { portWorldPosition } from '../utility/ports.js';
import { ADVICE_LEVELS, ADVICE_LEVEL_STORAGE_KEY } from '../advisor/engine.js';
import { drawConnectionGuideDiagram } from './connection-guide-diagrams.js';

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
  const localFundingBtn = document.getElementById('btn-local-funding');
  if (localFundingBtn) {
    const host = globalThis.location?.hostname;
    localFundingBtn.classList.toggle('hidden', !['localhost', '127.0.0.1', '::1'].includes(host));
  }
  setEl('val-funding', Math.floor(res.funding));
  const ss = this.game.state.systemStats;
  if (ss && ss.power) {
    setEl('val-energy', `${Math.round(ss.power.totalDraw)}/${Math.round(ss.power.capacity)}`);
  } else {
    setEl('val-energy', '--');
  }
  setEl('val-reputation', Math.floor(res.reputation));
  setEl('val-data', Math.floor(res.data));
  setEl('val-spares', Math.floor(res.spares));

  // Facility overview (compact second top-bar row) — aggregated stats across
  // the facility.
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

    // Hide the entire strip if nothing is live.
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

  // Staff bar (top bar portraits)
  this._renderStaffBar();

  // The top bar has fixed command and information rows. Publish its measured
  // bottom edge for anchored warnings as well, so a future token adjustment
  // cannot leave those overlays behind.
  const topBar = document.getElementById('top-bar');
  if (topBar) {
    document.documentElement.style.setProperty(
      '--hud-topbar-bottom', `${Math.ceil(topBar.getBoundingClientRect().bottom)}px`,
    );
  }

  // Fix round 1's F3: keep any open staff/roster windows live every tick,
  // not just on 'staffChanged' — see _refreshStaffWindows' own comment.
  this._refreshStaffWindows();

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
    pauseBtn.title = s.paused ? 'Resume' : 'Pause';
  }
  document.querySelectorAll('#sim-controls .speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.speed, 10) === (s.speed || 1));
  });
};

export function updateBeamSummary(ui) {
  const el = document.getElementById('beam-summary');
  if (!el) return;
  const entries = ui.game.registry.getAll();
  const running = entries.filter(e => e.status === 'running').length;
  const total = entries.length;
  const blockers = ui.game.state.infraBlockers || [];
  const canRun = ui.game.state.infraCanRun !== false;
  if (!canRun && blockers.length > 0) {
    const hardCount = blockers.filter(b => b.severity === 'hard').length;
    el.textContent = `⚠ ${hardCount} FAULT${hardCount === 1 ? '' : 'S'}`;
    el.className = 'beam-summary fault';
    const messages = [...new Set(blockers.map(b => b.message || b.code))];
    el.title = `Beam tripped — click for details\n${messages.join('\n')}`;
    el.onclick = () => ui._showInfraBlockerPanel();
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
}

UIHost.prototype._updateBeamSummary = function() {
  updateBeamSummary(this);
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
  const progress = facilityProgressReport(this.game);
  const staffing = facilityStaffingReport(this.game);
  const preferProgress = progress.stalled && !(progress.generic && staffing.idleCount > 0);
  const staffingNotice = preferProgress
    ? { kind: 'stall', text: `Facility stalled: ${progress.reason}` }
    : (staffing.idleCount > 0
      ? { kind: 'idle', text: `${staffing.worst.count} staff idle: ${staffing.worst.reason}` }
      : null);

  // Signature guard: this runs every tick, and the DOM rebuild below walks
  // every utility endpoint (state.placeables plus every pipe placement) to
  // resolve offender positions. A steady fault costs one string join.
  const sig = blockers
    .map(b => `${b.code}@${b.location?.placeableId || ''}:${b.location?.portName || ''}`)
    .join('|') + `|staff:${staffingNotice?.kind || '0'}:${staffingNotice?.text || ''}`;
  // Reposition regardless: the facility overview above grows and shrinks with
  // what is live, independently of the blocker set — as does the top bar,
  // which wraps to extra rows on a narrow window.
  if (blockers.length > 0 || staffingNotice) positionBlockerPanel(panel);
  if (sig === this._infraBlockerSig) return;
  this._infraBlockerSig = sig;

  panel.textContent = '';
  if (blockers.length === 0 && !staffingNotice) {
    panel.style.display = 'none';
    // Clearing the faults clears the dismissal too, so an identical fault set
    // coming back later is treated as news rather than as still-dismissed.
    this._infraBlockerDismissedSig = null;
    return;
  }
  // A dismissal only silences the exact fault set it was aimed at; the
  // signature changing means something new went wrong, so speak up again.
  panel.style.display = this._infraBlockerDismissedSig === sig ? 'none' : '';
  const hasInfraFaults = blockers.length > 0;
  panel.style.background = hasInfraFaults ? 'rgba(30,8,8,0.94)' : 'rgba(40,30,8,0.94)';
  panel.style.borderColor = hasInfraFaults ? 'rgba(255,90,90,0.45)' : 'rgba(255,190,90,0.45)';
  panel.style.color = hasInfraFaults ? '#ffa08c' : '#ffd28c';

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
  title.textContent = hasInfraFaults ? 'INFRASTRUCTURE ISSUES' : 'FACILITY NOTIFICATIONS';
  title.style.cssText = `color:${hasInfraFaults ? '#ff5544' : '#e0a030'};`;
  headText.appendChild(title);
  const unwired = blockers.filter(b => b.fromUnconnectedCheck).length;
  const sub = document.createElement('div');
  // The unwired count is called out separately because it is the one class
  // of blocker the player fixes by drawing a line, and on-pipe placements
  // produce it a dozen at a time.
  if (hasInfraFaults) {
    sub.textContent = `${blockers.length} BLOCKER${blockers.length > 1 ? 'S' : ''}`
      + (unwired > 0 ? ` · ${unwired} UNWIRED SINK${unwired > 1 ? 'S' : ''}` : '');
    headText.appendChild(sub);
  }
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

  if (staffingNotice) {
    const row = document.createElement('div');
    const isIdle = staffingNotice.kind === 'idle';
    row.textContent = `${isIdle ? '⚠' : '⏸'} ${staffingNotice.text}`;
    row.style.cssText = [
      'padding:4px', `margin-top:${list.length ? '5px' : '1px'}`,
      'border-radius:2px',
      `background:${isIdle ? 'rgba(90,65,12,0.55)' : 'rgba(70,20,20,0.55)'}`,
      `color:${isIdle ? '#ffd28c' : '#ffb08c'}`,
      `cursor:${isIdle ? 'pointer' : 'default'}`,
    ].join(';');
    row.title = isIdle
      ? `${staffing.idleCount} staff idle facility-wide — click to see who`
      : 'Nothing has completed in a while.';
    if (isIdle) row.addEventListener('click', () => this._openStaffingBannerGroup());
    panel.appendChild(row);
  }
};

// Undo a dismissal and force a rebuild — the top-bar fault chip's click target.
UIHost.prototype._showInfraBlockerPanel = function() {
  this._infraBlockerDismissedSig = null;
  this._infraBlockerSig = null;
  this._renderInfraBlockerList();
};

// --- Facility staffing notification (Task 8, staff-professions-3 jobs-and-gates) -
//
// The idle-legibility layer, two signals sharing one banner slot:
//   - staffDiagnostics.facilityStaffingReport groups every staffer currently
//     without a job by (corrected) idleReason text and ranks the groups
//     beam-blocked > repairs-stalled > everything else — "N staff idle:
//     <reason>", naming the highest-impact group only (see the report's own
//     doc comment on `worst`), clickable to open a roster of exactly those
//     staff.
//   - staffDiagnostics.facilityProgressReport (fix round 1's F5) covers what
//     the first signal can't see by construction: a facility where everyone
//     is BUSY and nothing is progressing (an idle-only report has nothing
//     to say when nobody is idle). Shown only when nobody IS idle — an idle
//     roster is already the more specific, more actionable fact.
// This signal exists independently of infrastructure blockers — a facility
// can be fully wired while staff sit idle — but it now appears as a clickable
// row in the left notification stack, alongside infrastructure issues.
const STAFFING_ROSTER_WINDOW_ID = 'staffing-roster';

// Rebuilds only when the underlying signal actually changed (signature =
// which report is showing, plus its own identifying text/counts) — this
// runs every frame via _updateHUD, and a steady idle roster (or a steady
// stall) must not thrash the DOM.
//
// Fix round 2's F2 (BLOCKING): facilityProgressReport used to be asked ONLY
// when `staffing.idleCount === 0` — so a facility earning nothing (an
// operator seated, beam never started — facilityProgressReport.stalled
// true) lost its own headline the instant ONE ordinary admin happened to be
// idle too (a near-default state for an early facility), replaced by a
// lower-stakes "1 staff idle: no admin work available". `progress` is now
// computed unconditionally, every call, and a real stall ALWAYS outranks
// the idle-staff banner when both are true — a hard stall is a bigger
// problem than one admin with nothing to do, and must never be hidden by
// it.
UIHost.prototype._renderStaffingBanner = function() {
  // _updateBeamSummary() renders the shared stack first. Keep this hook for
  // callers that refresh staffing independently of the regular HUD tick.
  this._renderInfraBlockerList();
};

// Opens a roster of exactly the staff behind the banner's CURRENT headline
// reason — recomputed fresh at click time (fix round 1's F8), not read off
// a value cached at the last render: the render tick that drew the banner
// and the click that follows it are never the same instant, and a stale
// cached member list opens whoever used to share that reason, not whoever
// does now (one technician goes idle, another gets reassigned — a real
// roster, not a snapshot).
UIHost.prototype._openStaffingBannerGroup = function() {
  const report = facilityStaffingReport(this.game);
  if (!report.worst) return;
  this._openStaffingRoster(report.worst.reason);
};

// One window, not N (fix round 1's F6 — ContextWindow has no cascade, so N
// inspectors opened at once land on identical pixels, which is exactly the
// "noise instead of clarity" this layer exists to avoid). Lists every
// staffer currently sharing `reason`, each row opening that ONE person's
// own StaffInspector on click. Re-resolves its member list against the
// LIVE report on every refresh — reusing the roster window across
// different reasons rather than opening a new one each time — so it never
// goes stale the way a captured member array would (same fix as F8 above,
// applied to the window's own lifetime instead of just its opening).
UIHost.prototype._openStaffingRoster = function(reason) {
  let ctx = ContextWindow.getWindow(STAFFING_ROSTER_WINDOW_ID);
  if (!ctx) {
    ctx = new ContextWindow({
      id: STAFFING_ROSTER_WINDOW_ID, title: 'Idle Staff', icon: '⚠', accentColor: '#e0a030',
    });
    ctx.setActions([{ label: 'Close', style: '', onClick: () => ctx.close() }]);
  }
  ctx._staffingRosterReason = reason;

  const render = () => {
    const body = ctx._body;
    if (!body) return;
    const report = facilityStaffingReport(this.game);
    const group = report.byReason.find(g => g.reason === ctx._staffingRosterReason);
    ctx.setTitle(group ? `Idle Staff — ${group.count}` : 'Idle Staff');
    if (!group) {
      body.innerHTML = '<div style="padding:10px;font-size:9px;color:#888;">Resolved — nobody idle for this reason anymore.</div>';
      return;
    }
    let html = `<div style="font-size:9px;color:#ccc;padding:2px 2px 8px;line-height:1.4;">${escapeHtml(group.reason)}</div>`;
    html += '<div style="display:flex;flex-direction:column;">';
    for (const m of group.members) {
      const roleColor = ROLE_COLORS[m.profession] || '#4466aa';
      html += `<div class="staffing-roster-row" data-staff-id="${escapeHtml(m.id)}" style="cursor:pointer;padding:5px 6px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:9px;display:flex;justify-content:space-between;">`
        + `<span>${escapeHtml(m.name || m.id)}</span>`
        + `<span style="color:${roleColor};">${escapeHtml(professionDef(m.profession)?.name || m.profession)}</span>`
        + `</div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('[data-staff-id]').forEach(row => {
      row.addEventListener('click', () => this._openStaffInspector(row.dataset.staffId));
    });
  };
  ctx.refresh = render;
  ctx.update = render;
  render();
  ctx.focus();
};

// --- Palette rendering ---

UIHost.prototype._generateCategoryTabs = function({ freshMode = false } = {}) {
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
      const wasActive = btn.classList.contains('active');
      tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.updatePalette(key, {
        freshTab: this.activeMode === 'infra' && !wasActive,
      });
      if (this._onTabSelect) this._onTabSelect(key);
    });
    tabsContainer.appendChild(btn);
  });

  // Render palette for first category in mode
  if (catKeys.length > 0) {
    this.updatePalette(catKeys[0], {
      freshTab: freshMode && this.activeMode === 'infra',
    });
    if (isFacility && this._onTabSelect) this._onTabSelect(catKeys[0]);
  }
};

export const CONNECTION_GUIDES = {
  power: {
    title: 'POWER PATH',
    description: 'HV Supply → HV Feeder → Distribution Panel. Run a separate Power Cable from the panel to every equipment load.',
    accent: '#ffd36a',
    diagram: 'power',
    flow: [
      { name: 'HV SUPPLY', detail: 'capacity source' },
      { name: 'DISTRIBUTION PANEL', detail: 'branch outlets' },
      { name: 'EQUIPMENT LOADS', detail: 'one cable each' },
    ],
    links: ['HV FEEDER', 'POWER CABLE'],
  },
  vacuum: {
    title: 'VACUUM PATH',
    description: 'Connect roughing and high-vacuum pumps to the beam volume with Vacuum Pipe. Gauges are taps on that same line.',
    accent: '#8fe5ff',
    diagram: 'vacuum',
    flow: [
      { name: 'ROUGH PUMP', detail: 'pump-down' },
      { name: 'TURBO / UHV', detail: 'high vacuum' },
      { name: 'BEAM VOLUME', detail: 'vacuum sink' },
      { name: 'GAUGE', detail: 'monitors pressure' },
    ],
    links: ['BACKING STAGE', 'VACUUM PIPE', 'MOUNTS ON LINE'],
  },
  rfPower: {
    title: 'RF PATH',
    description: 'Feed the RF source from an HV Supply, then connect it to a band-compatible cavity with RF Waveguide. One network carries one frequency.',
    accent: '#ff9b72',
    diagram: 'rfPower',
    flow: [
      { name: 'HV SUPPLY', detail: 'transformer' },
      { name: 'RF SOURCE', detail: 'matching band' },
      { name: 'RF CAVITY', detail: 'one frequency' },
    ],
    links: ['HV FEEDER', 'RF WAVEGUIDE'],
  },
  experimentalSystems: {
    title: 'LASER FACILITY SERVICES',
    description: 'Laser systems are major facility loads. Feed them from a distribution panel, a complete Cooling Water loop, and a synchronized Data Fiber control source.',
    accent: '#e99ac4',
    diagram: 'experimentalSystems',
    flow: [
      { name: 'POWER PANEL', detail: 'branch capacity' },
      { name: 'LASER SYSTEM', detail: 'high-energy load' },
      { name: 'COOLING + TIMING', detail: 'water and data' },
    ],
    links: ['POWER CABLE', 'COOLING + DATA'],
  },
  cooling: {
    title: 'COOLING LOOP',
    description: 'Put storage, chiller, equipment, and heat rejection on one Cooling Water loop. Cold supply flows out; warm water returns through the plant.',
    accent: '#76d7c9',
    diagram: 'cooling',
    flow: [
      { name: 'STORAGE', detail: 'water inventory' },
      { name: 'CHILLER', detail: 'process capacity' },
      { name: 'HEAT LOAD', detail: 'equipment' },
      { name: 'HEAT REJECTOR', detail: 'rejects heat' },
    ],
    links: ['SAME LOOP', 'SUPPLY', 'RETURN'],
  },
  dataControls: {
    title: 'CONTROL PATH',
    description: 'Run Data Fiber from a powered control rack or switch to each equipment data port. Keep total demand within the available bandwidth.',
    accent: '#9be27c',
    diagram: 'dataControls',
    flow: [
      { name: 'RACK / SWITCH', detail: 'bandwidth source' },
      { name: 'EQUIPMENT', detail: 'data sink' },
    ],
    links: ['DATA FIBER'],
  },
  ops: {
    title: 'SAFE BEAM DISPOSAL',
    description: 'Terminate the full beam inside shielding. Cool the dump and provide remote handling at the same loss point.',
    accent: '#f3a4d5',
    diagram: 'ops',
    flow: [
      { name: 'BEAMLINE', detail: 'beam delivery' },
      { name: 'COOLED DUMP', detail: 'Cooling Water' },
      { name: 'SHIELDING', detail: 'around loss point' },
      { name: 'REMOTE HANDLING', detail: 'service targets' },
    ],
    links: ['FULL BEAM', 'SURROUNDS', 'SERVICES'],
  },
};

UIHost.prototype._renderConnectionGuide = function(category) {
  const el = document.getElementById('connection-guide');
  if (!el) return;
  const guide = this.activeMode === 'infra'
    && this._connectionGuideVisible === true
    && this._connectionGuideCategory === category
    ? CONNECTION_GUIDES[category]
    : null;
  if (!guide) {
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.classList.remove('hidden');
  el.replaceChildren();
  el.dataset.guide = category;
  el.style.setProperty('--guide-accent', guide.accent);
  const header = document.createElement('div');
  header.className = 'connection-guide-header';
  header.innerHTML = `<span class="connection-guide-kicker">CONNECTION GUIDE</span><span class="connection-guide-title">${guide.title}</span>`;
  el.appendChild(header);
  const body = document.createElement('div');
  body.className = 'connection-guide-body';
  const description = document.createElement('div');
  description.className = 'connection-guide-desc';
  description.textContent = guide.description;
  body.appendChild(description);
  const figure = document.createElement('figure');
  figure.className = 'connection-guide-figure blt-diagram';
  const canvas = document.createElement('canvas');
  canvas.className = 'connection-guide-art';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    `${guide.title}: ${guide.flow.map((item, index) => (
      index < guide.links.length ? `${item.name}, via ${guide.links[index]}` : item.name
    )).join(', then ')}`,
  );
  figure.appendChild(canvas);
  drawConnectionGuideDiagram(canvas, guide.diagram, guide.accent);
  body.appendChild(figure);
  el.appendChild(body);
};

// A guide is revealed only by a fresh Infra tab visit. Every other interaction
// is one-way for that visit: map click, Escape, or arming any palette tool
// dismisses it, and disarming the tool must not bring it back.
UIHost.prototype._showConnectionGuideForTab = function(category) {
  this._connectionGuideCategory = category;
  this._connectionGuideVisible = this.activeMode === 'infra'
    && Boolean(CONNECTION_GUIDES[category]);
  this._renderConnectionGuide(category);
};

UIHost.prototype._dismissConnectionGuide = function() {
  this._connectionGuideVisible = false;
  if (this._connectionGuideCategory) {
    this._renderConnectionGuide(this._connectionGuideCategory);
  }
};

UIHost.prototype._setConnectionGuidePlacementActive = function(active) {
  if (active) this._dismissConnectionGuide();
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

  // Build-menu search results override the normal category-driven render
  // while the search box holds a live query. Routed through here (instead
  // of writing to #component-palette independently from the search input
  // handler) so _renderPalette's hotkey-badge pass still runs afterward.
  if (this._paletteSearchResults) {
    this._renderPaletteSearchResults(palette, this._paletteSearchResults);
    return;
  }

  const paletteExpandToggle = document.getElementById('palette-expand-toggle');
  if (paletteExpandToggle && !paletteExpandToggle.dataset.bound) {
    paletteExpandToggle.dataset.bound = '1';
    paletteExpandToggle.addEventListener('click', () => {
      const expanded = !document.getElementById('bottom-hud')?.classList.contains('palette-expanded');
      this._setPaletteExpanded(expanded);
    });
  }

  const compCategory = tabCategory;

  let paletteIdx = 0;
  const appendUtilityLineItem = (container, utilityType, showHint = true) => {
    const descriptor = UTILITY_TYPES[utilityType];
    if (!descriptor) return;
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
    // Keep even black cables visible against the palette chrome.
    swatch.style.cssText = `width:36px;height:6px;background:${hex};border-radius:3px;`
      + `margin:9px auto;border:1px solid rgba(255,255,255,0.4);box-sizing:border-box;`
      + `box-shadow:0 0 6px ${hex};`;
    previewEl.appendChild(swatch);
    item.appendChild(previewEl);

    const nameEl = document.createElement('div');
    nameEl.className = 'palette-name';
    nameEl.textContent = descriptor.displayName || utilityType;
    item.appendChild(nameEl);
    if (showHint) {
      const descEl = document.createElement('div');
      descEl.className = 'palette-cost';
      descEl.textContent = '(drag port→port)';
      item.appendChild(descEl);
    }

    item.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(idx);
      document.querySelectorAll('.palette-item.util-line-active')
        .forEach(el => el.classList.remove('util-line-active'));
      item.classList.add('util-line-active');
      this._selectPaletteTool('utility', utilityType);
    });
    item.addEventListener('mouseenter', () => this._showUtilityLinePreview(descriptor));
    item.addEventListener('mouseleave', () => this._hidePalettePreview());
    container.appendChild(item);
  };

  // Infrastructure tab uses FLOORS items instead of COMPONENTS
  if (compCategory === 'infrastructure') {
    for (const [key, infra] of Object.entries(FLOORS)) {
      if (infra.isRoofPlacement) continue;
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
      const subItems = wallKeys.filter(k => WALL_TYPES[k]?.subsection === subKey && !WALL_TYPES[k]?.deprecated);
      // Face-finish sections draw from WALL_PAINTS, not WALL_TYPES, so an
      // empty subItems list is expected for them rather than a reason to skip.
      const isFinishSection = ['exterior', 'shielding', 'paint', 'wallpaper'].includes(subKey);
      if (subItems.length === 0 && !isFinishSection) continue;

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

      if (isFinishSection) {
        const finishes = Object.values(WALL_PAINTS)
          .filter(p => (p.subsection ?? (p.texture ? 'wallpaper' : 'paint')) === subKey);
        for (const paint of finishes) {
          const item = document.createElement('div');
          item.className = 'palette-item';
          const finishCost = paint.cost ?? 0;
          if (!canAffordFunding(this.game, finishCost)) item.classList.add('unaffordable');
          item.dataset.paletteIndex = paletteIdx;
          item.dataset.paletteKey = paint.id;
          item.dataset.paletteKind = 'wallPaint';
          const idx = paletteIdx++;
          const previewEl = document.createElement('div');
          previewEl.className = 'palette-preview';
          // Wallpaper shows the actual pattern rather than a flat chip — a
          // solid swatch tells you nothing about a pattern. image-rendering
          // keeps the 64x64 source crisp instead of smearing it.
          previewEl.innerHTML = paint.texture
            ? `<div style="width:48px;height:32px;border-radius:3px;background-image:url('assets/textures/materials/${paint.texture}.png');background-size:32px 32px;background-repeat:repeat;image-rendering:pixelated"></div>`
            : `<div style="width:48px;height:32px;background:#${paint.color.toString(16).padStart(6, '0')};border-radius:3px"></div>`;
          item.appendChild(previewEl);
          const nameEl = document.createElement('div');
          nameEl.className = 'palette-name';
          nameEl.textContent = paint.name;
          item.appendChild(nameEl);
          const hintEl = document.createElement('div');
          hintEl.className = 'palette-cost';
          hintEl.textContent = paint.thickness
            ? `${paint.thickness.toFixed(2)}m layer · ${fmtMoney(paint.cost)}/seg`
            : (subKey === 'wallpaper' ? 'wallpaper' : 'face paint');
          item.appendChild(hintEl);
          this._attachSimpleHoverPreview(item, paint.name,
            paint.thickness
              ? 'Click a floor tile to apply this material to its adjacent wall faces. Shift-click applies it around the interior boundary. Right-click strips the layer.'
              : (paint.texture
                ? 'Click a floor tile to paper its adjacent wall faces. Shift-click to paper all inward-facing walls bounding that interior. Right-click strips the finish.'
                : 'Click a floor tile to paint its adjacent wall faces. Shift-click to paint all inward-facing walls bounding that interior.'),
            [
              ...(finishCost ? [['Cost', `${fmtMoney(finishCost)}/segment`]] : []),
              ['Placement', 'Tile walls'], ['Shift', 'Interior boundary'],
            ]);
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._selectPaletteTool('wallPaint', paint.id);
          });
          itemsContainer.appendChild(item);
        }
        if (subItems.length === 0) {
          section.appendChild(itemsContainer);
          palette.appendChild(section);
          renderedSections++;
          continue;
        }
      }

      for (const key of subItems) {
        const infra = WALL_TYPES[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'wall';
        const idx = paletteIdx++;

        // Wall preview (variant-aware via remembered selection). The COST is
        // variant-aware for the same reason the swatch is: placeWall charges
        // variantCosts[variant], so a base-cost label would advertise a price
        // the player is not the one being charged (structuralWall Reinforced
        // is 35, not 25). The palette renders before any click, so the
        // variant shown is the one the flyout has remembered for this type —
        // exactly the one a click would arm the tool with.
        const rememberedVi = recallVariant(key);
        const segCost = variantCost(infra, rememberedVi);

        const affordable = this.game.state.resources.funding >= segCost;
        if (!affordable) item.classList.add('unaffordable');

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
          const previewColor = resolveVariantPreview(infra, rememberedVi);
          const c = Array.isArray(previewColor)
            ? previewColor[0]
            : (previewColor ?? infra.topColor ?? infra.color ?? 0x888888);
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
        costEl.textContent = `${fmtMoney(segCost)}/seg`;
        item.appendChild(costEl);

        // Held by reference: _attachSimpleHoverPreview reads the rows at
        // mouseenter, so the variant flyout below can retune the cost row in
        // place instead of waiting for a palette re-render.
        const hoverStats = [
          ['Cost', `${fmtMoney(segCost)}/segment`],
          ['Placement', 'Drag along tile edges'],
        ];
        this._attachSimpleHoverPreview(item, infra.name, infra.desc, hoverStats);
        // Repaint the cost label (and affordability) for a newly picked
        // variant. The palette is not re-rendered on a flyout pick, so
        // without this the tile would advertise the previous variant's price.
        const retuneCost = (vi) => {
          const c = variantCost(infra, vi);
          costEl.textContent = `${fmtMoney(c)}/seg`;
          hoverStats[0][1] = `${fmtMoney(c)}/segment`;
          item.classList.toggle('unaffordable', !canAffordFunding(this.game, c));
        };

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
                retuneCost(variantIdx);
                const previewElNow = item.querySelector('.palette-preview');
                const previewImg = previewElNow?.querySelector('img');
                if (previewImg) {
                  const newPath = this.sprites.getTilePath(key, variantIdx);
                  if (newPath) previewImg.src = newPath;
                  previewElNow.querySelectorAll('div').forEach(d => d.remove());
                  applyPreviewTint(previewElNow, infra, variantIdx);
                } else if (previewElNow?.firstElementChild) {
                  const previewColor = resolveVariantPreview(infra, variantIdx);
                  const c = Array.isArray(previewColor)
                    ? previewColor[0]
                    : (previewColor ?? infra.topColor ?? infra.color ?? 0x888888);
                  previewElNow.firstElementChild.style.background = `#${c.toString(16).padStart(6, '0')}`;
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
          const previewColor = resolveVariantPreview(door, rememberedVi);
          const c = Array.isArray(previewColor)
            ? previewColor[0]
            : (previewColor ?? door.topColor ?? door.color ?? 0x888888);
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
                  previewElNow.querySelectorAll('div').forEach(d => d.remove());
                  applyPreviewTint(previewElNow, door, variantIdx);
                } else if (previewElNow?.firstElementChild) {
                  const previewColor = resolveVariantPreview(door, variantIdx);
                  const c = Array.isArray(previewColor)
                    ? previewColor[0]
                    : (previewColor ?? door.topColor ?? door.color ?? 0x888888);
                  previewElNow.firstElementChild.style.background = `#${c.toString(16).padStart(6, '0')}`;
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

  // Structure mode — Windows tab. Modeled on the walls branch's variant
  // flyout since five of six window types carry glass-tint variants;
  // hutchViewport has no `variants` array at all, so the `win.variants &&
  // win.variants.length > 1` guard below falls through to the plain-click
  // handler for it, same as any non-variant wall or door.
  if (compCategory === 'windows') {
    const windowKeys = Object.keys(WINDOW_TYPES);
    const catDef = MODES.structure.categories.windows;
    const subsections = catDef.subsections;
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    for (const subKey of subKeys) {
      const subDef = subsections[subKey];
      const subItems = windowKeys.filter(k => WINDOW_TYPES[k]?.subsection === subKey);
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
        const win = WINDOW_TYPES[key];
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        item.dataset.paletteKey = key;
        item.dataset.paletteKind = 'window';
        const idx = paletteIdx++;

        // Window preview: an actual framed-glass illustration rather than a
        // generic colour swatch. It follows the selected tint variant.
        const rememberedVi = recallVariant(key);
        // Same variant drives the COST: placeWindow charges
        // variantCosts[variant] (a Mirrored Picture Window is 70, not 55), so
        // the label has to follow or the palette advertises a price nobody
        // pays. Pre-click, the remembered variant is the one a click arms.
        const segCost = variantCost(win, rememberedVi);

        const affordable = this.game.state.resources.funding >= segCost;
        if (!affordable) item.classList.add('unaffordable');

        const previewEl = document.createElement('div');
        previewEl.className = 'palette-preview';
        const img = document.createElement('img');
        img.src = windowPreviewDataUrl(key, rememberedVi);
        img.alt = win.name;
        img.width = 96;
        img.height = 64;
        img.style.objectFit = 'contain';
        previewEl.appendChild(img);
        item.appendChild(previewEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = win.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `${fmtMoney(segCost)}/seg`;
        item.appendChild(costEl);

        // Rows held by reference so the variant flyout can retune the cost
        // row in place — see the wall palette above.
        const hoverStats = [
          ['Cost', `${fmtMoney(segCost)}/segment`],
          ['Placement', 'Place on a wall edge'],
        ];
        this._attachSimpleHoverPreview(item, win.name, win.desc, hoverStats);
        const retuneCost = (vi) => {
          const c = variantCost(win, vi);
          costEl.textContent = `${fmtMoney(c)}/seg`;
          hoverStats[0][1] = `${fmtMoney(c)}/segment`;
          item.classList.toggle('unaffordable', !canAffordFunding(this.game, c));
        };

        if (win.variants && win.variants.length > 1) {
          item.addEventListener('click', () => {
            if (this._onPaletteClick) this._onPaletteClick(idx);
            this._removeParamFlyout();
            const flyout = document.createElement('div');
            flyout.className = 'param-flyout';

            const defaultVi = recallVariant(key);
            // Pre-select on open so clicks elsewhere still use the remembered variant.
            this._selectPaletteTool('window', key, defaultVi);

            for (let vi = 0; vi < win.variants.length; vi++) {
              const vBtn = document.createElement('div');
              vBtn.className = 'param-flyout-btn';
              const sw = makeVariantSwatch(resolveVariantPreview(win, vi));
              if (sw) vBtn.appendChild(sw);
              vBtn.appendChild(document.createTextNode(win.variants[vi]));
              const variantIdx = vi;
              if (vi === defaultVi) vBtn.classList.add('active');
              vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rememberVariant(key, variantIdx);
                this._selectPaletteTool('window', key, variantIdx);
                retuneCost(variantIdx);
                const previewElNow = item.querySelector('.palette-preview');
                const previewImg = previewElNow?.querySelector('img');
                if (previewImg) previewImg.src = windowPreviewDataUrl(key, variantIdx);
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
            this._selectPaletteTool('window', key);
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
    const flooringKeys = Object.keys(FLOORS).filter(key => FLOORS[key].structureFloor);
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

        const rememberedVi = recallVariant(key);
        const selectedCost = variantCost(infra, rememberedVi);
        const affordable = this.game.state.resources.funding >= selectedCost;
        if (!affordable) item.classList.add('unaffordable');

        // Tile preview — use the remembered variant so the thumbnail
        // reflects the user's last choice, not always variant 0.
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
        costEl.textContent = `${_costLabel(selectedCost)}/tile`;
        item.appendChild(costEl);

        const floorStats = [
          ['Cost', `${_costLabel(selectedCost)}/tile`],
          ['Placement', infra.isRoofPlacement ? 'Click an enclosed room' : infra.isLinePlacement ? 'Drag a line' : 'Drag an area'],
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
              const optionCost = variantCost(infra, vi);
              vBtn.appendChild(document.createTextNode(`${infra.variants[vi]} — ${_costLabel(optionCost)}/tile`));
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
                costEl.textContent = `${_costLabel(optionCost)}/tile`;
                item.classList.toggle('unaffordable', this.game.state.resources.funding < optionCost);
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
      const subItems = Object.entries(WALL_TYPES).filter(([, w]) => w.subsection === subKey && !w.deprecated);
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

  // Decoration tabs: show decoration items for this category. Resolved from
  // the currently active mode (not hardcoded to grounds) — Structure's
  // "Lights" tab is a decoration tab too, just living under a different mode.
  const decCatDef = MODES[this.activeMode]?.categories?.[compCategory];
  if (decCatDef?.isDecorationTab) {
    const collection = resolvePaletteCollection(compCategory, decCatDef, {
      decorations: DECORATIONS,
      components: COMPONENTS,
    });
    const decItems = collection.decorations
      .filter(([, dec]) => this.game.isComponentUnlocked(dec));
    if (decItems.length === 0 && collection.components.length === 0
        && collection.utilityLineTools.length === 0) return;

    const appendDecorationItem = (key, dec, target) => {
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
      if (dec.mount === 'wall') decStats.push(['Placement', 'Snaps to either wall face']);
      else if (dec.mount === 'overhead') decStats.push(['Placement', 'Floats overhead']);
      else if (dec.mount === 'surface') decStats.push(['Placement', 'Stacks on desks and worktops']);
      else if (dec.placement === 'outdoor') decStats.push(['Placement', 'Outdoor only']);
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

      target.appendChild(item);
    };

    const subsections = decCatDef.subsections;
    if (subsections && Object.keys(subsections).length > 0) {
      const sections = groupDecorationPaletteEntries(decItems, subsections);
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const grouped = sections[sectionIndex];
        if (sectionIndex > 0) {
          const divider = document.createElement('div');
          divider.className = 'palette-subsection-divider';
          palette.appendChild(divider);
        }
        const section = document.createElement('div');
        section.className = 'palette-subsection';
        const label = document.createElement('div');
        label.className = 'palette-subsection-label';
        label.textContent = grouped.name;
        section.appendChild(label);
        const items = document.createElement('div');
        items.className = 'palette-subsection-items';
        for (const [key, dec] of grouped.entries) appendDecorationItem(key, dec, items);
        section.appendChild(items);
        palette.appendChild(section);
      }
    } else {
      for (const [key, dec] of decItems) appendDecorationItem(key, dec, palette);
    }

    for (const utilityType of collection.utilityLineTools) {
      appendUtilityLineItem(palette, utilityType);
    }

    for (const [key, comp] of collection.components) {
      const item = this._createPaletteItem(key, comp, paletteIdx);
      if (!item) continue;
      paletteIdx++;
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
    zoneDesc.textContent = `Requires: ${floorRequirementLabel(zone.requiredFloor)} (drag)`;
    zoneItem.appendChild(zoneDesc);

    this._attachSimpleHoverPreview(zoneItem, zone.name, zone.desc, [
      ['Requires', floorRequirementLabel(zone.requiredFloor)],
      ['Placement', 'Drag an area'],
    ]);

    zoneItem.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(zoneIdx);
      this._selectPaletteTool('zone', zoneType);
    });
    zoneItems.appendChild(zoneItem);
    zoneSection.appendChild(zoneItems);
    palette.appendChild(zoneSection);

    const roomUtilities = Array.isArray(zoneCatDef.utilityLineTools)
      ? zoneCatDef.utilityLineTools : [];
    if (roomUtilities.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'palette-subsection-divider';
      palette.appendChild(divider);
      const utilitySection = document.createElement('div');
      utilitySection.className = 'palette-subsection';
      const utilityLabel = document.createElement('div');
      utilityLabel.className = 'palette-subsection-label';
      utilityLabel.textContent = 'Connections';
      utilitySection.appendChild(utilityLabel);
      const utilityItems = document.createElement('div');
      utilityItems.className = 'palette-subsection-items';
      for (const utilityType of roomUtilities) {
        appendUtilityLineItem(utilityItems, utilityType);
      }
      utilitySection.appendChild(utilityItems);
      palette.appendChild(utilitySection);
    }

    // Room furniture is grouped by authored furnitureGroup so a large shared
    // catalogue stays scannable. Legacy entries fall into Other Furniture.
    const groupDefs = zoneCatDef.furnitureGroups || { other: { name: 'Furniture' } };
    const groupedFurniture = new Map(Object.keys(groupDefs).map(key => [key, []]));
    for (const [key, furn] of Object.entries(ZONE_FURNISHINGS)) {
      if (!itemMatchesZone(furn, zoneType)) continue;
      const group = furn.furnitureGroup || 'other';
      if (!groupedFurniture.has(group)) groupedFurniture.set(group, []);
      groupedFurniture.get(group).push([key, furn]);
    }
    const furnGroups = [...groupedFurniture].filter(([, entries]) => entries.length > 0);
    if (furnGroups.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'palette-subsection-divider';
      palette.appendChild(divider);

      for (const [group, furnEntries] of furnGroups) {
        const furnSection = document.createElement('div');
        furnSection.className = 'palette-subsection';
        const furnLabel = document.createElement('div');
        furnLabel.className = 'palette-subsection-label';
        furnLabel.textContent = groupDefs[group]?.name || group;
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
        furnStats.push(['Bonus Zone', zone.name]);
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
    }
    return;
  }

  // One demolition cursor, modified live by category checkboxes.
  if (compCategory === 'demolish') {
    const active = this.renderer._inputHandler?.getDemolishFilters?.()
      || defaultDemolishFilters();
    const group = document.createElement('div');
    group.className = 'demolish-filter-bar';

    const intro = document.createElement('div');
    intro.className = 'demolish-filter-intro';
    intro.innerHTML = '<strong>DEMOLISH</strong><span>Drag to clear only checked categories</span>';
    group.appendChild(intro);

    for (const filter of DEMOLISH_FILTERS) {
      const label = document.createElement('label');
      label.className = 'demolish-filter';
      label.style.setProperty('--demolish-filter-color', filter.color);
      label.title = filter.desc;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = active.has(filter.key);
      checkbox.dataset.demolishFilter = filter.key;
      checkbox.addEventListener('change', () => {
        const accepted = this._setDemolishFilter(filter.key, checkbox.checked);
        checkbox.checked = accepted ?? checkbox.checked;
        label.classList.toggle('active', checkbox.checked);
      });
      label.classList.toggle('active', checkbox.checked);

      const mark = document.createElement('span');
      mark.className = 'demolish-filter-check';
      mark.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'demolish-filter-copy';
      const name = document.createElement('strong');
      name.textContent = filter.label;
      const desc = document.createElement('span');
      desc.textContent = filter.desc;
      copy.append(name, desc);

      label.append(checkbox, mark, copy);
      group.appendChild(label);
    }
    palette.appendChild(group);
    return;
  }

  // Get subsection definitions from category
  const mode = MODES[this.activeMode];
  const catDef = mode?.categories?.[compCategory];
  const subsections = catDef?.subsections;
  const linkedComponentIds = new Set(
    Object.values(subsections || {}).flatMap(sub => sub.linkedPlaceables || []),
  );

  // Collect components for this category
  const catComps = componentPaletteEntries(COMPONENTS, compCategory, linkedComponentIds);
  // Catalogues normally retain their authored order. Power explicitly carries
  // a capacity/cost ladder, though, so honour its local palette order without
  // forcing the raw registry to be physically arranged around the UI.
  catComps.sort((a, b) => (a.comp.paletteOrder ?? Number.MAX_SAFE_INTEGER)
    - (b.comp.paletteOrder ?? Number.MAX_SAFE_INTEGER));

  if (subsections && Object.keys(subsections).length > 0) {
    // Render with subsection grouping
    const subKeys = Object.keys(subsections);
    let renderedSections = 0;
    subKeys.forEach((subKey, subIdx) => {
      const subDef = subsections[subKey];
      const subComps = catComps.filter(({ comp }) => {
        const linkedHere = subDef.linkedPlaceables?.includes(comp.id);
        if (comp.category !== compCategory) return linkedHere;
        if (comp.subsection) return comp.subsection === subKey;
        return subIdx === 0; // default to first subsection
      });
      if (subKey === 'transport' && this.activeMode === 'infra'
          && !subComps.some(({ key }) => key === 'universalUtilityBus')) {
        subComps.unshift({ key: 'universalUtilityBus', comp: COMPONENTS.universalUtilityBus });
      }

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
        // The two Power transport cards are already self-explanatory and sit
        // side by side; keep them compact instead of repeating the same
        // interaction hint under both names.
        appendUtilityLineItem(itemsContainer, utilityType, compCategory !== 'power');
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

UIHost.prototype._setPaletteExpanded = function(expanded) {
  const bottomHud = document.getElementById('bottom-hud');
  const palette = document.getElementById('component-palette');
  const toggle = document.getElementById('palette-expand-toggle');
  if (!bottomHud || !palette || !toggle) return;
  document.body.classList.toggle('palette-expanded', expanded);
  bottomHud.classList.toggle('palette-expanded', expanded);
  palette.classList.toggle('palette-expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.title = expanded ? 'Hide second build row' : 'Show second build row';
  const text = toggle.querySelector('span[aria-hidden="true"]');
  if (text) text.textContent = expanded ? '⌄' : '⌃';
  const label = toggle.querySelector('.palette-expand-label');
  if (label) label.textContent = expanded ? '1 Row' : '2 Rows';
  const accessibleText = toggle.querySelector('.sr-only');
  if (accessibleText) accessibleText.textContent = toggle.title;
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
  const paletteKind = standardPaletteKind(comp, isFacility);

  // Zone-tier check for facility items
  let zoneBlocked = false;
  if (isFacility && this.game.getZoneTierForCategory) {
    const zoneTier = this.game.getZoneTierForCategory(comp.category);
    const compTier = comp.zoneTier != null ? comp.zoneTier : 1;
    zoneBlocked = zoneTier < compTier;
  }

  const item = document.createElement('div');
  item.className = 'palette-item';
  const isUniversalBus = !!comp.universalUtilityBus;
  if (isUniversalBus) item.classList.add('utility-line-tool');
  item.dataset.paletteIndex = idx;
  item.dataset.paletteKey = key;
  item.dataset.paletteKind = paletteKind;

  const affordable = this.game.canAfford(comp.cost);
  if (!affordable) item.classList.add('unaffordable');
  if (zoneBlocked) item.classList.add('zone-blocked');

  // Visually distinguish attachment-type components from grid modules, and
  // name every mount the tool actually accepts. Vacuum gauges prefer a drawn
  // utility run but deliberately retain beam-pipe mounting as a fallback.
  if (comp.placement === 'attachment') {
    item.classList.add('attachment-tool');
    if (comp.attachmentKind === 'inline') item.classList.add('tiny-attachment-tool');
    const utilityName = comp.utilityMount
      ? (UTILITY_TYPES[comp.utilityMount]?.displayName || comp.utilityMount)
      : null;
    item.title = comp.attachmentKind === 'inline'
      ? `${comp.name} — tiny inline attachment; snaps to subtile centres and edges`
      : utilityName
        ? `${comp.name} — attaches anywhere along ${utilityName} runs or to beam pipe`
        : `${comp.name} — attaches to beam pipe`;
  }

  // Sprite preview — use 3D thumbnail if available, otherwise isometric box swatch
  const previewEl = document.createElement('div');
  previewEl.className = 'palette-preview';
  const thumbUrl = isUniversalBus ? null : paletteKind === 'decoration'
    ? renderDecorationThumbnail(key, 96)
    : renderComponentThumbnail(key, 96);
  if (isUniversalBus) {
    const rack = document.createElement('div');
    rack.setAttribute('aria-hidden', 'true');
    rack.style.cssText = 'position:relative;width:44px;height:32px;margin:0 auto;'
      + 'border-left:4px solid #68747c;border-right:4px solid #9aa5ad;'
      + 'box-sizing:border-box;transform:skewY(-8deg);'
      + 'background:repeating-linear-gradient(0deg,transparent 0 3px,#89959d 3px 5px);'
      + 'filter:drop-shadow(0 2px 2px rgba(0,0,0,.55));';
    previewEl.appendChild(rack);
  } else if (thumbUrl) {
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

  // Compact signed badges make a source's output or a device's operating draw
  // comparable at a glance without obscuring the component thumbnail.
  const utilityTags = paletteUtilityTags(comp);
  if (utilityTags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'palette-utility-tags';
    for (const tag of utilityTags) {
      const tagEl = document.createElement('div');
      tagEl.className = `palette-utility-tag palette-utility-${tag.key} palette-utility-${tag.direction}`;
      tagEl.textContent = tag.text;
      tagsEl.appendChild(tagEl);
    }
    item.appendChild(tagsEl);
  }

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
  if (bands || comp.betaAcceptance) {
    const bandEl = document.createElement('div');
    bandEl.className = 'palette-rf-band';
    for (const b of bands || []) {
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
    if (comp.betaAcceptance) {
      const beta = comp.betaAcceptance;
      const regime = beta.design < 0.5 ? 'LOW-β'
        : beta.design < 0.85 ? 'MID-β' : 'HIGH-β';
      const fmt = value => value < 0.1 ? value.toFixed(3) : value.toFixed(2);
      const betaLine = document.createElement('div');
      betaLine.className = 'palette-beta-range';
      betaLine.textContent = `${regime} ${fmt(beta.min)}–${fmt(beta.max)}`;
      bandEl.appendChild(betaLine);
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
  const costs = isUniversalBus
    ? `$${this._fmt(comp.universalUtilityBus.costPerSubtile)} / 0.5m · drag to draw rack`
    : Object.entries(comp.cost).map(([r, a]) =>
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
        this._selectPaletteTool(paletteKind, key);
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
              this._selectPaletteTool(paletteKind, key);
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
        this._selectPaletteTool(paletteKind, key);
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
    for (const r of utilityStatRows(comp)) html += statRow(r.label, r.value);
    const dataSystem = comp.effects?.dataSystem;
    if (dataSystem) {
      if (dataSystem.ingest > 0) html += statRow('DAQ Ingest', `${dataSystem.ingest} data/t`);
      if (dataSystem.storage > 0) html += statRow('Raw Buffer', `${dataSystem.storage} data`);
      if (dataSystem.cpu > 0) html += statRow('CPU Processing', `${dataSystem.cpu} data/t`);
      if (dataSystem.gpu > 0) html += statRow('GPU Processing', `${dataSystem.gpu} data/t`);
    }
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
    if (comp.betaAcceptance) {
      const beta = comp.betaAcceptance;
      const fmt = value => value < 0.1 ? value.toFixed(3) : value.toFixed(2);
      html += statRow('β Acceptance',
        `${fmt(beta.min)}–${fmt(beta.max)} (design ${fmt(beta.design)})`);
    }
    statsEl.innerHTML = html;
    appendRequiredPortRequirements(statsEl, comp);
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

UIHost.prototype.updatePalette = function(category, { freshTab = false } = {}) {
  this._renderPalette(category);
  if (freshTab) {
    this._showConnectionGuideForTab(category);
  } else {
    // A category changed without a tab-visit signal (state repair/search/etc.)
    // must never inherit another tab's still-visible card.
    if (category !== this._connectionGuideCategory || this.activeMode !== 'infra') {
      this._connectionGuideVisible = false;
      this._connectionGuideCategory = category;
    }
    this._renderConnectionGuide(category);
  }
  this._updateSystemStatsContent(category);
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

    // The build-menu search index caches game.isComponentUnlocked results
    // (see _getPaletteIndex); a completed research run can flip locked
    // components to unlocked, so drop the cache and let the next search
    // rebuild it — otherwise a just-unlocked item stays unsearchable until
    // a reload.
    this.game.on((ev) => {
      if (ev !== 'researchChanged') return;
      this._paletteIndexCache = null;
    });
  }

  this._bindPaletteSearch();

  // Mode switcher
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (MODES[mode]?.disabled) return;
      const previousMode = this.activeMode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.activeMode = mode;
      this._generateCategoryTabs({ freshMode: previousMode !== mode });
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

  // Build Forward replaces the parallel Goals checklist. It reopens the
  // contextual assistant for the selected (or only) beamline.
  const buildForwardBtn = document.getElementById('btn-build-forward');
  if (buildForwardBtn) {
    buildForwardBtn.addEventListener('click', () => {
      this.game._guidedSetup?.toggle?.();
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

  // Presentation-only world layer visibility. These switches delegate to the
  // renderer's public coordinator and never mutate game or snapshot state.
  const layerControl = document.getElementById('layer-visibility-control');
  const layerToggle = document.getElementById('layer-visibility-toggle');
  const layerPanel = document.getElementById('layer-visibility-panel');
  const layerButtons = [...document.querySelectorAll('[data-world-layer]')];
  const syncLayerButton = (button, visible) => {
    const id = button.dataset.worldLayer || '';
    const label = id === 'infra'
      ? 'Infrastructure'
      : id === 'zoneLabels'
        ? 'Zone labels'
        : `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', String(visible));
    button.title = `${visible ? 'Hide' : 'Show'} ${label} layer`;
  };
  const closeLayerPanel = () => {
    layerPanel?.classList.add('hidden');
    layerToggle?.setAttribute('aria-expanded', 'false');
    if (layerToggle) layerToggle.title = 'Show world layer visibility';
  };
  if (layerToggle && layerPanel) {
    layerToggle.addEventListener('click', () => {
      const opening = layerPanel.classList.contains('hidden');
      if (opening) {
        for (const button of layerButtons) {
          syncLayerButton(button, this.renderer.isWorldLayerVisible(button.dataset.worldLayer));
        }
      }
      layerPanel.classList.toggle('hidden', !opening);
      layerToggle.setAttribute('aria-expanded', String(opening));
      layerToggle.title = `${opening ? 'Hide' : 'Show'} world layer visibility`;
    });
  }
  for (const button of layerButtons) {
    const id = button.dataset.worldLayer;
    syncLayerButton(button, this.renderer.isWorldLayerVisible(id));
    button.addEventListener('click', () => {
      const visible = this.renderer.toggleWorldLayer(id);
      if (visible !== null) syncLayerButton(button, visible);
    });
  }
  const layerReset = document.getElementById('layer-visibility-reset');
  if (layerReset) {
    layerReset.addEventListener('click', () => {
      const state = this.renderer.resetWorldLayers();
      for (const button of layerButtons) {
        syncLayerButton(button, state[button.dataset.worldLayer] !== false);
      }
    });
  }

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
  if (layerControl && this.game.viewRouter) {
    this.game.viewRouter.on((view) => {
      layerControl.classList.toggle('hidden', view !== 'game');
      if (view !== 'game') closeLayerPanel();
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

  // Staff navigation opens the hiring dialog (3 candidates).
  const hireBtn = document.getElementById('btn-hire');
  if (hireBtn) {
    hireBtn.addEventListener('click', () => {
      this._openHiringDialog();
    });
  }

  // Deliberately local-only: development playthroughs can be funded without
  // exposing a cheat control in deployed builds. save() persists the grant to
  // the active slot immediately, rather than waiting for the next autosave.
  const localFundingBtn = document.getElementById('btn-local-funding');
  if (localFundingBtn) {
    const host = globalThis.location?.hostname;
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
    localFundingBtn.classList.toggle('hidden', !isLocal);
    if (isLocal) {
      localFundingBtn.addEventListener('click', () => {
        this.game.state.resources.funding = (this.game.state.resources.funding || 0) + 250_000;
        this.game.log?.('Local development grant: +$250k.', 'good');
        this.game.save?.();
        this._updateHUD();
      });
    }
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

/** Reflect the live AdvisorEngine preference in the help flyout. The flyout
 *  is built before game.load(), so this deliberately reads the engine when
 *  the player opens it rather than caching the boot-time default. */
UIHost.prototype._syncAdvisorLevelMenu = function() {
  const level = this.game?._advisor?.level?.() || 'all';
  document.querySelectorAll('#advisor-level-menu [data-advice-level]').forEach((option) => {
    const selected = option.dataset.adviceLevel === level;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
};

UIHost.prototype._setAdvisorLevel = function(level) {
  const advisor = this.game?._advisor;
  if (!advisor?.setLevel?.(level)) return;
  this._syncAdvisorLevelMenu();
  try { localStorage.setItem(ADVICE_LEVEL_STORAGE_KEY, level); } catch {}
  // Re-evaluate immediately: choosing Off or a stricter band should dismiss
  // an ineligible bubble now, not on the next two-second advisor tick.
  this.game._runAdvisor?.();
  // Advice level is a durable preference in the advisor save section.
  this.game.save?.();
};

UIHost.prototype._bindManualEntryPoints = function() {
  // "?" button and Stubby advice flyout, appended to the top-right button
  // cluster so they never have to be hand-maintained in index.html alongside
  // the other hud-btns. Click still opens the manual; hover/focus exposes the
  // advice-level choices without making the manual harder to reach.
  const topButtons = document.getElementById('top-buttons');
  if (topButtons && !document.getElementById('btn-manual')) {
    const wrap = document.createElement('div');
    wrap.id = 'help-advice-wrapper';
    wrap.className = 'help-advice-wrapper';

    const btn = document.createElement('button');
    btn.id = 'btn-manual';
    btn.className = 'hud-btn hud-help-btn';
    btn.textContent = '?';
    btn.title = 'Operator Manual (F1)';
    btn.setAttribute('aria-label', 'Open the operator manual');
    btn.addEventListener('click', () => this._openManual({ toggle: true, contextual: true }));

    const menu = document.createElement('div');
    menu.id = 'advisor-level-menu';
    menu.className = 'advisor-level-menu';
    menu.setAttribute('role', 'radiogroup');
    menu.setAttribute('aria-label', 'Stubby advice level');
    menu.innerHTML = `
      <div class="advisor-level-title">STUBBY ADVICE</div>
      <div class="advisor-level-intro">How much advice should Stubby give?</div>
      ${Object.entries(ADVICE_LEVELS).map(([value, option]) => `
        <button type="button" class="advisor-level-option" role="radio"
                aria-checked="false" data-advice-level="${value}">
          <span class="advisor-level-check" aria-hidden="true"></span>
          <span class="advisor-level-copy">
            <span class="advisor-level-label">${option.label}</span>
            <span class="advisor-level-detail">${option.detail}</span>
          </span>
        </button>`).join('')}
      <div class="advisor-level-manual">Click ? or press F1 for the manual</div>
    `;
    menu.addEventListener('click', (event) => {
      const option = event.target.closest?.('[data-advice-level]');
      if (option) this._setAdvisorLevel(option.dataset.adviceLevel);
    });
    wrap.addEventListener('mouseenter', () => this._syncAdvisorLevelMenu());
    wrap.addEventListener('focusin', () => this._syncAdvisorLevelMenu());
    wrap.append(btn, menu);

    // Sit just left of the Menu dropdown.
    const menuWrapper = document.getElementById('menu-wrapper');
    if (menuWrapper) topButtons.insertBefore(wrap, menuWrapper);
    else topButtons.appendChild(wrap);
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
    // The palette is a horizontal strip. Treat either a conventional vertical
    // wheel or a trackpad's horizontal gesture as horizontal scroll while the
    // pointer is over it, rather than letting that gesture reach world zoom.
    palette.addEventListener('wheel', (e) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      palette.scrollLeft += delta;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
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

// The system panel sits directly under the two-row top bar. Measure rather
// than repeat the CSS token so zoom and any future density setting remain
// aligned to the rendered edge.
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
    experimentalSystems: { key: 'power', name: 'EXPERIMENTAL SYSTEMS' },
    ops:          { key: 'ops',          name: 'OPS' },
  };

  const mapped = catMap[category];
  if (!mapped) return;

  const title = document.getElementById('system-stats-title');
  if (title) {
    title.textContent = mapped.name;
    // Set color from category
    const cat = MODES[this.activeMode]?.categories[category];
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
    ${this._detailRow('Roughing Carts', dd.roughingPumpCarts)}
    ${this._detailRow('Turbo Pumps', dd.turboPumps)}
    ${this._detailRow('Turbo Carts', dd.turboPumpCarts)}
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
    ${this._detailRow('Plant Chain', dd.plantComplete ? 'Online' : 'Incomplete')}
    ${this._detailRow('LHe Inventory', `${(dd.reservoirVolumeL || 0).toFixed(0)} / ${(dd.storageCapacityL || 0).toFixed(0)}`, 'L')}
    ${this._detailRow('He Recovery',
      `${Math.round((dd.heRecoveryFraction || 0) * 100)}% / ${Math.round((dd.heRecoveryCeiling || 0) * 100)}% cap`)}
    ${this._detailRow('Recovery Stages', dd.recoveryStageCount || 0)}
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
    ${this._detailRow('Laser Systems', d.laserSystems)}
    ${this._detailRow('Standby Generators', d.standbyGenerators)}
  </div>`;
};

UIHost.prototype._renderDataControlsStats = function(d, summary, detail) {
  const mpsColor = d.mpsStatus === 'Active' ? 'good' : '';
  const dataColor = d.droppedRate > 0 ? 'bad' : (d.rawStored > d.storageCapacity * 0.8 ? 'warn' : 'good');
  const gatewayColor = d.gatewayCount > 0 ? 'good' : (d.requestedRate > 0 ? 'bad' : '');
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
    this._sstat('DAQ', d.gatewayCount, 'gateways', gatewayColor),
    this._ssep(),
    this._sstat('Captured', d.ingestRate.toFixed(1), `/ ${d.requestedRate.toFixed(1)}`, dataColor),
    this._ssep(),
    this._sstat('Buffered', d.rawStored.toFixed(1), `/ ${this._fmt(d.storageCapacity)}`, dataColor),
    this._ssep(),
    this._sstat('Processed', d.processedRate.toFixed(1), '/t', dataColor),
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
    ${this._detailRow('Pipeline', 'Fiber → DAQ → Buffer → Compute')}
    ${this._detailRow('Current Bottleneck', d.bottleneck)}
    ${this._detailRow('Requested Stream', d.requestedRate.toFixed(1), 'data/t')}
    ${this._detailRow('DAQ Ingest', d.ingestRate.toFixed(1), `/ ${this._fmt(d.ingestCapacity)}`)}
    ${this._detailRow('Raw Buffer', d.rawStored.toFixed(1), `/ ${this._fmt(d.storageCapacity)}`)}
    ${this._detailRow('Dropped This Tick', d.droppedRate.toFixed(1), 'data')}
    ${this._detailRow('Capture Racks', dd.dataUnits.allInOne || 0)}
    ${this._detailRow('Raw Buffer Racks', dd.dataUnits.storage || 0)}
    ${this._detailRow('CPU Processing', this._fmt(d.cpuCapacity), 'data/t')}
    ${this._detailRow('GPU Processing', this._fmt(d.gpuCapacity), 'data/t')}
    ${this._detailRow('Inactive Data Units', d.inactiveDataUnits)}
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
    const roleColor = ROLE_COLORS[m.profession] || '#4466aa';
    const el = document.createElement('div');
    el.className = 'staff-portrait ' + staffMoodClass(mood);
    el.title = `${m.name} (${m.profession}) — mood: ${mood}, fatigue: ${Math.round(pct)}%, status: ${m.status || 'idle'}`;
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

UIHost.prototype._openStaffInspector = function(staffId, options = {}) {
  openStaffInspector(this.game, staffId, options);
};

UIHost.prototype._openHiringDialog = function() {
  openHiringDialog(this.game);
};

// A cheap fingerprint of everything a staff inspector window's "Work"/
// Needs/Assignment sections actually SHOW — fix round 2's F6's own guard,
// the same shape _renderStaffingBanner already uses for its DOM. Needs
// values are rounded to the nearest 5% (the same precision the needs bars
// display — Math.round(pct) in StaffInspector.js) rather than compared
// exactly: raw fatigue/hunger/morale drift by a small fraction EVERY tick,
// and comparing them at full precision would defeat the guard entirely —
// every call would look "different" even though nothing visibly changed.
// Facility-level facts no single member's own fields can see, but that
// StaffInspector.js's renderInspector reads anyway (fix round 3's issue C):
// the Beam <select>'s own option list (game.registry.getAll()'s ids) and,
// via describeJob's F4 addition, whether the beam has ever actually run at
// all. Computed once per _refreshStaffWindows call and folded into EVERY
// member's own signature below — without it, an operator's inspector kept
// reading "— but the beam has never been started (press Start)" for up to
// 6 ticks after the player pressed Start, because nothing about that fact
// lives on any per-member field this signature otherwise reads.
function facilitySig(game) {
  const state = game?.state || {};
  const entries = game?.registry?.getAll?.() || [];
  return `${state.infraCanRun}|${entries.map(e => `${e.id}:${e.status}`).join(',')}`;
}

// A cheap fingerprint of everything a staff inspector window's "Work"/
// Needs/Assignment/Skills sections actually SHOW — fix round 1's F6's own
// guard, the same shape _renderStaffingBanner already uses for its DOM.
//
// Fix round 3's issue C found this guard ALSO suppressing genuine updates,
// including the one round 1's own F3 fix existed to fix: `describeJob`'s
// beam-status suffix depends on `facilitySig` (added here), and
// `stats.ticksWorked`/`stats.breakdowns`/the full `skills` object were
// missing outright (frozen up to 49 ticks, never reflected at all).
// Needs are rounded to the nearest 1% — StaffInspector.js's own needs bars
// render `Math.round(pct)`, i.e. 1% precision; this signature used to round
// to the nearest 5%, coarser than what's actually on screen, so a real,
// visible 1-4% change could go un-rendered for several ticks. Still
// rounded, not exact — raw fatigue/hunger/morale drift by a small fraction
// EVERY tick, and comparing at full float precision would defeat the guard
// entirely (measured otherwise fine: 340 real changes over 2000 ticks, a
// dropdown surviving ~6 real seconds untouched).
function staffWindowSig(m, facSig) {
  const job = m.job;
  const s = m.stats || {};
  const skills = m.skills || {};
  const skillsStr = Object.keys(skills).sort().map(k => `${k}:${skills[k]}`).join(',');
  return [
    m.mood, m.status, m.shift,
    m.assignment?.zoneId || '', m.assignment?.beamlineId || '',
    job?.jobType || '', job?.phase || '', job?.stationKey || '', job?.target?.nodeId || '',
    m.idleReason || '', m.unservicedPenalty ? 1 : 0,
    Math.round((m.needs?.fatigue ?? 0) * 100), Math.round((m.needs?.hunger ?? 0) * 100), Math.round((m.needs?.morale ?? 0) * 100),
    (m.history || []).length,
    s.repairs || 0, s.commissions || 0, s.sparesMade || 0, s.analyses || 0, s.beamHours || 0, s.ticksWorked || 0, s.breakdowns || 0,
    skillsStr,
    facSig,
  ].join('|');
}

// Refreshes every open staff-related window against LIVE state — called
// every tick from _updateHUD (fix round 1's F3), not just on 'staffChanged'.
// That event fires on hire/fire/assignment, never on a job or idleReason
// changing mid-tick, which left every one of these windows able to go
// stale and stay that way indefinitely: the staffing banner names "no
// console", the player opens the roster, builds one, the banner clears —
// and the open roster (and any inspector opened from it) kept reading the
// old text forever, directly contradicting this whole layer's reason for
// existing.
//
// Fix round 2's F6: calling every tick with NO guard meant every open
// inspector's whole body — including its three live <select> elements
// (Zone/Beam/Shift, each freshly built and re-listened on every render —
// see StaffInspector.js's renderInspector) — was destroyed and rebuilt
// about once a second regardless of whether anything shown had actually
// changed. An open <select>'s dropdown closes the instant its underlying
// element is replaced, so a player mid-click on the Zone dropdown lost
// their own in-progress selection before they could make it; scroll
// position and text selection reset the same way on every refresh, on
// both the inspector and the roster. `staffWindowSig`/the roster's own
// membership+reason signature (mirroring `_renderStaffingBanner`'s own
// guard) now skip the rebuild — and so skip destroying any of that —
// whenever nothing visible actually changed since the last refresh.
UIHost.prototype._refreshStaffWindows = function() {
  const members = (this.game && this.game.state && this.game.state.staffMembers) || [];
  if (!this._staffWindowSigs) this._staffWindowSigs = new Map();
  const facSig = facilitySig(this.game);
  const liveIds = new Set();
  for (const m of members) {
    const win = ContextWindow.getWindow('staff-' + m.id);
    if (!win || typeof win.refresh !== 'function') continue;
    liveIds.add(m.id);
    const sig = staffWindowSig(m, facSig);
    if (this._staffWindowSigs.get(m.id) === sig) continue;
    this._staffWindowSigs.set(m.id, sig);
    try { win.refresh(); } catch (_) {}
  }
  // Drop signatures for staff no longer on the roster (fired, e.g.) so a
  // later same-id member (shouldn't happen, but ids are otherwise unbounded
  // over a long save) never inherits a stale comparison baseline.
  for (const id of [...this._staffWindowSigs.keys()]) {
    if (!liveIds.has(id)) this._staffWindowSigs.delete(id);
  }

  const hiring = ContextWindow.getWindow('hiring-dialog');
  if (hiring && typeof hiring.refresh === 'function') {
    try { hiring.refresh(); } catch (_) {}
  }

  const roster = ContextWindow.getWindow(STAFFING_ROSTER_WINDOW_ID);
  if (roster && typeof roster.refresh === 'function') {
    const report = facilityStaffingReport(this.game);
    const group = report.byReason.find(g => g.reason === roster._staffingRosterReason);
    const rosterSig = group ? `${group.reason}|${group.members.map(m => m.id).join(',')}` : 'gone';
    if (this._staffingRosterSig !== rosterSig) {
      this._staffingRosterSig = rosterSig;
      try { roster.refresh(); } catch (_) {}
    }
  }
};

// --- Build-menu search ------------------------------------------------
//
// The search bar lives at the right of the category-tab row in
// #palette-search (index.html). Typing filters #component-palette to a flat,
// cross-category result list; clicking a result switches mode + category to
// the item's home and arms it — see src/ui/palette-search.js for ranking.

UIHost.prototype._getPaletteIndex = function() {
  // Lazy + cached: rebuilding walks every COMPONENTS/FLOORS/WALL_TYPES/
  // DOOR_TYPES/DECORATIONS/ZONE_FURNISHINGS/ZONES entry, which is cheap
  // but pointless to redo on every keystroke. Invalidated on
  // 'researchChanged' (see _bindHUDEvents) so newly-unlocked components
  // become searchable without a reload.
  if (!this._paletteIndexCache) this._paletteIndexCache = buildPaletteIndex(this.game);
  return this._paletteIndexCache;
};

UIHost.prototype._bindPaletteSearch = function() {
  const input = document.getElementById('palette-search-input');
  if (!input) return;

  const runSearch = (query) => {
    const q = query.trim();
    if (!q) {
      this._paletteSearchResults = null;
      this._refreshPalette();
      return;
    }
    this._paletteSearchResults = searchPalette(q, this._getPaletteIndex());
    // tabCategory is irrelevant here — _renderPaletteImpl short-circuits to
    // the flat search list before the category switch runs — but routing
    // through _renderPalette (rather than rendering into #component-palette
    // directly) means its _applyPaletteHotkeyBadges() pass still runs.
    this._renderPalette(undefined);
  };

  // Debounced like the manual's search box (WikiWindow.js) — 120ms.
  input.addEventListener('input', () => {
    if (this._paletteSearchDebounce) clearTimeout(this._paletteSearchDebounce);
    this._paletteSearchDebounce = setTimeout(() => runSearch(input.value), 120);
  });

  // Escape leaves search mode completely: restore the normal palette and
  // return keyboard focus to the game. Consume it locally instead of falling
  // through to the esc-stack (src/ui/esc-stack.js), which would otherwise
  // also disarm the active tool or close whatever dialog is open.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    if (this._paletteSearchDebounce) clearTimeout(this._paletteSearchDebounce);
    this._paletteSearchDebounce = null;
    runSearch('');
    input.blur();
  });
};

// Cost text for a search-result item. COMPONENTS/facility/furnishing defs
// carry a multi-resource cost object (funding + possibly others); floors/
// walls/doors/decorations carry a plain funding cost (see _costLabel); a
// zone paint tool has no direct cost of its own — its cost is the floor it
// requires.
UIHost.prototype._searchResultCostLabel = function(kind, def) {
  if (kind === 'zone') {
    return `Requires ${floorRequirementLabel(def.requiredFloor)}`;
  }
  if (kind === 'component' || kind === 'facility' || kind === 'furnishing') {
    return Object.entries(def.cost || {}).map(([r, a]) =>
      r === 'funding' ? `$${this._fmt(a)}` : `${this._fmt(a)} ${r}`
    ).join(', ');
  }
  return _costLabel(def.cost);
};

// Preview thumbnail/swatch for a search-result item, dispatched by kind.
// Mirrors the preview logic already in _createPaletteItem / _renderPaletteImpl
// for each family, simplified to a single swatch fallback shape (search
// results are a secondary view; the per-family clip-path shapes there exist
// to match a tile/wall/door footprint, which doesn't matter here).
UIHost.prototype._buildSearchResultPreview = function(result, def) {
  const previewEl = document.createElement('div');
  previewEl.className = 'palette-preview';
  const { kind, id } = result;

  if (kind === 'component' || kind === 'facility' || kind === 'furnishing') {
    const thumbUrl = renderComponentThumbnail(id, 96);
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.width = 96;
      img.height = 96;
      img.style.objectFit = 'contain';
      previewEl.appendChild(img);
    } else {
      const color = def.spriteColor || 0x888888;
      const hex = '#' + color.toString(16).padStart(6, '0');
      const swatch = document.createElement('div');
      swatch.style.cssText = `width:48px;height:40px;background:${hex};border-radius:4px;`;
      previewEl.appendChild(swatch);
    }
  } else if (kind === 'decoration') {
    const vi = recallVariant(id);
    const thumbUrl = renderDecorationThumbnail(id, 96, vi);
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.width = 96;
      img.height = 96;
      img.style.objectFit = 'contain';
      previewEl.appendChild(img);
    } else {
      const spritePath = this.sprites.getSpritePath(def.spriteKey);
      const img = document.createElement('img');
      img.src = spritePath || `assets/decorations/${def.spriteKey}.png`;
      img.alt = def.name;
      img.onerror = () => { img.style.display = 'none'; };
      previewEl.appendChild(img);
    }
  } else if (kind === 'window') {
    const vi = recallVariant(id);
    const img = document.createElement('img');
    img.src = windowPreviewDataUrl(id, vi);
    img.alt = def.name;
    img.width = 96;
    img.height = 64;
    img.style.objectFit = 'contain';
    previewEl.appendChild(img);
  } else if (kind === 'floor' || kind === 'wall' || kind === 'door') {
    const vi = recallVariant(id);
    const tilePath = this.sprites.getTilePath(id, vi);
    if (tilePath) {
      const img = document.createElement('img');
      img.src = tilePath;
      img.alt = def.name;
      previewEl.appendChild(img);
      applyPreviewTint(previewEl, def, vi);
    } else {
      const c = def.topColor || def.color || 0x888888;
      const swatch = document.createElement('div');
      swatch.style.cssText = `width:48px;height:24px;background:#${c.toString(16).padStart(6,'0')};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);`;
      previewEl.appendChild(swatch);
    }
  } else if (kind === 'zone') {
    const hex = '#' + (def.color || 0x888888).toString(16).padStart(6, '0');
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:48px;height:24px;background:${hex};clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);opacity:0.7;`;
    previewEl.appendChild(swatch);
  }
  return previewEl;
};

// Look up a search-result's definition object in its owning family
// registry. Returns null for a stale entry (id no longer exists) so the
// caller can skip it defensively.
function paletteSearchDef(kind, id) {
  if (kind === 'component' || kind === 'facility') return COMPONENTS[id];
  if (kind === 'furnishing') return ZONE_FURNISHINGS[id];
  if (kind === 'floor') return FLOORS[id];
  if (kind === 'wall') return WALL_TYPES[id];
  if (kind === 'door') return DOOR_TYPES[id];
  if (kind === 'decoration') return DECORATIONS[id];
  if (kind === 'zone') return ZONES[id];
  return null;
}

UIHost.prototype._buildSearchResultItem = function(result, idx) {
  const { kind, id, mode, category } = result;
  const def = paletteSearchDef(kind, id);
  if (!def) return null;

  // Same gates _createPaletteItem applies to COMPONENTS: the active
  // beamline-type filter (checked live, not baked into the cached index —
  // it can change every time the player selects a different beamline) and
  // zone-tier gating for facility-mode items. Unlike research-lock, neither
  // of these makes an item permanently unsearchable, so they're re-checked
  // here at render time instead of at index-build time.
  let zoneBlocked = false;
  if (kind === 'component' || kind === 'facility') {
    if (this._beamlineTypeHidesComponent(id, def)) return null;
    if (isFacilityCategory(def.category) && this.game.getZoneTierForCategory) {
      const zoneTier = this.game.getZoneTierForCategory(def.category);
      const compTier = def.zoneTier != null ? def.zoneTier : 1;
      zoneBlocked = zoneTier < compTier;
    }
  }

  const affordable = kind === 'zone' ? true : this.game.canAfford(
    (kind === 'component' || kind === 'facility' || kind === 'furnishing')
      ? def.cost
      : { funding: _costVal(def.cost) }
  );

  const item = document.createElement('div');
  item.className = 'palette-item';
  item.dataset.paletteIndex = idx;
  item.dataset.paletteKey = id;
  item.dataset.paletteKind = kind;
  if (!affordable) item.classList.add('unaffordable');
  if (zoneBlocked) item.classList.add('zone-blocked');

  item.appendChild(this._buildSearchResultPreview(result, def));

  const nameEl = document.createElement('div');
  nameEl.className = 'palette-name';
  nameEl.textContent = def.name || id;
  item.appendChild(nameEl);

  // Home-category subtitle — the whole point of a flat cross-category list
  // is that the player didn't know (or shouldn't have to know) which tab
  // this lives under, so tell them.
  const catEl = document.createElement('div');
  catEl.className = 'palette-search-category';
  const modeDef = MODES[mode];
  const catName = modeDef?.categories?.[category]?.name || category;
  catEl.textContent = `${modeDef?.name || mode} • ${catName}`;
  item.appendChild(catEl);

  const costEl = document.createElement('div');
  costEl.className = 'palette-cost';
  costEl.textContent = this._searchResultCostLabel(kind, def);
  item.appendChild(costEl);

  if (kind === 'component' || kind === 'facility') {
    item.addEventListener('mouseenter', () => this._showPalettePreview(def));
    item.addEventListener('mouseleave', () => this._hidePalettePreview());
  } else if (kind === 'zone') {
    this._attachSimpleHoverPreview(item, def.name, def.desc, [
      ['Requires', floorRequirementLabel(def.requiredFloor)],
    ]);
  } else {
    this._attachSimpleHoverPreview(item, def.name, def.desc, [
      ['Cost', this._searchResultCostLabel(kind, def)],
    ]);
  }

  // Zone-blocked items are shown but inert, matching _createPaletteItem
  // (no click handler attached at all while blocked).
  if (!zoneBlocked) {
    item.addEventListener('click', () => this._armSearchResult(result));
  }

  return item;
};

UIHost.prototype._renderPaletteSearchResults = function(palette, results) {
  if (!results || results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-search-empty';
    empty.textContent = 'No matches.';
    palette.appendChild(empty);
    return;
  }
  let paletteIdx = 0;
  let sawDescDivider = false;
  for (const result of results) {
    // searchPalette groups name/id matches ahead of description-only
    // matches (see palette-search.js). Mark the seam with a small label so
    // "matched inside the description, not the name" is legible rather than
    // reading as a randomly-included item — this is where "table" would
    // have shown a cooling chiller before the word-boundary fix, and
    // grouping+labelling keeps a *legitimate* description hit (e.g.
    // "klystron" finding an RF source by its desc) from looking like noise.
    if (result.matchedIn === 'desc' && !sawDescDivider) {
      sawDescDivider = true;
      const divider = document.createElement('div');
      divider.className = 'palette-search-divider';
      divider.textContent = 'Also mentioned in description';
      palette.appendChild(divider);
    }
    const item = this._buildSearchResultItem(result, paletteIdx);
    if (!item) continue; // beamline-type-hidden or stale entry
    paletteIdx++;
    palette.appendChild(item);
  }
};

// Clicking a search result: switch mode + category to the item's home tab
// (matching what a normal mode-button/cat-tab click does), clear the
// search box back to the normal category view, then arm the tool — the
// same {kind, key, variant} path every other palette click uses.
UIHost.prototype._armSearchResult = function(result) {
  const { mode, category, kind, id } = result;

  // Facility mode's tab bar is additionally filtered by a Labs/Rooms
  // toggle (_generateCategoryTabs); land on whichever side the result's
  // category belongs to, or its tab won't be in the regenerated bar.
  if (mode === 'facility') {
    const catDef = MODES.facility.categories[category];
    if (catDef?.group) this._facilityGroup = catDef.group;
  }

  this._paletteSearchResults = null;
  const input = document.getElementById('palette-search-input');
  if (input) input.value = '';

  // Same steps as a mode-btn click (_bindHUDEvents).
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  this.activeMode = mode;
  this._generateCategoryTabs();
  this._updateSystemStatsVisibility();

  // _generateCategoryTabs lands on the mode's first tab; select the
  // result's actual home category instead (same effect as a cat-tab click).
  const tabs = document.querySelectorAll('#category-tabs .cat-tab');
  let matched = false;
  tabs.forEach(t => {
    const isMatch = t.dataset.category === category;
    t.classList.toggle('active', isMatch);
    if (isMatch) matched = true;
  });
  if (matched) {
    this._renderPalette(category);
    this._updateSystemStatsContent(category);
    if (this._onTabSelect) this._onTabSelect(category);
  }

  this._selectPaletteTool(kind, id, recallVariant(id));
};
