# Task 3 report — Steam import modul (`steam-import.js`)

**Branch:** `feat/cover-steam-import`
**Base:** `4b032a7`
**Commit:** `1640144` — `feat: Steam-könyvtár import modul (libraryfolders.vdf, appmanifest parsing)`

## What I implemented

### `src/main/steam-import.js` (new)

- **`parseVdf(text)`** — minimal, dependency-free Valve KeyValues parser.
  - Tokenizer handles quoted strings with `\\`, `\"`, `\n`, `\t` escapes, unquoted tokens, `{` / `}` and `//` line comments; strips a leading UTF-8 BOM.
  - Recursive-descent parser builds arbitrarily nested objects.
  - Structurally invalid input throws `Error('Érvénytelen VDF: …')`: unterminated string/block, stray `}`, key without value, `{` where a key is expected.
  - Tolerates `"key" { ... }` on one line and tab/space/newline separation, as real Valve files use both layouts.
- **`findSteamLibraryFolders(steamRoot = STEAM_DEFAULT)`**
  - Reads `<steamRoot>/libraryfolders.vdf`, returns `string[] | null`.
  - Handles the modern nested format (`"0" { "path" "D:\\SteamLibrary" }`) **and** the legacy flat format (`"1" "D:\\SteamLibrary"`), skipping legacy metadata keys (`TimeNextStatsReport`, `ContentStatsID`).
  - Returns **library roots** (not `steamapps` subpaths), matching the brief and Task 4's `path.join(folder, 'steamapps', 'common', installDir)`.
  - Normalizes path separators (`/` → `\`), strips trailing separators (except drive roots like `C:\`), case-insensitively de-duplicates.
  - Missing/unreadable file, parse error, missing `libraryfolders` key, or zero libraries → `null`.
- **`scanSteamApps(libraryFolder)`**
  - Reads `<libraryFolder>/steamapps`, processes only `appmanifest_<digits>.acf` (case-insensitive).
  - Returns `{ appid, name, installDir }[]`; `appid` falls back to the filename number if the ACF field is missing.
  - A malformed ACF (parse error, or missing `AppState`/`name`/`installdir`) is skipped individually and does not abort the scan.
  - Missing/unreadable/empty `steamapps` → `[]`.
  - Results sorted by name (case-insensitive, `hu` locale) so the UI order does not depend on `readdir` order.
- Exports `{ parseVdf, findSteamLibraryFolders, scanSteamApps, STEAM_DEFAULT }`. `STEAM_DEFAULT = 'C:\\Program Files (x86)\\Steam'` matches Task 4's planned import.
- Filesystem reads use `toExtended()` from `./paths` to honor the project's Windows `\\?\` extended-path constraint; returned paths are plain (display) paths.

### `scripts/test-steam-import.js` (new)

17 assertions with mock temp directories (`os.tmpdir()`), cleaned up in `finally`, no real Steam install touched:
- `parseVdf`: flat pairs, nested blocks, escaped backslashes, BOM/comments/one-line blocks, 4 malformed cases.
- `findSteamLibraryFolders`: multiple libraries, path normalization + case-insensitive dedupe, legacy flat format, missing file → null, malformed VDF → null, empty folder list → null.
- `scanSteamApps`: two manifests sorted by name, non-`appmanifest_*.acf` files ignored, malformed ACF skipped while valid one survives, missing `installdir` skipped, appid fallback from filename, empty folder → `[]`, missing folder → `[]`, empty argument → `[]`.
- `STEAM_DEFAULT` value.

## Deviations from the plan's sample code (deliberate)

The plan's illustrative snippets are internally inconsistent and do not match real Valve files, so I implemented the brief's contract instead:

1. Plan's sample `parseVdf` only recognizes `"key" {` when the brace is on the same trimmed line, and never nests `"0" { "path" … }` correctly. Mine is a real nested parser.
2. Plan's sample `findSteamLibraryFolders` expects each libraryfolder entry to be a string, while its own test fixture uses `"0" { "path" … }`. Mine reads `path` from nested entries (and still supports the legacy string form).
3. Plan's sample test asserts `folders[0]` equals the `steamapps` subfolder; the brief and Task 4 require library **roots**. Mine returns roots.
4. Plan's sample `scanSteamApps` accepts a manifest with an empty `installdir` (returns `''`). Mine skips it, because Task 4 builds the game folder from `installDir`; an empty value would produce a bogus `…\common\` entry.

## Tests and results

```
node scripts/test-steam-import.js
...
Steam-import tesztek: 17/17 sikeres
EXITCODE=0
```

Regression check of the existing suite (unchanged by this task):

```
node scripts/test-scan.js
...
Borító-tesztek: 13/13 sikeres
SCAN_EXIT=0
```

Additionally ran an ad-hoc (not committed) realistic fixture with a full `libraryfolders.vdf` containing `contentid`/`apps` nesting and an ACF with `UserConfig`/`MountedConfig` blocks — both functions returned the expected values.

Syntax: `node --check src/main/steam-import.js` and `node --check scripts/test-steam-import.js` → exit 0.

## TDD Evidence

### RED

Command (before `src/main/steam-import.js` existed):

```
node scripts/test-steam-import.js
```

Output:

```
Error: Cannot find module '../src/main/steam-import'
Require stack:
- C:\Users\bereg\Documents\gamehub-cover-steam-import\scripts\test-steam-import.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    ...
  code: 'MODULE_NOT_FOUND',
EXITCODE=1
```

Why expected: the test requires the module under test, which had not been created yet — the interface does not exist, so the suite cannot even load. This is the correct RED for a new module.

### GREEN

Command (after implementation):

```
node scripts/test-steam-import.js
```

Output:

```
  ✓ parseVdf: egyszerű kulcs-érték párok
  ✓ parseVdf: beágyazott blokkok és escape-elt backslash
  ✓ parseVdf: BOM, kommentek és egysoros blokkok
  ✓ parseVdf: hibás VDF kivételt dob
  ✓ findSteamLibraryFolders: több könyvtár beolvasása
  ✓ findSteamLibraryFolders: útvonal normalizálás és duplikáció kiszűrése
  ✓ findSteamLibraryFolders: régi (lapos) libraryfolders.vdf formátum
  ✓ findSteamLibraryFolders: hiányzó libraryfolders.vdf → null
  ✓ findSteamLibraryFolders: hibás VDF → null
  ✓ findSteamLibraryFolders: könyvtár nélküli VDF → null
  ✓ scanSteamApps: appmanifest fájlok beolvasása névsorban
  ✓ scanSteamApps: hibás ACF kihagyása, a többi beolvasása
  ✓ scanSteamApps: appid kimarad → fájlnévből pótolja
  ✓ scanSteamApps: üres steamapps → []
  ✓ scanSteamApps: hiányzó steamapps mappa → []
  ✓ scanSteamApps: üres könyvtárparaméter → []
  ✓ STEAM_DEFAULT a szokásos Steam telepítési út

Steam-import tesztek: 17/17 sikeres
EXITCODE=0
```

## Files changed

- `src/main/steam-import.js` — new, 285 lines.
- `scripts/test-steam-import.js` — new, 280 lines.

No other files modified; `.superpowers/` and `docs/` remain untracked as before.

## Self-review findings

- Confirmed the exported names/shape against Task 4's planned import: `findSteamLibraryFolders`, `scanSteamApps`, `STEAM_DEFAULT` are all present; `scanSteamApps` returns `installDir` (camelCase) as specified.
- Every filesystem operation is wrapped in try/catch at the directory level; per-file parsing has its own try/catch, so one corrupt ACF cannot hide other games (tested).
- `findSteamLibraryFolders` treats an empty/invalid document as `null`, matching "not found" semantics and the plan's sample.
- Case-insensitive key lookup (`findEntry`) also accepts `LibraryFolders`/`appstate` variants; this is harmless for real files and makes the parser resilient to casing changes.
- Reviewed parser failure modes: unbalanced braces, dangling key, stray brace, and unterminated string all throw; all four are covered by tests. No infinite loop paths in the tokenizer (every branch advances `i`; EOF is handled).
- Verified extended-path usage does not leak `\\?\` into returned library paths (`normalizeLibraryPath` operates on plain VDF values) — important for Task 4 storing `folder` values.
- No renderer/IPC/library changes were made in this task, so no integration surface was altered prematurely.

## Issues / concerns

- **Not tested against a real Steam installation.** All coverage is fixture-based plus one realistic ad-hoc fixture. A quick manual sanity check on a machine with Steam (`findSteamLibraryFolders()` with no args) is recommended before/while implementing Task 4.
- **Parser scope is intentionally a subset:** no single-quoted strings, no binary VDF, no duplicate-key accumulation (last value wins). Sufficient for `libraryfolders.vdf` and `appmanifest_*.acf`; Steam does not use the other constructs in these files.
- **`localeCompare(…, 'hu')` sorting** depends on full ICU (Node 24/Electron ship it). If a stripped-ICU runtime were ever used, order would still be valid but locale-insensitive.
- **`findSteamLibraryFolders` does not check that returned paths exist.** A stale entry in `libraryfolders.vdf` is returned; Task 4's `scanSteamApps` then yields `[]` for it, which is acceptable and keeps this module read-only/simple.
- **`STEAM_DEFAULT` has no trailing backslash** (`C:\Program Files (x86)\Steam`), matching the plan's export; `path.join` makes the trailing form irrelevant.
