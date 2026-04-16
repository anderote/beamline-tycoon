# Themed Music Folders — Design

## Goal

Replace the single flat `public/music/` folder with themed subfolders (e.g. `bardcore`, `sovietcore`) and let the player switch between them via a dropdown.

## Current state

- All MP3s live in `public/music/*.mp3`.
- `vite.config.js` has a `musicManifestPlugin` that serves `/music/tracks.json` at dev time and emits it at build time. The manifest is a flat JSON array of filenames.
- `src/ui/MusicPlayer.js` fetches `/music/tracks.json` and builds URLs as `/music/<file>`.
- Player state (`currentIndex`, `volume`, `shuffled`) persists to `localStorage` under `beamlineTycoon.music`.

## Changes

### 1. Folder structure

```
public/music/
  bardcore/     ← all current mp3s move here
  sovietcore/   ← new, initially empty
```

One-time migration: move the existing files from `public/music/*.mp3` into `public/music/bardcore/`.

Dropping a new folder (e.g. `public/music/spacecore/`) with mp3s inside will make that theme show up automatically — no code changes required.

### 2. Manifest format

`/music/tracks.json` changes from a flat array to an object keyed by theme:

```json
{
  "bardcore": ["Avicii - Wake Me Up ....mp3", "..."],
  "sovietcore": []
}
```

The plugin (dev middleware + build `writeBundle`) scans immediate subdirectories of `public/music/`, filters each for audio files (existing `AUDIO_EXT` regex), and emits this object. Empty folders are included so newly-created themes appear in the dropdown even before tracks are added. Loose files directly under `public/music/` are ignored.

### 3. UI

Add a `<select class="mp-theme">` inside `#music-player` (in `index.html`). The player populates it from the manifest keys on load. Display names are folder names title-cased (`bardcore` → "Bardcore"). Styling to match existing player controls.

### 4. `MusicPlayer.js` behavior

- `_loadTracks()` fetches the new object manifest. Stores `this.themes = { bardcore: [...], sovietcore: [...] }` and `this.themeNames` (sorted alphabetically for stable order).
- Populates the theme `<select>` options from `this.themeNames`.
- Reads `selectedTheme` from `localStorage`; if the saved theme no longer exists (folder deleted), falls back to the first theme in `themeNames`. If no themes exist, shows "No tracks" and disables controls (matches current empty-state behavior).
- New `_setTheme(name)` method:
  - Sets `this.currentTheme = name` and rebuilds `this.tracks` from `this.themes[name]`.
  - Resets `currentIndex = 0`.
  - If `shuffled`, regenerates the shuffle order for the new track list.
  - Updates the track display.
  - If `isPlaying` was true, starts playing track 0 of the new theme. If not, just updates the display without starting playback.
  - Persists `selectedTheme`.
- Theme `<select>` `change` handler calls `_setTheme(newName)`.
- Existing `_saveState` / `_restoreState` gain a `selectedTheme` field alongside `currentIndex`, `volume`, `shuffled`.

### 5. Edge cases

- **Empty theme folder** → `tracks = []`, player shows "No tracks", play/prev/next disabled. Dropdown still shows the theme so the user can switch away.
- **Saved theme no longer exists** (folder deleted between sessions) → fall back to first available theme; `currentIndex` resets to 0.
- **No themes at all** (all folders deleted) → same as current empty state: "No tracks", controls disabled.
- **Loose files under `public/music/`** (not in any subfolder) → ignored. Not surfaced as a "default" or "uncategorized" theme.

## Non-goals

- Per-theme memory of last-played track, shuffle, or volume — one global `currentIndex`/`shuffled`/`volume`, reset `currentIndex` on theme switch.
- Automatic theme selection based on game state.
- Crossfade between themes — switching is a hard cut.
