// src/ui/format.js — shared display-formatting helpers for the DOM UI layer.

// Compact currency: $950, $12k, $3.4M, $1.2B.
export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.floor(n);
}

// Compact plain number: 950, 1.5K, 2.3M. (Same output as Renderer._fmt.)
export function fmtNumber(n) {
  if (n === undefined || n === null) return '0';
  if (typeof n !== 'number') return String(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// === Staff display helpers (top-bar portraits, inspector, hiring dialog) ===

export const ROLE_COLORS = {
  operator: '#44aa66',
  technician: '#aa6633',
  scientist: '#4488ff',
  engineer: '#aa8833',
  machinist: '#886655',
  admin: '#4466aa',
};

export function staffInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] || '') + (parts[1][0] || '');
  return name.slice(0, 2).toUpperCase();
}

// CSS class for a staff mood (top-bar portrait tint).
export function staffMoodClass(mood) {
  if (mood === 'stressed') return 'mood-red';
  if (mood === 'tired') return 'mood-yellow';
  return 'mood-green';
}

// Raw color for a staff mood (inspector / hiring portrait borders).
export function staffMoodColor(mood) {
  if (mood === 'stressed') return '#ff4444';
  if (mood === 'tired') return '#ddaa22';
  return '#44dd66';
}
