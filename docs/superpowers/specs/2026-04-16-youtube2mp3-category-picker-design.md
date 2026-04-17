# youtube2mp3 Category Picker — Design

## Goal

Let the user create and pick a "music category" (subfolder) inside a stable base directory, and download into it. Replaces the current free-form "Save to directory" field.

Motivation: downloads are being organized into themed folders in `beamline-tycoon/public/music/` (e.g. `bardcore`, `sovietcore`). The converter should make it easy to target and create those folders.

## Current state

- Single `#dir` text input for the download destination, defaulting to `~/Music`, persisted to `localStorage` as `yt2mp3.dir`.
- `POST /download` takes `{urls, dir}`; `GET /files?dir=...` lists mp3s in the folder.
- Files section shows mp3s in the chosen directory.

## UI

Two controls in place of the single dir field:

```
Base music directory
[ <text input, persisted> ]

Category
[ <select> ▾ ]   [+ New category]
```

- **Base directory**: free-form text, persisted to `localStorage` as `yt2mp3.base`. Default: `/Users/andrewcote/Documents/software/beamline-tycoon/public/music`.
- **Category**: `<select>` populated from subfolders of the base directory. Selected category persisted to `localStorage` as `yt2mp3.category`.
- **+ New category** button: opens a `prompt()` for a name, POSTs to the server, refreshes the dropdown, selects the new category.

Downloads target `{base}/{selected-category}/`.

## Backend

Two new endpoints in `youtube2mp3.py`:

### `GET /categories?base=<path>`

Returns immediate subdirectory names.

- 200 `{"categories": ["bardcore", "sovietcore"]}` (sorted alphabetically)
- 200 `{"categories": []}` if base doesn't exist or isn't a directory (client treats empty list the same way)

### `POST /categories`

Body: `{"base": "...", "name": "..."}`. Creates `{base}/{name}/`.

- 200 `{"ok": true}` on success
- 400 `{"error": "..."}` for invalid name
- 409 `{"error": "Category already exists"}` if folder already exists
- 400 `{"error": "Base directory does not exist"}` if base is missing

Name validation (server-side):
- Stripped; must be non-empty
- Must match `^[a-zA-Z0-9_-]+$` (prevents spaces, slashes, dots → avoids path traversal and weird filenames)

### Existing endpoints

- `POST /download`: client sends the already-joined path in `dir` (`{base}/{category}`). Server is unchanged.
- `GET /files`: same.

## Client behavior

- On load: read `yt2mp3.base` and `yt2mp3.category` from localStorage, populate base input, fetch categories, select saved category if still present (else first). If no categories exist, show empty dropdown and disable the Download button.
- On base input `change`: persist to localStorage, fetch categories, reset selection.
- On category `change`: persist to localStorage, refresh file list.
- On "+ New category" click: `prompt("Category name:")`; validate client-side with the same regex for quick feedback; POST; on success, refresh categories, select the new one; on error, `alert()` with the server's error message.
- Files section heading updates to "Files in {category}". Files list refreshes on: base change, category change, download completion, new category creation.

## Error handling

- Base directory doesn't exist → categories list is empty, dropdown shows empty, download button disabled, hint text shows "Base directory not found".
- Base has no subfolders → same as above but hint says "No categories — create one".
- Category name invalid client-side → `alert()`, don't POST.
- Category creation fails server-side → `alert()` with the error, leave state unchanged.

## Non-goals

- Renaming, deleting, or moving categories.
- Nested categories (subfolders within subfolders).
- File operations beyond download (no drag-move, no re-categorize).
- Multi-select or bulk operations on categories.
