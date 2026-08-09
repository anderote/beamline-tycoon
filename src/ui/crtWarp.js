// src/ui/crtWarp.js — CRT barrel bulge, done on the canvas pixels.
//
// This replaces an SVG <feDisplacementMap> approach that kept breaking in ways
// that depended on the browser: the filter is rasterised at device resolution
// while its map and region are specified in CSS pixels, so a fractional
// devicePixelRatio (macOS scaled display modes and browser zoom both produce
// them — 1.8, say) left the field covering only part of the screen. One edge
// would curve correctly while the opposite edge stayed flat.
//
// Here nothing is left to the browser. We own every pixel: the scene is drawn
// to an offscreen canvas at its native low resolution, and each destination
// pixel pulls from a source pixel we choose. Same result on every machine, at
// any pixel ratio or zoom.
//
// Sampling is nearest-neighbour on purpose — the scene is pixel art, so
// interpolating would soften exactly the chunky edges the art is made of.
//
// Cost is a per-pixel gather over a ~571x320 buffer, with the source index for
// every destination pixel precomputed once per size/parameter change, so the
// per-frame work is a flat typed-array copy.

export const CRT_WARP_DEFAULTS = {
  // Displacement at the corners as a fraction of the axis: 0.09 pushes the
  // corners out by 9% of the width horizontally and 9% of the height
  // vertically. The "how curved is the tube" knob.
  bulge: 0.09,
  // 0 = pure r² (an even dome). 1 = r² + r⁴, which keeps the middle of the
  // screen flat and puts the bend in the outer third, like a real tube.
  corner: 0.6,
  // Zoom applied before sampling, as a multiple of `bulge`. At 2 the bulged
  // edges land outside the frame and nothing is cropped away; below that the
  // uncovered rim reads as the curved bezel around the glass.
  overscanPad: 0.7,
  // Phosphor bloom hugging the inside of the tube. Drawn into the source
  // buffer before the warp, so it bends along the glass instead of tracing the
  // rectangular screen edge the way a DOM overlay would.
  glow: 0,
  // Depth of that bloom, in source-canvas pixels.
  glowSize: 9,
  glowColor: [150, 210, 255],
};

/** Colour painted outside the tube (the bezel). */
const BEZEL = [0x05, 0x06, 0x0a, 0xff];

/**
 * Builds the destination→source index table. Entries are indices into the
 * source pixel array, or -1 for "outside the tube".
 */
function buildMap(dw, dh, sw, sh, { bulge, corner, overscanPad }) {
  const map = new Int32Array(dw * dh);
  const norm = 2 + corner * 4; // (r² + corner·r⁴) at a corner, where r² = 2
  const zoom = 1 + bulge * overscanPad;
  let i = 0;
  for (let y = 0; y < dh; y++) {
    // Texel centres, so the field is exactly symmetric about the middle.
    const v = ((y + 0.5) / dh) * 2 - 1;
    for (let x = 0; x < dw; x++, i++) {
      const u = ((x + 0.5) / dw) * 2 - 1;
      const r2 = u * u + v * v;
      const f = (r2 + corner * r2 * r2) / norm; // 0 at the centre, 1 at corners
      // Push the sample outward so the picture bows toward the viewer. u spans
      // the full width over [-1,1], so a displacement of `bulge` of the width
      // is 2·bulge in u units.
      const k = (1 + 2 * bulge * f) / zoom;
      const sx = Math.round((((u * k) + 1) / 2) * sw - 0.5);
      const sy = Math.round((((v * k) + 1) / 2) * sh - 0.5);
      map[i] = sx < 0 || sy < 0 || sx >= sw || sy >= sh ? -1 : sy * sw + sx;
    }
  }
  return map;
}

export function createCrtWarp(opts = {}) {
  const cfg = { ...CRT_WARP_DEFAULTS, ...opts };
  let map = null;
  let key = '';
  let dst = null; // reused ImageData for the destination

  const ensure = (ctx, dw, dh, sw, sh) => {
    const k = `${dw}x${dh}<${sw}x${sh}|${cfg.bulge}|${cfg.corner}|${cfg.overscanPad}`;
    if (k === key) return;
    map = buildMap(dw, dh, sw, sh, cfg);
    dst = ctx.createImageData(dw, dh);
    key = k;
  };

  return {
    get: () => ({ ...cfg }),
    set(next) {
      Object.assign(cfg, next);
      key = ''; // force a rebuild on the next frame
    },
    /**
     * Paints the inner edge bloom onto the source buffer. Call after the scene
     * is drawn and before apply(), so the warp carries it onto the curve.
     */
    edge(ctx, w, h) {
      if (cfg.glow <= 0) return;
      const [r, g, bl] = cfg.glowColor;
      const d = Math.max(1, Math.round(cfg.glowSize));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // One gradient per side; the corners get both and so glow brightest,
      // which is what a real tube does.
      const sides = [
        [0, 0, d, 0, d, h], [w, 0, w - d, 0, d, h],
        [0, 0, 0, d, w, d], [0, h, 0, h - d, w, d],
      ];
      for (const [x0, y0, x1, y1, gw, gh] of sides) {
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, `rgba(${r},${g},${bl},${cfg.glow})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), gw, gh);
      }
      ctx.restore();
    },
    /**
     * Warps the `sw`x`sh` source into an `dw`x`dh` destination. The destination
     * is deliberately larger: the curve of the tube edge is then computed at
     * display resolution instead of the scene's chunky native height, so the
     * rim reads as a smooth arc rather than a staircase, while the art itself
     * still arrives via nearest-neighbour and stays crisply pixelated.
     */
    apply(srcCtx, dstCtx, sw, sh, dw = sw, dh = sh) {
      ensure(dstCtx, dw, dh, sw, sh);
      const src = srcCtx.getImageData(0, 0, sw, sh);
      // 32-bit views turn the gather into one read and one write per pixel.
      const s32 = new Uint32Array(src.data.buffer);
      const d32 = new Uint32Array(dst.data.buffer);
      const bezel = new Uint32Array(new Uint8ClampedArray(BEZEL).buffer)[0];
      for (let i = 0; i < map.length; i++) {
        const j = map[i];
        d32[i] = j < 0 ? bezel : s32[j];
      }
      dstCtx.putImageData(dst, 0, 0);
    },
  };
}
