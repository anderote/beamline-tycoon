// Navbar structure and music mute behavior. These checks stay DOM-free so
// they can run in the ordinary Node regression suite.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MusicPlayer } from '../src/ui/MusicPlayer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n--- Navbar rows ---');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const primaryStart = html.indexOf('<div id="top-bar-primary">');
const infoStart = html.indexOf('<div id="top-bar-info">');
const infoEnd = html.indexOf('</div>', html.indexOf('</div>', html.indexOf('id="beam-stats-panel"')) + 6);
const primary = html.slice(primaryStart, infoStart);
const info = html.slice(infoStart, infoEnd);

assert(primary.includes('id="sim-controls"') && primary.includes('id="top-buttons"'),
  'top row owns simulation, music, and action controls');
assert(!primary.includes('id="resources"') && !primary.includes('id="staff-bar"'),
  'top row contains controls rather than facility information');
assert(info.includes('id="resources"') && info.includes('id="staff-bar"')
    && info.includes('id="beam-summary"') && info.includes('id="beam-stats-panel"'),
  'second row owns resources, staff, beam status, and facility statistics');
assert(/--hud-topbar-height:\s*98px/.test(css)
    && /--hud-bottom-height:\s*330px/.test(css),
  'top and bottom HUD rails have explicit stable heights');
assert(/#bottom-hud\s*\{[^}]*height:\s*var\(--hud-bottom-height\)/s.test(css),
  'bottom HUD consumes the shared fixed-height token');

console.log('\n--- Navbar mute control ---');
assert(html.includes('class="mp-btn mp-mute"') && html.includes('aria-label="Unmute music"'),
  'music area exposes an accessible unmute button');

const classes = new Set();
const attrs = {};
const button = {
  textContent: '', title: '',
  setAttribute(name, value) { attrs[name] = value; },
  classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
};
const player = {
  audio: { muted: true },
  muteBtn: button,
  _saveState() {},
  _updateMuteButton() { MusicPlayer.prototype._updateMuteButton.call(this); },
};

player._updateMuteButton();
assert(button.textContent === '🔇' && button.title === 'Unmute music'
    && attrs['aria-pressed'] === 'true' && !classes.has('active'),
  'muted state invites unmuting and is announced to assistive technology');
const nowMuted = MusicPlayer.prototype.toggleMute.call(player);
assert(nowMuted === false && player.audio.muted === false,
  'navbar button changes the real audio muted property');
assert(button.textContent === '🔊' && button.title === 'Mute music'
    && attrs['aria-pressed'] === 'false' && classes.has('active'),
  'unmuted state changes icon, action label, and active styling');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
