// src/ui/BeamlineTypePicker.js — the New Beamline picker.
//
// The complete accelerator mission roster. A mission is a target band and a
// commercial/scientific purpose, so it is never research-gated. Research gates
// the components and stock designs that can implement that mission.
//
// Picking a type opens the second half of the RCT2 flow: the folder of stock
// designs that ship with it (src/data/stock-designs.js), plus a "Custom" entry
// that is the behaviour this picker had before blueprints existed. So
// `onConfirm` returns TWO things — the type id, and either a blueprint or null:
//
//   onConfirm(typeId, null)     arm the palette, the player places a source
//   onConfirm(typeId, design)   arm the palette AND hand the design to
//                               DesignPlacer, which places the source itself
//
// The picker still creates nothing in either case. It returns a BEAMLINE_TYPES
// id through `onConfirm`, and the caller (hud.js) parks it on the game as
// `pendingBeamlineTypeId`; the beamline itself is minted later, by
// Game._ensureBeamlineForSourcePlaceable, when a source is actually placed.
// That indirection is forced by the model — registry entries are lazy — and it
// is also the right UX: picking a type arms the palette, it does not spend
// money.
//
// It matters for the blueprint path too, and more sharply: a blueprint's first
// component IS a source, so the pick has to be armed before DesignPlacer.
// confirm() runs its first placeJunction, or the beamline it builds comes out
// untyped. Arming happens in the caller (hud.js / main.js) at the moment the
// ghost starts, which is strictly before any click that could place anything.
//
// Built on ContextWindow like every other dialog here (HiringDialog is the
// closest sibling): draggable, Esc-closable, one instance at a time.
//
// The palette-filter predicate lives here too rather than in hud.js. Two
// reasons: it is the other half of the same rule — the picker decides what a
// beamline IS, the predicate decides what that entitles it to build — and
// hud.js transitively imports the 3D component builder, so nothing in it is
// reachable from a Node test. This module is pure enough to import headless.

import { ContextWindow } from './ContextWindow.js';
import {
  BEAMLINE_TYPES, getBeamlineType,
} from '../data/beamline-types.js';
import { MODES } from '../data/modes.js';
import { RESEARCH } from '../data/research.js';
import { COMPONENTS } from '../data/components.js';
import { stockDesignsFor, getStockDesign } from '../data/stock-designs.js';

const WIN_ID = 'beamline-type-picker';

/**
 * Measured beam performance per blueprint id — whatever
 * `node scripts/eval-design.mjs --write` last wrote.
 *
 * Loaded through import.meta.glob rather than a plain import because the file
 * is GENERATED and is legitimately allowed to be absent: a fresh clone that has
 * never run the harness, or a blueprint authored since the last run. glob
 * resolves to `{}` when nothing matches, so a missing file costs a card its
 * performance line and nothing else — where a static import would fail the
 * whole bundle over a file that is not source, and a fetch would put a network
 * round trip in front of a menu.
 *
 * Node has no import.meta.glob at all (this module is imported headless by the
 * test suite), which is what the try is for.
 *
 * NOTHING HERE IS EVER ESTIMATED. A card states a number only if the physics
 * engine produced it for that exact blueprint id; no entry means no line.
 */
const MEASURED = (() => {
  try {
    const hits = import.meta.glob('../data/stock-designs.measured.json', {
      eager: true, import: 'default',
    });
    return Object.values(hits)[0] || {};
  } catch {
    return {};
  }
})();

/** The measured record for a blueprint id, or null if it was never measured. */
export function measuredFor(designId) {
  return (designId && MEASURED[designId]) || null;
}

/**
 * What a blueprint costs to build, in funding, counting components only.
 *
 * Deliberately NOT the number DesignPlacer quotes: that one adds concrete for
 * every tile the line has no foundation under and the beam pipe between
 * modules, neither of which is knowable until the ghost is over a spot. This is
 * the hardware price — stable, comparable between cards, and always the smaller
 * of the two, which is the honest direction for a menu to be wrong in.
 */
export function stockDesignCost(design) {
  return (design?.components || []).reduce(
    (sum, c) => sum + (COMPONENTS[c.type]?.cost?.funding || 0), 0);
}

/**
 * The categories a beamline type is allowed to speak for. Infra, Structure,
 * Grounds and Facility hardware is trunk by construction — a vacuum pump is
 * not "wrong for a therapy line" — so the filter never looks at it, and the
 * data files carry no `beamlineTypes` allowlists outside these five.
 */
export const BEAMLINE_CATEGORIES = new Set(Object.keys(MODES.beamline.categories));

/**
 * Should a component be hidden from the build palette, given the type of the
 * beamline currently being built?
 *
 * Two directions, both needed, each meaning something different (see the
 * headers of beamline-types.js and beamline-components.raw.js):
 *   - the COMPONENT's `beamlineTypes` allowlist says "this is special-purpose
 *     hardware", and omitting it means trunk — visible everywhere;
 *   - the TYPE's `excludes` says "this is general hardware that is wrong
 *     here", which is what keeps a type's identity readable in one place.
 *
 * Either one hiding it is enough. No type, or an unknown type id, hides
 * nothing — which is what every pre-picker save and every scenario-authored
 * beamline gets, and why turning this on changes nothing until a player
 * actually picks a type.
 *
 * @param {string|null} typeId  BEAMLINE_TYPES id, or null for "no type"
 * @param {string} key          component id as keyed in COMPONENTS
 * @param {object} comp         the COMPONENTS entry
 */
export function beamlineTypeHidesComponent(typeId, key, comp) {
  if (!comp || !BEAMLINE_CATEGORIES.has(comp.category)) return false;
  if (!typeId) return false;
  const type = getBeamlineType(typeId);
  if (!type) return false;
  if (Array.isArray(comp.beamlineTypes) && !comp.beamlineTypes.includes(typeId)) return true;
  if (Array.isArray(type.excludes) && type.excludes.includes(key)) return true;
  return false;
}

function hex(color) {
  return '#' + (color >>> 0).toString(16).padStart(6, '0');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// Unit choice is made once for a whole band — from its TOP bound — and then
// applied to both ends, so a band never reads "5 MeV–0.05 GeV". A measured
// single value is the degenerate case of the same rule, which is why the
// scale/format pairs below are shared rather than duplicated: a blueprint card
// sitting under a type card has to speak the same units it does.
function energyUnit(top) {
  const useMeV = top != null && top < 1;
  return { scale: useMeV ? 1000 : 1, unit: useMeV ? 'MeV' : 'GeV' };
}
function energyDigits(x) {
  // Keep 5 MeV as "5" and 17.5 GeV as "17.5" without trailing zero noise.
  return (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
}
function currentUnit(top) {
  const useUa = top != null && top < 0.1;
  return { scale: useUa ? 1000 : 1, unit: useUa ? 'µA' : 'mA' };
}
function currentDigits(x) {
  if (x >= 10) return Math.round(x).toString();
  if (x >= 1) return (Math.round(x * 10) / 10).toString();
  return (Math.round(x * 1000) / 1000).toString();
}

/**
 * A [lo, hi] GeV band as the unit a physicist would actually say it in.
 * Sub-GeV bands read in MeV; the collider's 45–120 GeV stays in GeV. A null
 * bound means the gate is one-sided.
 */
export function formatEnergyBand(band) {
  if (!Array.isArray(band)) return '—';
  const [lo, hi] = band;
  const { scale, unit } = energyUnit(hi ?? lo);
  const fmt = (v) => (v == null ? '' : energyDigits(v * scale));
  if (lo == null) return `< ${fmt(hi)} ${unit}`;
  if (hi == null) return `> ${fmt(lo)} ${unit}`;
  return `${fmt(lo)}–${fmt(hi)} ${unit}`;
}

/** Current band in mA, dropping to µA when the whole band is sub-µ-scale. */
export function formatCurrentBand(band) {
  if (!Array.isArray(band)) return null;
  const [lo, hi] = band;
  const { scale, unit } = currentUnit(hi ?? lo);
  const fmt = (v) => (v == null ? '' : currentDigits(v * scale));
  if (lo == null) return `< ${fmt(hi)} ${unit}`;
  if (hi == null) return `> ${fmt(lo)} ${unit}`;
  return `${fmt(lo)}–${fmt(hi)} ${unit}`;
}

/** One measured energy in GeV, in the unit its own magnitude calls for. */
export function formatEnergyValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const { scale, unit } = energyUnit(v);
  return `${energyDigits(v * scale)} ${unit}`;
}

/** One measured current in mA, dropping to µA the way the bands do. */
export function formatCurrentValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const { scale, unit } = currentUnit(v);
  return `${currentDigits(v * scale)} ${unit}`;
}

/**
 * The performance line for a blueprint card: "24.6 MeV · 2.1 mA", or null when
 * the blueprint has no measured entry.
 *
 * Null is a first-class answer here and the caller must render nothing at all
 * for it. A card that guessed — from component count, from catalogue energy
 * gains, from the type's own band — would be advertising a machine nobody has
 * ever run, which is the exact failure stock-designs.js and eval-design.mjs
 * exist to prevent.
 */
export function formatMeasuredPerformance(designId) {
  const m = measuredFor(designId);
  if (!m) return null;
  const parts = [formatEnergyValue(m.beamEnergy), formatCurrentValue(m.beamCurrent)]
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Why a measured number is not a promise. eval-design.mjs measures every
 * blueprint with all six utilities fully provisioned (see its IDEAL_PROVISION),
 * because a blueprint is a beamline and not a facility — it carries no
 * cryoplant, no RF station and no pumps, and feeding the machine is a large
 * part of the game. Shown as a tooltip wherever the line appears.
 */
export const MEASURED_CAVEAT =
  'Measured by running this exact blueprint through the physics engine with '
  + 'power, RF, cooling, cryo, vacuum and data fully provisioned. Your facility '
  + 'has to actually supply that.';

function completedResearchSet(researchState) {
  if (!researchState) return new Set();
  if (researchState instanceof Set) return researchState;
  if (Array.isArray(researchState)) return new Set(researchState);
  return new Set(researchState.completedResearch || []);
}

function researchRequirements(id) {
  const req = RESEARCH[id]?.requires;
  return !req ? [] : (Array.isArray(req) ? req : [req]);
}

/**
 * Prerequisite-first research path for arbitrary root nodes.
 *
 * Direct type gates are not a useful answer by themselves: saying a future
 * proton machine "needs Proton Acceleration" hides Cyclotron Technology, the
 * step the player can actually start today. Walking the DAG here makes the
 * picker an actionable roadmap rather than a list of locked nouns.
 */
function researchPathForRoots(rootIds, researchState) {
  const done = completedResearchSet(researchState);
  const visiting = new Set();
  const emitted = new Set();
  const path = [];

  const visit = (id) => {
    if (!id || done.has(id) || emitted.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const req of researchRequirements(id)) visit(req);
    visiting.delete(id);
    const node = RESEARCH[id];
    // Hidden compatibility nodes cannot be started in the research UI. Their
    // live prerequisites still belong in the path; the hidden alias does not.
    if (node?.hidden) return;
    emitted.add(id);
    path.push({ id, name: node?.name || id, category: node?.category || null });
  };

  for (const id of rootIds || []) visit(id);
  return path;
}

/** Remaining component research before a particular stock design is honest. */
export function designUnlockPath(design, researchState) {
  const roots = [];
  for (const part of design?.components || []) {
    const req = COMPONENTS[part.type]?.requires;
    if (Array.isArray(req)) roots.push(...req);
    else if (req) roots.push(req);
  }
  return researchPathForRoots(roots, researchState);
}

function compactPath(path, max = 3) {
  if (!path.length) return '';
  const shown = path.slice(0, max).map(node => node.name).join(' → ');
  return path.length > max ? `${shown} → +${path.length - max} more` : shown;
}

function missionBriefHtml(typeCount) {
  return '<section class="bltype-brief blt-panel">'
    + '<div class="bltype-brief-kicker">MISSION PROFILE // OPEN ROSTER</div>'
    + '<div class="bltype-brief-row">'
    + '<strong>Choose what the beamline is for.</strong>'
    + `<span>${typeCount} compatible missions</span>`
    + '</div>'
    + '<div class="bltype-brief-path" aria-hidden="true">'
    + '<i></i><b></b><i></i><b></b><i></i>'
    + '</div>'
    + '<p>Research unlocks components, better cavities and performance upgrades — '
    + 'never the mission itself.</p>'
    + '</section>';
}

/**
 * The blueprint gallery for one type: its stock designs in tier order, plus the
 * Custom entry that is what this picker did before blueprints existed.
 *
 * Custom is always present and always last. It is the fallback for a type
 * nobody has authored blueprints for yet — which is most of them today — and
 * it stays there once they have, because building it yourself is the game.
 */
function blueprintPanelHtml(type, selectedDesignId, researchState) {
  if (!type) {
    return '<div class="blueprint-empty">Pick a machine type to see the beamlines it ships with.</div>';
  }

  const designs = stockDesignsFor(type.id);
  let html = '<div class="blueprint-panel">';
  html += `<div class="blueprint-panel-head">Prebuilt — ${esc(type.name)}</div>`;
  html += '<div class="blueprint-list">';

  for (const d of designs) {
    const sel = selectedDesignId === d.id ? ' selected' : '';
    const unlockPath = designUnlockPath(d, researchState);
    const locked = unlockPath.length ? ' locked' : '';
    const cost = stockDesignCost(d);
    const perf = formatMeasuredPerformance(d.id);

    html += `<div class="blueprint-card${sel}${locked}" data-design-id="${esc(d.id)}">`;
    html += '<div class="blueprint-head">';
    html += `<span class="blueprint-name">${esc(d.name)}</span>`;
    html += `<span class="bltype-tier">T${d.tier}</span>`;
    html += '</div>';
    html += '<div class="bltype-specs">';
    html += `<span class="bltype-spec">$${cost.toLocaleString()}</span>`;
    html += `<span class="bltype-spec">${d.components.length} parts</span>`;
    html += '</div>';
    // No measured entry, no line. See formatMeasuredPerformance.
    if (perf) {
      html += `<div class="blueprint-measured" title="${esc(MEASURED_CAVEAT)}">`
        + `◈ ${esc(perf)}</div>`;
    }
    if (unlockPath.length) {
      html += `<div class="blueprint-lock" title="${esc(unlockPath.map(n => n.name).join(' → '))}">`
        + `🔒 Hardware needed (${unlockPath.length}): ${esc(compactPath(unlockPath))}</div>`;
    }
    html += `<div class="bltype-blurb">${esc(d.blurb)}</div>`;
    html += '</div>';
  }

  const customSel = selectedDesignId ? '' : ' selected';
  html += `<div class="blueprint-card blueprint-card-custom${customSel}" data-design-id="">`;
  html += '<div class="blueprint-head">';
  html += '<span class="blueprint-name">Custom — build it yourself</span>';
  html += '</div>';
  html += '<div class="bltype-blurb">Filters the palette to this type and nothing else: '
    + 'place your own source and lay the line out by hand.</div>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

/**
 * Open the picker.
 *
 * @param {object} game
 * @param {{ onConfirm?: (typeId: string|null, design: object|null) => void,
 *           sourceType?: string|null, showBlueprints?: boolean }} [opts]
 *   onConfirm receives the chosen BEAMLINE_TYPES id — or null when the player
 *   picks "Free Build" (no type — the whole catalogue, as before types existed)
 *   — and the stock blueprint they chose, or null for a custom build. A
 *   blueprint is a STOCK_DESIGNS entry, i.e. exactly the shape DesignPlacer
 *   .start() takes; the caller is expected to arm the type and hand it over.
 */
export function openBeamlineTypePicker(game, {
  onConfirm, sourceType = null, showBlueprints = sourceType == null,
} = {}) {
  const existing = ContextWindow.getWindow(WIN_ID);
  if (existing) { existing.focus(); return existing; }

  const ctx = new ContextWindow({
    id: WIN_ID,
    title: sourceType
      ? `${COMPONENTS[sourceType]?.name || 'Source'} — What are we building?`
      : 'New Beamline — What is it FOR?',
    icon: '⚛',
    accentColor: '#3d6ee6',
  });

  // Start on whatever the palette is already filtered to, so reopening the
  // picker on an existing beamline shows that type highlighted rather than
  // nothing.
  const sourceDef = sourceType ? COMPONENTS[sourceType] : null;
  const sourceCompatible = (typeId) => !Array.isArray(sourceDef?.beamlineTypes)
    || sourceDef.beamlineTypes.includes(typeId);
  let selected = game.getActiveBeamlineTypeId?.() || null;
  if (selected && !sourceCompatible(selected)) selected = null;
  // '' means Custom. RCT2 opens a track type on its stock designs rather than
  // on an empty editor, so the lowest tier is the default where one exists.
  let selectedDesignId = showBlueprints ? defaultDesignFor(selected) : '';

  function defaultDesignFor(typeId) {
    if (!showBlueprints || !typeId) return '';
    return stockDesignsFor(typeId)
      .find(design => designUnlockPath(design, game.state).length === 0)?.id || '';
  }

  function render(container) {
    // Selecting a type re-renders the whole body, and the blueprint panel sits
    // below a nine-tile grid that does not fit the window — without this the
    // list you just asked for scrolls away from you as it appears.
    const scroll = container.scrollTop;
    const types = Object.values(BEAMLINE_TYPES).filter(t => sourceCompatible(t.id));
    let html = missionBriefHtml(types.length);
    html += '<div class="bltype-grid">';

    for (const t of types) {
      const accent = hex(t.accentColor);
      const cls = ['bltype-card'];
      if (selected === t.id) cls.push('selected');

      const current = formatCurrentBand(t.spec?.currentMA);

      html += `<div class="${cls.join(' ')}" data-type-id="${esc(t.id)}"`
        + ` style="--bltype-accent:${accent};">`;
      html += '<div class="bltype-card-head">';
      html += `<span class="bltype-name">${esc(t.name)}</span>`;
      html += `<span class="bltype-tier">T${t.tier}</span>`;
      html += '</div>';
      html += '<div class="bltype-specs">';
      html += `<span class="bltype-spec">${esc(t.particle)}</span>`;
      html += `<span class="bltype-spec">${esc(formatEnergyBand(t.spec?.energyGeV))}</span>`;
      if (current) html += `<span class="bltype-spec">${esc(current)}</span>`;
      html += '</div>';
      html += `<div class="bltype-blurb">${esc(t.blurb)}</div>`;
      html += '</div>';
    }

    html += '</div>';
    if (showBlueprints) {
      html += blueprintPanelHtml(
        selected ? getBeamlineType(selected) : null,
        selectedDesignId,
        game.state,
      );
    } else {
      html += '<div class="bltype-source-note">The choice sets target bands, '
        + 'recommended hardware and the Designer’s mission plots. No hardware is added yet.</div>';
    }
    container.innerHTML = html;
    container.scrollTop = scroll;

    container.querySelectorAll('.bltype-card').forEach(card => {
      card.addEventListener('click', () => {
        // Re-rendering replaces the node under the cursor, and a replaced node
        // never receives the second click — so a card that is already selected
        // must be left alone or dblclick below can never fire.
        if (selected === card.dataset.typeId) return;
        selected = card.dataset.typeId;
        selectedDesignId = defaultDesignFor(selected);
        render(container);
        syncActions();
      });
      // Double-click is the shortcut for "this one, go" — and it means what it
      // always meant: arm the palette for this type, custom build. Letting it
      // fire whatever blueprint happened to be default-selected would turn a
      // familiar gesture into an unasked-for placement ghost.
      card.addEventListener('dblclick', () => {
        selected = card.dataset.typeId;
        selectedDesignId = '';
        confirm();
      });
    });

    container.querySelectorAll('.blueprint-card').forEach(card => {
      if (card.classList.contains('locked')) return;
      card.addEventListener('click', () => {
        const id = card.dataset.designId || '';
        if (id === selectedDesignId) return;   // see the type-card click above
        selectedDesignId = id;
        render(container);
        syncActions();
      });
      card.addEventListener('dblclick', () => {
        selectedDesignId = card.dataset.designId || '';
        confirm();
      });
    });
  }

  function confirm() {
    if (!selected) return;
    const type = getBeamlineType(selected);
    if (!type) return;
    // A blueprint only ever speaks for its own type. The panel is rebuilt from
    // the selected type on every render so the two cannot drift, but the id is
    // the thing that leaves this module, so it is checked where it is used.
    const picked = selectedDesignId ? getStockDesign(selectedDesignId) : null;
    const design = picked && picked.typeId === type.id
      && designUnlockPath(picked, game.state).length === 0 ? picked : null;

    if (onConfirm) onConfirm(type.id, design);
    game.log?.(
      design
        ? `${design.name} — click to place it. F=rotate, Esc=cancel.`
        : `${type.name} selected — place a source to start it.`,
      'info',
    );
    ctx.close();
  }

  function syncActions() {
    const type = selected ? getBeamlineType(selected) : null;
    const picked = type && selectedDesignId ? getStockDesign(selectedDesignId) : null;
    const design = picked && designUnlockPath(picked, game.state).length === 0
      ? picked : null;
    const label = !type
      ? 'Select a type'
      : (design && design.typeId === type.id ? `Build ${design.name}` : `Build ${type.name}`);
    ctx.setActions([
      {
        label,
        style: type ? '' : 'opacity:0.45;cursor:default;',
        onClick: () => confirm(),
      },
      {
        // The way back to an unfiltered palette. Untyped beamlines still work
        // — they simply score and filter exactly as they did before types
        // existed — so this is a real option, not an escape hatch.
        label: 'Free Build',
        style: 'flex:0 0 auto;',
        onClick: () => { if (onConfirm) onConfirm(null); ctx.close(); },
      },
      { label: 'Cancel', style: 'flex:0 0 auto;', onClick: () => ctx.close() },
    ]);
  }

  if (ctx._body) {
    ctx._el?.classList.add('bltype-window', 'blt-panel');
    render(ctx._body);
  }
  // Tab-less window: ContextWindow.update() would wipe the body with no tab
  // renderer to refill it, so point both at the body render (as HiringDialog).
  ctx.refresh = () => { if (ctx._body) render(ctx._body); };
  ctx.update = () => ctx.refresh();
  syncActions();

  return ctx;
}
