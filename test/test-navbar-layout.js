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
const musicSource = readFileSync(join(ROOT, 'src/ui/MusicPlayer.js'), 'utf8');
const primaryStart = html.indexOf('<div id="top-bar-primary">');
const infoStart = html.indexOf('<div id="top-bar-info">');
const infoEnd = html.indexOf('</div>', html.indexOf('</div>', html.indexOf('id="beam-stats-panel"')) + 6);
const primary = html.slice(primaryStart, infoStart);
const info = html.slice(infoStart, infoEnd);

assert(primary.includes('id="game-title"') && primary.includes('id="music-player"')
    && primary.includes('id="sim-controls"'),
  'top row aligns the game title with music and compact simulation controls');
assert(primary.indexOf('id="game-title"') < primary.indexOf('id="music-player"'),
  'music begins immediately after the Beamline Tycoon title');
assert(!primary.includes('id="resources"') && !primary.includes('id="staff-bar"')
    && !primary.includes('id="btn-hire"'),
  'top row contains identity and compact controls rather than facility information');
assert(info.includes('id="top-buttons"') && info.includes('id="resources"') && info.includes('id="staff-bar"')
    && info.includes('id="beam-summary"') && info.includes('id="beam-stats-panel"'),
  'second row owns navigation, resources, staff, beam status, and facility statistics');
assert(info.indexOf('id="btn-economy"') < info.indexOf('id="btn-hire"')
    && info.indexOf('id="btn-hire"') < info.indexOf('id="btn-build-forward"')
    && /id="btn-hire"[^>]*>Staff<\/button>/.test(info),
  'Staff navigation sits between Economy and Guide');
assert(info.indexOf('id="btn-beamlines"') < info.indexOf('id="resources"')
    && info.indexOf('id="resources"') < info.indexOf('id="beam-stats-panel"'),
  'second row flows from Beamlines actions into statistics');
assert(/id="btn-beamlines"[^>]*>Beamlines<\/button>/.test(info)
    && info.includes('id="beamlines-dropdown"'),
  'top-left Beamlines control owns the per-beamline menu');
assert(/#top-bar-primary #sim-controls\s*\{[^}]*margin-left:\s*auto/s.test(css),
  'simulation controls stay at the right edge of the spacious first row');
assert(/#top-bar-info:has\(\.menu-dropdown:not\(\.hidden\)\)\s*\{[^}]*overflow:\s*visible/s.test(css),
  'an open menu escapes the clipped second row instead of disappearing below it');
assert(musicSource.includes("this.el.closest('#top-bar')"),
  'the embedded music player cannot restore a floating position inside the navbar');
assert(/\.mp-theme\s*\{[^}]*font-family:\s*var\(--ui-font-display\)/s.test(css)
    && /\.mp-theme option\s*\{[^}]*font-family:\s*var\(--ui-font-display\)/s.test(css)
    && /#opt-music-theme,\s*#opt-music-theme option\s*\{[^}]*font-family:\s*var\(--ui-font-display\)/s.test(css),
  'music playlist selectors and their options use the BLT display typeface');
assert(/--hud-topbar-height:\s*98px/.test(css)
    && /--hud-bottom-height:\s*296px/.test(css),
  'top and bottom HUD rails have explicit stable heights');
assert(/#bottom-hud\s*\{[^}]*height:\s*var\(--hud-bottom-height\)/s.test(css),
  'bottom HUD consumes the shared fixed-height token');
assert(/\.palette-item\s*\{[^}]*height:\s*184px/s.test(css)
    && /\.palette-item \.palette-preview\s*\{[^}]*height:\s*86px/s.test(css),
  'compact build cards and thumbnails fit the shorter bottom HUD');

console.log('\n--- Navbar mute control ---');
assert(html.includes('class="mp-btn mp-mute active"') && html.includes('aria-label="Mute music"')
    && html.includes('aria-pressed="false">🔊</button>'),
  'music area starts visibly unmuted with an accessible mute action');
assert(!musicSource.includes('this.audio.muted = true'),
  'the real audio element keeps its browser-default unmuted state');

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
