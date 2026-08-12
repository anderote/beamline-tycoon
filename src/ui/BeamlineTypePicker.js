// src/ui/BeamlineTypePicker.js — the New Beamline picker.
//
// RCT2's ride-select list, for accelerators: everything the game contains laid
// out at once, the locked entries visible but greyed and naming the research
// that would open them. Showing what you cannot have yet is the whole point —
// it is the roster, not a menu of the currently affordable.
//
// The picker does not create anything. It returns a BEAMLINE_TYPES id through
// `onConfirm`, and the caller (hud.js) parks it on the game as
// `pendingBeamlineTypeId`; the beamline itself is minted later, by
// Game._ensureBeamlineForSourcePlaceable, when a source is actually placed.
// That indirection is forced by the model — registry entries are lazy — and it
// is also the right UX: picking a type arms the palette, it does not spend
// money.
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
  BEAMLINE_TYPES, getBeamlineType, beamlineTypeUnlocked, missingResearchFor,
} from '../data/beamline-types.js';
import { MODES } from '../data/modes.js';
import { RESEARCH } from '../data/research.js';

const WIN_ID = 'beamline-type-picker';

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

/**
 * A [lo, hi] GeV band as the unit a physicist would actually say it in.
 * Sub-GeV bands read in MeV; the collider's 45–120 GeV stays in GeV. A null
 * bound means the gate is one-sided.
 */
export function formatEnergyBand(band) {
  if (!Array.isArray(band)) return '—';
  const [lo, hi] = band;
  const top = hi ?? lo;
  const useMeV = top != null && top < 1;
  const scale = useMeV ? 1000 : 1;
  const unit = useMeV ? 'MeV' : 'GeV';
  const fmt = (v) => {
    if (v == null) return '';
    const x = v * scale;
    // Keep 5 MeV as "5" and 17.5 GeV as "17.5" without trailing zero noise.
    return (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
  };
  if (lo == null) return `< ${fmt(hi)} ${unit}`;
  if (hi == null) return `> ${fmt(lo)} ${unit}`;
  return `${fmt(lo)}–${fmt(hi)} ${unit}`;
}

/** Current band in mA, dropping to µA when the whole band is sub-µ-scale. */
export function formatCurrentBand(band) {
  if (!Array.isArray(band)) return null;
  const [lo, hi] = band;
  const top = hi ?? lo;
  const useUa = top != null && top < 0.1;
  const scale = useUa ? 1000 : 1;
  const unit = useUa ? 'µA' : 'mA';
  const fmt = (v) => {
    if (v == null) return '';
    const x = v * scale;
    if (x >= 10) return Math.round(x).toString();
    if (x >= 1) return (Math.round(x * 10) / 10).toString();
    return (Math.round(x * 1000) / 1000).toString();
  };
  if (lo == null) return `< ${fmt(hi)} ${unit}`;
  if (hi == null) return `> ${fmt(lo)} ${unit}`;
  return `${fmt(lo)}–${fmt(hi)} ${unit}`;
}

/** Human-readable names for the research nodes a locked type is waiting on. */
export function missingResearchNames(typeId, researchState) {
  return missingResearchFor(typeId, researchState)
    .map(id => RESEARCH[id]?.name || id);
}

/**
 * Open the picker.
 *
 * @param {object} game
 * @param {{ onConfirm?: (typeId: string|null) => void }} [opts]
 *   onConfirm receives the chosen BEAMLINE_TYPES id, or null when the player
 *   picks "Free Build" (no type — the whole catalogue, as before types existed).
 */
export function openBeamlineTypePicker(game, { onConfirm } = {}) {
  const existing = ContextWindow.getWindow(WIN_ID);
  if (existing) { existing.focus(); return existing; }

  const ctx = new ContextWindow({
    id: WIN_ID,
    title: 'New Beamline — What is it FOR?',
    icon: '⚛',
    accentColor: '#3d6ee6',
  });

  // Start on whatever the palette is already filtered to, so reopening the
  // picker on an existing beamline shows that type highlighted rather than
  // nothing.
  let selected = game.getActiveBeamlineTypeId?.() || null;
  if (selected && !beamlineTypeUnlocked(selected, game.state)) selected = null;

  function render(container) {
    const types = Object.values(BEAMLINE_TYPES);
    let html = '<div class="bltype-grid">';

    for (const t of types) {
      const unlocked = beamlineTypeUnlocked(t, game.state);
      const missing = unlocked ? [] : missingResearchNames(t.id, game.state);
      const accent = hex(t.accentColor);
      const cls = ['bltype-card'];
      if (!unlocked) cls.push('locked');
      if (unlocked && selected === t.id) cls.push('selected');

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
      if (!unlocked) {
        html += `<div class="bltype-lock">🔒 Needs ${esc(missing.join(' + ')) || 'research'}</div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.bltype-card').forEach(card => {
      if (card.classList.contains('locked')) return;
      card.addEventListener('click', () => {
        selected = card.dataset.typeId;
        render(container);
        syncActions();
      });
      // Double-click is the shortcut for "this one, go".
      card.addEventListener('dblclick', () => {
        selected = card.dataset.typeId;
        confirm();
      });
    });
  }

  function confirm() {
    if (!selected) return;
    const type = getBeamlineType(selected);
    if (!type) return;
    if (onConfirm) onConfirm(type.id);
    game.log?.(`${type.name} selected — place a source to start it.`, 'info');
    ctx.close();
  }

  function syncActions() {
    const type = selected ? getBeamlineType(selected) : null;
    ctx.setActions([
      {
        label: type ? `Build ${type.name}` : 'Select a type',
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
    ctx._el?.classList.add('bltype-window');
    render(ctx._body);
  }
  // Tab-less window: ContextWindow.update() would wipe the body with no tab
  // renderer to refill it, so point both at the body render (as HiringDialog).
  ctx.refresh = () => { if (ctx._body) render(ctx._body); };
  ctx.update = () => ctx.refresh();
  syncActions();

  return ctx;
}
