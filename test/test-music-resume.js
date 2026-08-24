// Regression coverage for soundtrack continuity across reloads and rebuilds.
// These helpers are DOM-free so the identity rules can be tested without
// pretending that Node's audio implementation behaves like a browser's.

import {
  formatMusicThemeName,
  hasSavedPlayback,
  mergeMusicManifests,
  resolveSavedTrackIndex,
} from '../src/ui/MusicPlayer.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const reorderedTracks = [
  { file: 'gamma.ogg', name: 'gamma' },
  { file: 'alpha.ogg', name: 'alpha' },
  { file: 'beta.ogg', name: 'beta' },
];

console.log('music reload state');

const stableSave = {
  selectedTheme: 'sovietcore',
  currentIndex: 0,
  currentTrackFile: 'beta.ogg',
  currentTime: 137.25,
  wasPlaying: true,
};
check('recognizes a saved soundtrack session', hasSavedPlayback(stableSave));
check('restores by filename after manifest reordering',
  resolveSavedTrackIndex(reorderedTracks, stableSave) === 2);

const legacySave = { selectedTheme: 'sovietcore', currentIndex: 1, currentTime: 20 };
check('recognizes legacy index-only state', hasSavedPlayback(legacySave));
check('legacy state still restores by index',
  resolveSavedTrackIndex(reorderedTracks, legacySave) === 1);

check('invalid indices do not select a random track',
  resolveSavedTrackIndex(reorderedTracks, { currentIndex: 99 }) === -1);
check('an empty preference does not suppress the first-run welcome track',
  !hasSavedPlayback({ selectedTheme: 'sovietcore', currentIndex: -1 }));

console.log('\nmusic manifest composition');

const hostedBase = 'https://audio.example.test/soundtrack';
const merged = mergeMusicManifests([
  {
    manifest: {
      baseUrl: `${hostedBase}/`,
      themes: { bardcore: ['hosted.mp3'], sovietcore: ['night-drive.mp3'] },
    },
    manifestDir: 'music-web',
  },
  {
    manifest: {
      bardcore: [],
      'labtime-radio': ['001 - Atom Bomb Baby.mp3'],
    },
    manifestDir: 'music',
  },
]);
check('local playlists join the hosted soundtrack',
  Object.keys(merged.themes).length === 3 && merged.themes['labtime-radio'].length === 1);
check('an empty local folder does not hide a hosted theme',
  merged.themes.bardcore[0] === 'hosted.mp3');
check('hosted themes retain their object-storage base URL',
  merged.themeBaseUrls.sovietcore === hostedBase);
check('local themes retain their local manifest base URL',
  merged.themeBaseUrls['labtime-radio'] === 'music');
check('playlist slugs have a player-friendly label',
  formatMusicThemeName('labtime-radio') === 'Labtime Radio');

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
