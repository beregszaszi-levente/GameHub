# Task 1 report — Borító automatikus felismerés a scanban

## What I implemented

`src/main/scanner.js`:

- New constants: `COVER_CANDIDATES = ['folder.jpg', 'cover.jpg', 'poster.jpg', 'banner.jpg']` (priority order) and `COVER_FALLBACK_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i`.
- New helper `findCoverImage(folderExt)`:
  1. Checks the four priority filenames in order via `joinExtended` + `exists`, returns the extended path of the first hit.
  2. Fallback: lists the game folder's own entries (`fs.readdirSync(..., { withFileTypes: true })`) and returns the first regular file whose extension matches the image list.
  3. Returns `null` if nothing matches / the folder is unreadable.
- `detectGame()` now builds the game into a `const game` object instead of returning a literal, then runs the auto-detection guarded by `if (!game.cover)` and sets `game.cover = displayPath(found)`, then returns `game`.
- Added `exists` to the `./paths` import.

`scripts/test-scan.js`:

- Added `assert`/`fs`/`os`/`path` imports, `detectGame`/`mergeScanResults`/`toExtended` imports.
- Added a final `borító` line to the scan report output.
- Added 4 self-tests with temp game folders (`bin/game.exe` + optional images), cleaned up in `finally`:
  1. `folder.jpg` wins over `cover.jpg` (priority).
  2. `screenshot.png` is used as fallback when no priority name exists.
  3. No image → `cover === null`.
  4. `mergeScanResults()` does not overwrite a manually set cover on an existing game.

## Deviation from the plan snippet

The plan's fallback loop iterated over `files` from `collectFiles()`, but `collectFiles()` only collects `.exe/.bat/.cmd` files (line 190), so that loop could never find an image — the fallback was dead code. I implemented the fallback against the game folder's immediate directory listing instead, which matches the intent ("any image file found in the folder"). Priority-name detection is likewise folder-root-scoped, same as the plan's `joinExtended(folderExt, candidate)` calls. No nested/subfolder image search (YAGNI; not required by the spec).

## Tests and results

Command: `node scripts/test-scan.js` (also `npm run test:scan` equivalent).

Final output (tail): `Borító-tesztek: 4/4 sikeres`, exit code 0, no temp dirs left behind. `node --check` passes on both changed files.

### TDD Evidence

RED — before implementation (`detectGame` returns `cover: null`):

```
node scripts/test-scan.js
...
Összesen: 2 játék, 12 ms

node:assert:152
  throw new AssertionError(obj);
  ^

AssertionError [ERR_ASSERTION]: folder.jpg-nek kell borítónak lennie
+ actual - expected

+ null
- 'C:\\Users\\bereg\\AppData\\Local\\Temp\\gh-cover-test-V9OCAZ\\folder.jpg'
    at scripts/test-scan.js:80:10
...
Exited with code 1
```

GREEN — after implementation:

```
node scripts/test-scan.js
...
Összesen: 2 játék, 12 ms

Borító-tesztek: 4/4 sikeres
```
(exit code 0)

## Files changed

- `src/main/scanner.js`
- `scripts/test-scan.js`

Commit: `c4e6d8f feat: automatikus borítófelismerés a scan során (folder.jpg, cover.jpg, poster.jpg, banner.jpg)`

## Self-review findings

- Assertion uses `displayPath(path.join(dir, 'folder.jpg'))` per the pre-flight ruling, so it matches `displayPath` behaviour (no `\\?\` prefix) instead of the plan's raw-prefix assertion.
- Kept one responsibility per function; the new helper is scanner-local and exported nothing new.
- No change to `mergeScanResults` cover handling — it never touches `cover`, which the test now guards.
- The `if (!game.cover)` guard is technically always true at scan time (new object starts with `cover: null`); it is kept because the plan/spec specifies it and it documents the "only when unset" contract.
- Test output is diagnostic by nature (it scans `D:\Games` first, which is pre-existing behaviour of the script); the test section itself is quiet and prints a single summary line.

## Concerns

1. **Auto-detected covers may not render in the UI yet.** `ipc.js` `coverUrl()` builds `cover://local/<basename>` and `main.js` resolves that inside `library.coverDir` (`%APPDATA%\GameHub\covers`). Task 1 stores the cover as the absolute path in the game folder, so the protocol handler will 404 and the card/detail `<img>` will be broken. Task 2's `cover:rescan` copies the file into `coverDir` before setting `game.cover`, so the scan path (Task 1) is inconsistent with it. The plan/spec explicitly says Task 1 should set `game.cover` to the folder path, so I did not change `ipc.js` (out of my file scope). Task 2 or Task 5 should copy auto-detected covers into `coverDir` (or `coverUrl`/protocol must be extended) for the feature to be visible end-to-end. Task 5's manual verification step ("Scan a game folder with a folder.jpg → cover should auto-appear") will fail without that follow-up.
2. Priority candidates are checked with `exists()`, so a *directory* literally named `folder.jpg` would be selected. Pathological, left as the spec's `exists()`-based logic.

## Fix round 1 (review findings #1–#3)

### What I fixed

**Critical #1 — `game:remove` no longer deletes the game's own image** (`src/main/ipc.js`)

- New local helper `isManagedCover(cover)` (next to `coverUrl`) checks
  `path.resolve(cover).toLowerCase().startsWith(path.resolve(library.coverDir).toLowerCase() + path.sep)`.
- `game:remove` now only calls `fs.unlinkSync` when `isManagedCover(game.cover)` is true.
- `deleteOldCover` reuses the same helper; semantics are the same as before plus a `path.sep` guard, so a sibling directory such as `...\coversX\file.jpg` can no longer match `...\covers`.

**Important #2 — auto-detected cover copied into `coverDir`** (`src/main/scanner.js`)

- New exported helper `copyCoverToStore(store, source, gameId)`:
  - validates the extension (`COVER_FALLBACK_EXT`),
  - `fs.mkdirSync(store.coverDir, { recursive: true })`,
  - copies to `${gameId}-${Date.now()}${ext}` (same naming pattern as `cover:pick`),
  - returns the target path, or `null` on any failure (try/catch + `console.error`).
- `mergeScanResults()`: in the new-game branch it copies `detected.cover` *before* pushing and replaces it with the copied path. If the copy fails, the game is still added with the original path — a copy failure cannot block adding a game.
- Same copy is also done in `ipc.js` `addFromDetection()` (used by `game:addFromFolder`), which stores `detectGame()` output directly and would otherwise still keep a game-folder cover path. This is the same defect on a second entry point, slightly beyond the literal finding location.

**Important #3 — re-scan backfills existing games** (`src/main/scanner.js`)

- In the existing-game branch: `if (!existing.cover && detected.cover)` → copy into `coverDir`, set `existing.cover`, and `changed = true` (so `summary.updated` increases).
- Manual covers stay untouched: the guard requires `!existing.cover`, and test #4 still protects the manual-cover case.

### Tests and results

- `node scripts/test-scan.js` → `Borító-tesztek: 6/6 sikeres`, exit code 0. The pre-existing `D:\Games` scan output is unchanged (2 games).
- Two new tests in `scripts/test-scan.js`:
  - #5 new game: saved cover is inside the temp `coverDir`, content equals the source image, the source image in the game folder is left in place.
  - #6 existing game with `cover: null`: after merge `summary.updated === 1`, cover file is inside `coverDir` with the right content.
- RED evidence: stashed only `src/main/scanner.js` + `src/main/ipc.js` (tests kept), ran the script → assertion failure for test #5 (`actual: false`, "a borítónak a covers mappába kell kerülnie"). Restored with `git stash pop`, green again.
- Extra integration check with the real `LibraryStore` in temp dirs (throwaway script, deleted afterwards): first merge `{ added: 1 }`, cover inside `coverDir`, file exists and is persisted in `library.json`; second scan `{ unchanged: 1 }` with the same cover path (no duplicate copies).
- `node --check` passes on `src/main/ipc.js`, `src/main/scanner.js`, `scripts/test-scan.js`.

### Files changed

- `src/main/ipc.js`
- `src/main/scanner.js`
- `scripts/test-scan.js`

Commit: `7594a69 fix: automatikus borítók a covers mappába kerülnek, törlés csak coverDir-ból`

### Self-review findings

- `game:remove` cannot be unit-tested with the current harness (`ipc.js` requires Electron). Verified by inspection; the containment logic is shared with the already-reviewed `deleteOldCover` via `isManagedCover`.
- Hardened the containment check with `path.sep` (old prefix check would have treated `...\covers2\x.jpg` as inside `...\covers`). Behaviour for real covers is identical.
- Copy-target name collision is practically impossible (game id + milliseconds). If it ever happens for the same id in the same ms, `copyFileSync` overwrites with the same valid image — harmless.
- `copyCoverToStore` converts the source back with `toExtended` before copying, so game folders with trailing dot/space still copy correctly. (Display of such covers via `coverUrl` remains Minor #6, out of scope.)
- Export list change (`copyCoverToStore`) is the only new public scanner API; no other module was restructured.

### Concerns

1. Games saved by the interim `c4e6d8f` build already have a **non-null** cover pointing into the game folder. Finding #3 prescribes the `!existing.cover` guard, so those entries are not migrated by a re-scan and keep a broken thumbnail until the user picks a cover or uses Task 2's `cover:rescan`. A one-time migration (`existing.cover && !isManagedCoverPath(existing.cover)`) could handle it, but it was deliberately left out to stay within the finding and to avoid ever touching a manually stored cover elsewhere.
2. The `addFromDetection` change goes slightly beyond the literal finding text (same defect, second entry point). It can be dropped if the reviewer considers it out of scope.
3. Naming across features is not unified: this fix uses `${id}-${Date.now()}${ext}`, Task 2's `cover:rescan` plan uses `${id}-rescan-${Date.now()}${ext}`. Both are valid inside `coverDir`.
