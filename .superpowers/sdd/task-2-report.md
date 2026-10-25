# Task 2 report — Borító újrakikeresés gomb a szerkesztőben

**Branch:** `feat/cover-steam-import`
**Base:** `7594a69`
**Commit:** `c274407` — `feat: borító újrakikeresése a mappából a szerkesztőben (cover:rescan)`

## What I implemented

### 1. `cover:rescan(id)` IPC handler (`src/main/ipc.js`)

Added after `cover:reset`, same pattern as `cover:pick`:

1. `library.getGame(id)` — unknown id → `{ ok: false, message: 'Ismeretlen játék.' }`
2. `exists(game.folder)` — missing folder → `{ ok: false, message: 'A játék mappája nem érhető el.' }`
3. `findCoverImage(toExtended(game.folder))` — runs the exact same search/priority logic used by `detectGame` (folder.jpg → cover.jpg → poster.jpg → banner.jpg → first image fallback), extended-path safe. No image → `{ ok: false, message: 'Nem találtam borítóképet a játék mappájában.' }`
4. `copyCoverToStore(library, displayPath(found), game.id)` — copies into `library.coverDir` with a unique `${gameId}-${Date.now()}${ext}` name. Failure → `{ ok: false, message: 'Nem sikerült bemásolni a megtalált képet.' }`
5. `deleteOldCover(game, target)` then `game.cover = target`, `library.saveNow()`, `broadcast()`
6. Returns `{ ok: true }`

`findCoverImage` was exported from `src/main/scanner.js` (it already existed; only the export list changed) so the handler reuses the canonical search logic instead of duplicating candidate lists. `toExtended` imported from `./paths`.

The handler overwrites any previously auto-set cover and deletes the old **managed** cover file (only files inside `library.coverDir`; original images in the game folder are never deleted). This matches `cover:pick` semantics.

### 2. Preload bridge (`src/preload/preload.js`)

Added `rescanCover: (id) => ipcRenderer.invoke('cover:rescan', id)` next to `pickCover`/`resetCover`.

### 3. Editor button (`src/renderer/index.html`)

In `.cover-actions`, between "Kép kiválasztása" and "Generált borító":

```html
<button type="button" class="ghost-btn accent" id="btn-cover-rescan">
  Borító keresése a mappában
</button>
```

### 4. Click handler (`src/renderer/app.js`)

Added `el('btn-cover-rescan')` listener after `btn-cover-reset`:
- guards on `state.editorId`
- disables the button for the duration (same pattern as `launchGame`), re-enables in `finally`
- awaits `api.rescanCover(state.editorId)`
- on failure: error toast with the handler's message (fallback message)
- on success: `refreshState()`, `updateCoverPreview(game)`, `render()` (grid + detail refresh), success toast
- catches thrown IPC errors and toasts them

### 5. Styling (`src/renderer/styles.css`)

Follows the existing `.ghost-btn` / `.ghost-btn.danger` pattern:

```css
.ghost-btn.accent { color: var(--color-secondary); border-color: rgba(139, 92, 246, 0.4); }
.ghost-btn.accent:hover { background: rgba(139, 92, 246, 0.14); border-color: rgba(139, 92, 246, 0.65); }
.ghost-btn:disabled { opacity: 0.55; cursor: progress; }
```

Uses the purple brand token (`--color-secondary`), distinguishable from the neutral pick/reset buttons without competing with the primary CTA.

## Tests and results

### Project test suite (`node scripts/test-scan.js`)

Extended `scripts/test-scan.js` with two new cases (existing 6 kept):

- **Test 7:** `findCoverImage` priority order on a temp game folder (folder.jpg wins over banner.jpg) and `copyCoverToStore` copies the found image into a temp covers dir with matching content while preserving the source file.
- **Test 8:** `findCoverImage` returns `null` for an image-less folder and for a nonexistent folder.

Result: `Borító-tesztek: 8/8 sikeres`

### Handler-level integration check (temporary script, not committed)

Because `node_modules/electron` is not installed in this worktree, I ran the real `registerIpc()` with a stubbed `electron` module (`require` resolution stub) and a fake library store, invoking the registered `cover:rescan` handler directly:

1. Happy path: cover copied into `covers/`, content matches source, old managed cover file deleted, source image preserved — PASS
2. Image-less game folder: `{ ok: false }` with message, existing cover and file untouched — PASS
3. Nonexistent game folder: `{ ok: false }` — PASS
4. Unknown game id: `{ ok: false }` — PASS

Result: `cover:rescan handler checks: 4/4 OK`

### Syntax checks

`node --check` on `src/main/ipc.js`, `src/main/scanner.js`, `src/preload/preload.js`, `src/renderer/app.js`, `scripts/test-scan.js` — all OK.

## Files changed

- `src/main/ipc.js` — `cover:rescan` handler, imports (`findCoverImage`, `toExtended`)
- `src/main/scanner.js` — export `findCoverImage`
- `src/preload/preload.js` — `rescanCover`
- `src/renderer/index.html` — `#btn-cover-rescan` button
- `src/renderer/app.js` — button click handler
- `src/renderer/styles.css` — `.ghost-btn.accent`, `.ghost-btn:disabled`
- `scripts/test-scan.js` — 2 new cover tests

## Self-review findings

- Verified against the design spec (`docs/superpowers/specs/...design.md` §5.4): button id `btn-cover-rescan`, label "Borító keresése a mappában", rescan overwrites previous automatic cover. All match.
- Verified no manual-cover protection is bypassed unintentionally: only the scan (`mergeScanResults`) preserves manual covers; the rescan is an explicit user action and intentionally overwrites, per spec.
- Old **unmanaged** covers (e.g. absolute paths to images in the game folder from older app versions) are not deleted — correct, the user's own files must never be removed.
- Added `catch` to the renderer handler after reviewing the sibling `launchGame` pattern, so a rejected IPC call cannot leave the user without feedback.
- No other call sites needed updating (only one `api` object, no mocks/whitelists found).

## Issues / concerns

- No visual/runtime smoke test in the actual Electron app: dependencies are not installed in this worktree (`node_modules/electron` absent), so the UI was verified by code review plus handler-level stub execution. A quick manual check on a dev machine is recommended (`npm start` → edit a game → "Borító keresése a mappában").
- `cover:rescan` will also replace a manually picked cover, because the data model has no manual/auto cover marker. This is intended for this explicit button per the plan, but the plan's global anti-goal only governs automatic scan-time overwrites.
- Repeated rescans always create a new copy (unique `Date.now()` name) and delete the previous managed cover — expected overwrite behavior, at the cost of one file write per click.
- `Date.now()` filename collision is theoretically possible for two calls in the same millisecond; harmless (same target path, old cover not deleted because `game.cover === target`).

## Fix round 1

### What I fixed

The prior review's Important finding: `cover:rescan` unconditionally overwrote manually picked covers. The earlier report's concern on line 107 ("`cover:rescan` will also replace a manually picked cover...") is now resolved by introducing an explicit cover provenance marker.

**New data model: `coverMode: 'manual' | 'auto' | null`**

- `src/main/library.js`
  - `normalizeGame()` reads `raw.coverMode`, accepting only `'manual'` / `'auto'`; anything else (including missing/legacy data) becomes `null`.
  - `updateGame()` accepts a `coverMode` patch using the same validation, so the field is persisted through `library.json` and survives reloads.
- `src/main/ipc.js`
  - `cover:pick` → `game.coverMode = 'manual'`.
  - `cover:reset` → `game.coverMode = null`.
  - `cover:rescan` → if `game.coverMode === 'manual'`, returns
    `{ ok: false, message: 'Kézzel kiválasztott borítót nem írhatom felül automatikus felismeréssel.' }`
    before touching the cover or the filesystem. Otherwise it overwrites as before and sets `game.coverMode = 'auto'`.
  - `addFromDetection()` auto-cover path sets `coverMode = 'auto'` when the detected cover is copied into the covers store.
  - The manual "no auto detection" game object created by `game:addFromFolder` now explicitly starts with `coverMode: null`.
- `src/main/scanner.js`
  - `detectGame()` initializes `coverMode: null` and sets `'auto'` only when `findCoverImage()` actually finds a cover.
  - `mergeScanResults()` sets `'auto'` for newly added games and for existing games whose missing cover is filled in by the scan. Existing covers (including manual ones) are still never touched by the scan.
- `src/renderer/app.js`: no change needed — the existing `cover:rescan` handler already shows `result.message` in an error toast, so the manual-cover rejection is surfaced to the user.
- `src/preload/preload.js`, `src/renderer/index.html`, `src/renderer/styles.css`: no change needed.

Behavior after the fix:

| Situation | `cover:rescan` result |
|---|---|
| Manual cover (`coverMode === 'manual'`) | `{ ok: false }`, cover/coverMode/file untouched |
| Auto cover or no cover | `{ ok: true }`, cover replaced, `coverMode = 'auto'` |
| Unknown game / missing folder / no image | unchanged error responses |

### What I tested and test results

Extended `scripts/test-scan.js` from 8 to 13 checks. All pass: **`Borító-tesztek: 13/13 sikeres`**.

New/updated cases:

- **Test 4 (updated):** scan merge leaves a `coverMode: 'manual'` cover and its mode untouched.
- **Test 5 (updated):** newly added auto cover gets `coverMode: 'auto'`.
- **Test 6 (updated):** a scan-filled cover on an existing game gets `coverMode: 'auto'`.
- **Test 9:** `normalizeGame()` defaults `coverMode` to `null`, accepts `'manual'` / `'auto'`, and rejects arbitrary values.
- **Test 10:** `LibraryStore.addGame()` / `updateGame()` persist `coverMode` to `library.json`, and a fresh `load()` reads it back.
- **Test 11:** full `cover:rescan` handler (real `registerIpc`, stubbed `electron`) on a game with `coverMode: 'manual'` → `ok: false`, exact Hungarian message, cover path/mode/file unchanged.
- **Test 12:** full `cover:rescan` handler on a game with `coverMode: 'auto'` → `ok: true`, old managed cover deleted, new cover copied into `covers/`, `coverMode` becomes `'auto'`, source image preserved.
- **Test 13:** full `cover:pick` sets `coverMode = 'manual'`; `cover:reset` clears both `cover` and `coverMode`.

The IPC tests load the real `src/main/ipc.js` with a minimal `electron` stub (`ipcMain.handle`, `dialog.showOpenDialog`, `shell.openPath`) installed via `Module._load` only for the duration of the `require`, then restored. `registerIpc()` is called with a fake library pointing at temp directories; `tracker.stop()` is called in `finally`.

Syntax checks: `node --check` on `src/main/ipc.js`, `src/main/library.js`, `src/main/scanner.js`, `scripts/test-scan.js` — all OK.

### Files changed

- `src/main/library.js` — `coverMode` normalization + `updateGame()` patch support.
- `src/main/ipc.js` — mode transitions in `cover:pick` / `cover:reset` / `cover:rescan`, auto mode in `addFromDetection`, explicit `null` on manual game creation.
- `src/main/scanner.js` — `coverMode` in `detectGame()` and `mergeScanResults()` auto paths.
- `scripts/test-scan.js` — updated 3 assertions + 5 new tests (13 total).

### Self-review findings

- Re-read the design spec (§4 option C, §5.1–5.2) and the brief's anti-goal: rescan now overwrites only covers not marked manual, exactly matching "felülírja a régebbi automatikusat" and "A felhasználó kézzel beállított borítója soha ne kerüljön felülírásra automatikus felismeréssel."
- The guard runs before folder/image checks, so a manual cover cannot be lost even if the game folder is temporarily unavailable.
- All auto-detection paths (`detectGame`, `mergeScanResults` add/fill branches, `addFromDetection`) now mark their cover as `'auto'`; all user actions (`cover:pick`) mark it `'manual'`.
- `cover:reset` intentionally clears the marker — a subsequent rescan is then allowed, which is the expected "start over" behavior.
- No renderer change was needed: `src/renderer/app.js:699-701` already displays `result.message` as an error toast.
- `publicState()` does not expose `coverMode` because no UI currently needs it; the handler-side guard is authoritative. This keeps the renderer contract unchanged.
- Legacy `library.json` files have no `coverMode`; they normalize to `null`, preserving the previous behavior (rescan allowed). This is deliberate but means a cover manually picked *before* this change cannot be distinguished from an auto cover. Noted below.

### Concerns

- Migration edge case: covers manually picked before this fix have no provenance marker and therefore remain rescan-overwritable. Correcting that would require a heuristic (e.g. treating unmarked managed covers as manual), which would also block legitimate rescans of older auto covers. Left as-is for this task.
- Still no real Electron runtime smoke test in this worktree (`node_modules/electron` absent); handler behavior is covered by the stubbed integration tests above.

