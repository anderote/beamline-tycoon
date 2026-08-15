// src/ui/window-preview.js
//
// Small, self-contained build-menu illustrations for the edge-mounted window
// catalogue. These intentionally do not depend on THREE or the texture loader:
// the palette can create them immediately, and every variant has a truthful
// glass tint even before renderer assets finish loading.

import { WINDOW_TYPES, WINDOW_WIDTH_FRAC } from '../data/structure.js';

const FRAME_COLORS = {
  drywall_painted: '#e6e4dc',
  metal_painted_white: '#edf0f2',
  metal_brushed: '#a9b2b6',
  metal_dark: '#505565',
};

function hex(color, fallback) {
  return `#${(color ?? fallback).toString(16).padStart(6, '0')}`;
}

/**
 * A compact SVG data URL depicting the same aperture, frame weight and glass
 * tint as a WINDOW_TYPES entry. It is deliberately exported as a pure helper
 * so palette/search preview coverage can be tested without a DOM or WebGL.
 */
export function windowPreviewDataUrl(windowType, variant = 0, width = 96, height = 64) {
  const def = WINDOW_TYPES[windowType];
  if (!def) return null;

  const apertureW = Math.round(68 * (WINDOW_WIDTH_FRAC[def.windowWidth] ?? 0.5));
  const apertureH = Math.max(18, Math.round(40 * (def.openingHeight / 11)));
  const x = Math.round((width - apertureW) / 2);
  const y = Math.round((height - apertureH) / 2);
  const heavy = windowType === 'leadedObservation' || windowType === 'hutchViewport';
  const frameW = heavy ? 5 : 3;
  const glass = hex(def.variantGlassColors?.[variant] ?? def.glassColor, 0xcfe8f5);
  const frame = FRAME_COLORS[def.frameTexture] || '#b6bcc2';
  const wall = heavy ? '#2f3443' : '#41464d';
  const innerX = x + frameW;
  const innerY = y + frameW;
  const innerW = Math.max(2, apertureW - frameW * 2);
  const innerH = Math.max(2, apertureH - frameW * 2);
  const grid = windowType === 'industrialSash'
    ? [1, 2].map(i => `<path d="M ${innerX + innerW * i / 3} ${innerY} V ${innerY + innerH}"/>`).join('')
      + `<path d="M ${innerX} ${innerY + innerH / 2} H ${innerX + innerW}"/>`
    : '';
  const lead = heavy
    ? `<path d="M ${innerX + innerW / 2} ${innerY} V ${innerY + innerH} M ${innerX} ${innerY + innerH / 2} H ${innerX + innerW}"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="6" fill="#252a30"/>
    <rect x="${x - 4}" y="${y - 4}" width="${apertureW + 8}" height="${apertureH + 8}" rx="2" fill="${wall}"/>
    <rect x="${x}" y="${y}" width="${apertureW}" height="${apertureH}" rx="1" fill="${frame}"/>
    <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="${glass}" fill-opacity=".78"/>
    <path d="M ${innerX + 2} ${innerY + 2} L ${innerX + innerW - 2} ${innerY + innerH - 2}" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
    <g fill="none" stroke="${frame}" stroke-width="${heavy ? 2.5 : 1.5}">${grid}${lead}</g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
