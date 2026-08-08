// src/ui/crtBarrel.js — real geometric CRT barrel bulge.
//
// Unlike a vignette (which only darkens the edges), this physically warps the
// pixels of whatever element it's applied to — canvas scene, logo, and menu
// DOM all bow outward together — using an SVG <feDisplacementMap>. The
// displacement map is a radial field generated on a canvas: no displacement at
// the centre, growing ∝ r² toward the edges (classic barrel), so straight
// lines actually curve like the face of a CRT tube.

let injected = false;

function makeDisplacementMap(size, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - half) / half; // -1..1
      const v = (y - half) / half;
      const r2 = u * u + v * v; // squared radius → barrel curve
      // Push samples outward toward the edges (bulge the centre toward viewer).
      const dx = u * r2 * strength;
      const dy = v * r2 * strength;
      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, 128 + dx * 127)); // R → x displacement
      d[i + 1] = Math.max(0, Math.min(255, 128 + dy * 127)); // G → y displacement
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/**
 * Apply the barrel bulge to `el`. `scale` is the max pixel displacement at the
 * edges; `strength` shapes the curve. Both are easy to tune.
 */
export function applyCrtBarrel(el, { scale = 62, strength = 0.36, overscan = 1.07 } = {}) {
  if (!injected) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'crt-barrel');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('href', makeDisplacementMap(256, strength));
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', feImage.getAttribute('href'));
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('result', 'map');

    const feDisp = document.createElementNS(NS, 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic');
    feDisp.setAttribute('in2', 'map');
    feDisp.setAttribute('scale', String(scale));
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');

    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    svg.appendChild(filter);
    document.body.appendChild(svg);
    injected = true;
  }
  el.style.filter = 'url(#crt-barrel)';
  // Overscan: the displacement samples slightly past the element at the edges
  // (which would otherwise show transparent → whatever is behind). Scaling the
  // whole screen up a touch pushes those edges just off-viewport, exactly like
  // real CRT overscan — no bleed, and the bulge stays visible.
  el.style.transform = `scale(${overscan})`;
  el.style.transformOrigin = 'center center';
}
