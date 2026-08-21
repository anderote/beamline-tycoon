const DEFAULT_RANGE = Object.freeze([0, 1]);

export const DESIGNER_PLOT_TAG_LIMIT = 2;
export const DESIGNER_PLOT_TAG_COLORS = Object.freeze(['#ffcb6b', '#5de6ff']);

/**
 * Add a persistent plot tag without coupling the pointer event path to the
 * canvas renderer. Tags are capped independently per panel. Once both slots
 * are occupied, the next click replaces the oldest tag while retaining that
 * tag's A/B slot and colour; the other comparison endpoint stays put.
 */
export function addDesignerPlotTag(tagsByPanel, panelId, position) {
  if (!(tagsByPanel instanceof Map) || !position) return null;
  const panel = String(panelId ?? '0');
  const tags = [...(tagsByPanel.get(panel) || [])];
  let slot;
  if (tags.length >= DESIGNER_PLOT_TAG_LIMIT) {
    slot = tags.shift()?.slot ?? 0;
  } else {
    const used = new Set(tags.map(tag => tag.slot));
    slot = used.has(0) ? 1 : 0;
  }
  const tag = {
    slot,
    s: Number.isFinite(position.s) ? Number(position.s) : null,
    x: Number(position.x),
    y: Number(position.y),
  };
  tags.push(tag);
  tagsByPanel.set(panel, tags);
  return tag;
}

/** Hover draws first; persistent tags draw afterwards and therefore stay on top. */
export function designerPlotCursorLayers(tags, hover = null) {
  const layers = hover ? [{ kind: 'hover', cursor: hover }] : [];
  return layers.concat(
    [...(tags || [])]
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map(tag => ({ kind: 'tag', cursor: tag })),
  );
}

export function designerPlotTagCount(tagsByPanel) {
  if (!(tagsByPanel instanceof Map)) return 0;
  let count = 0;
  for (const tags of tagsByPanel.values()) count += tags?.length || 0;
  return count;
}

/** Create independent Y-range settings for each Designer plot panel. */
export function createDesignerPlotYRanges(panelCount = 3) {
  return Array.from({ length: panelCount }, () => ({
    mode: 'auto',
    min: null,
    max: null,
  }));
}

/** Validate one stored primary-axis range. Fixed logarithmic axes must be positive. */
export function validateDesignerFixedYRange(range, yAxisMode = 'linear') {
  const min = Number(range?.min);
  const max = Number(range?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { valid: false, error: 'Enter finite minimum and maximum values.' };
  }
  if (max <= min) {
    return { valid: false, error: 'Maximum must be greater than minimum.' };
  }
  if (yAxisMode === 'log' && min <= 0) {
    return { valid: false, error: 'Logarithmic ranges must be greater than zero.' };
  }
  return { valid: true, error: '' };
}

/**
 * Seed Fixed mode from the last solver-published autoscale, so switching modes
 * does not make the trace jump until the player edits a bound.
 */
export function suggestDesignerFixedYRange(autoDomain, yAxisMode = 'linear') {
  let min = Number(autoDomain?.[0]);
  let max = Number(autoDomain?.[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    [min, max] = DEFAULT_RANGE;
  }
  if (yAxisMode === 'log' && min <= 0) {
    const positiveMax = max > 0 ? max : 1;
    min = Math.max(positiveMax / 1000, Number.EPSILON);
    max = Math.max(max, min * 10);
  }
  return { mode: 'fixed', min, max };
}

/** Replace only the primary channel; extra axes continue to autoscale. */
export function applyDesignerPlotYRange(autoDomain, range, yAxisMode = 'linear') {
  if (!Array.isArray(autoDomain)) return autoDomain;
  const copied = autoDomain.map(channel => Array.isArray(channel) ? [...channel] : channel);
  if (range?.mode !== 'fixed' || !validateDesignerFixedYRange(range, yAxisMode).valid) {
    return copied;
  }
  copied[0] = [Number(range.min), Number(range.max)];
  return copied;
}

/**
 * Describe the primary axis values shown to the player. Energy is stored in
 * GeV by the solver but edited in the same smart unit currently drawn on-axis.
 */
export function designerPlotPrimaryAxis(type, domain) {
  if (type === 'energy' || type === 'energy-dispersion') {
    const ref = Math.max(Math.abs(Number(domain?.[0]) || 0), Math.abs(Number(domain?.[1]) || 0)) || 1;
    if (ref >= 1000) return { scale: 1e-3, unit: 'TeV' };
    if (ref >= 1) return { scale: 1, unit: 'GeV' };
    if (ref >= 1e-3) return { scale: 1e3, unit: 'MeV' };
    return { scale: 1e6, unit: 'keV' };
  }
  if (type === 'beam-power') {
    const ref = Math.max(Math.abs(Number(domain?.[0]) || 0), Math.abs(Number(domain?.[1]) || 0));
    if (ref >= 1000) return { scale: 1e-3, unit: 'GW' };
    if (ref >= 1) return { scale: 1, unit: 'MW' };
    if (ref >= 1e-3) return { scale: 1e3, unit: 'kW' };
    return { scale: 1e6, unit: 'W' };
  }
  if (type === 'bunch-evolution') {
    const ref = Math.max(Math.abs(Number(domain?.[0]) || 0), Math.abs(Number(domain?.[1]) || 0));
    if (ref >= 1) return { scale: 1, unit: 's' };
    if (ref >= 1e-3) return { scale: 1e3, unit: 'ms' };
    if (ref >= 1e-6) return { scale: 1e6, unit: 'µs' };
    if (ref >= 1e-9) return { scale: 1e9, unit: 'ns' };
    if (ref >= 1e-12) return { scale: 1e12, unit: 'ps' };
    return { scale: 1e15, unit: 'fs' };
  }
  const units = {
    'beam-envelope': 'mm',
    'current-loss': 'mA',
    emittance: 'm·rad',
    'twiss-beta': 'm',
    'phase-advance': 'deg',
    rigidity: 'T·m',
    'beta-acceptance': 'β',
    'peak-current': 'A',
  };
  return { scale: 1, unit: units[type] || '' };
}

/** Compact, input-safe formatting without forcing tiny solver values to zero. */
export function formatDesignerPlotBound(value, scale = 1) {
  const displayed = Number(value) * Number(scale || 1);
  if (!Number.isFinite(displayed)) return '';
  return String(Number(displayed.toPrecision(7)));
}
