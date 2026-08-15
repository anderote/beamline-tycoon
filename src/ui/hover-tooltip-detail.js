// Safe, compact renderer for the optional colored segments in a world-hover
// detail line. Plain hover-info callers keep using a single text node.

export const HOVER_DETAIL_TONE_CLASSES = Object.freeze({
  supply: 'hover-tooltip-segment-supply',
  healthy: 'hover-tooltip-segment-healthy',
  warning: 'hover-tooltip-segment-warning',
  critical: 'hover-tooltip-segment-critical',
});

const DETAIL_RENDER_KEY = Symbol('hoverTooltipDetailRenderKey');

function detailRenderKey(info) {
  if (!Array.isArray(info?.detailSegments)) return `plain:${info?.detail || ''}`;
  return `segments:${info.detailSegments
    .map(segment => `${segment?.tone || ''}:${segment?.text || ''}`)
    .join('|')}`;
}

/** Render hover detail text without accepting or injecting HTML. */
export function renderHoverTooltipDetail(element, info) {
  if (!element) return;
  const key = detailRenderKey(info);
  if (element[DETAIL_RENDER_KEY] === key) return;

  const segments = Array.isArray(info?.detailSegments) ? info.detailSegments : null;
  if (!segments) {
    element.textContent = info?.detail || '';
    element[DETAIL_RENDER_KEY] = key;
    return;
  }

  const doc = element.ownerDocument || document;
  const nodes = segments.map(segment => {
    const text = String(segment?.text ?? '');
    const className = HOVER_DETAIL_TONE_CLASSES[segment?.tone];
    if (!className) return doc.createTextNode(text);
    const span = doc.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  });
  element.replaceChildren(...nodes);
  element[DETAIL_RENDER_KEY] = key;
}
