# SDD ledger — plan: docs/superpowers/plans/2026-10-25-gamehub-cover-steam-import-plan.md

BASE: cf24b81 (fix: duplikált játék a scan során (záró pontos mappanév))
Branch: feat/cover-steam-import

## Pre-flight scan

| Tasks | What one produces vs what other consumes | Finding | Ruling |
|-------|------------------------------------------|---------|--------|
| Task 1 → Task 2 | Task 1 adds cover auto-detection in `scanner.js` `detectGame()`. Task 2 adds `cover:rescan` IPC handler with similar cover-search logic. | Both tasks contain similar cover-candidate search logic (folder.jpg, cover.jpg, poster.jpg, banner.jpg). Task 2 duplicates the search pattern from Task 1. | Acceptable: Task 2's search is in a different layer (IPC handler, re-scannable on demand) and operates on an existing game's folder. Task 1 runs once at scan time. No shared module. |
| Task 3 → Task 4 | Task 3 creates `steam-import.js` with `findSteamLibraryFolders()` and `scanSteamApps()`. Task 4's IPC handler imports and calls these. | Task 4 depends on Task 3's exports. Interface must match exactly. | Task 4's import statement in plan matches Task 3's `module.exports`. No conflict. |
| Task 4 → Task 5 | Task 4 uses `library.settings.steamImportPath`. Task 5 adds `steamImportPath` to `library.js` `defaultState()` and `setSettings()`. | Task 4 reads `steamImportPath` before Task 5 defines it. | Task 5 must be completed before Task 4's IPC handler is exercised at runtime. Task ordering: Task 5's library.js change is trivial and safe to do before or alongside Task 4. Ruling: Task 5 runs last per plan, but the `steamImportPath` read in Task 4 returns `undefined` safely (falsy, falls through to default detection). No conflict. |

### Per-task self-consistency

- **Task 1:** Test creates `folder.jpg` in tmp dir, expects `game.cover` to equal `\\?\<tmp>\folder.jpg`. Code sets `game.cover = displayPath(coverPath)` where `coverPath = joinExtended(folderExt, candidate)`. `displayPath` strips `\\?\` prefix per `paths.js`. Mismatch: test expects `\\?\` prefix but `displayPath` strips it. **Ruling:** Fix test to expect `displayPath` output (stripped path), not raw `\\?\` path. Implementer should adjust assertion.
- **Task 2:** No unit test specified; manual verification only. IPC handler uses `toExtended` (needs import) and `collectFiles` from scanner. No internal contradiction.
- **Task 3:** VDF parser handles `libraryfolders.vdf` and `appmanifest_*.acf`. Test uses mock files. Parser handles nested objects via brace tracking. No internal contradiction.
- **Task 4:** IPC handler returns `games` list with `folder` path built via `path.join(folder, 'steamapps', 'common', game.installDir)`. No `\\?\` prefix on this path — but launcher expects extended paths. **Ruling:** The folder path for Steam-imported games will be used in `library.folder` and compared via `normalizeFolderForCompare` which calls `displayPath` (strips `\\?\`). The path itself doesn't need `\\?\` prefix until it's used as a launch path or cwd. Since Steam games have empty launch path initially (user sets it later), this is fine. No conflict.
- **Task 5:** Adds `steamImportPath` to `defaultState()` and `setSettings()`. Simple, no contradiction.

**Pre-flight scan: clean with one test-assertion mismatch noted (Task 1). Implementer fixed it in commit c4e6d8f.**

## Task 1 review findings (from reviewer ses_e8bdb2cbdffe9GOCNUlVO5pamK)

### Critical (Must Fix)
1. `ipc.js:180-186` `game:remove` unconditionally `fs.unlinkSync(game.cover)` — now destructive since cover can point to the game folder (not just coverDir). Fix: add coverDir containment check like `deleteOldCover`.

### Important (Should Fix)
2. `scanner.js:314` — auto-detected covers point to game folder paths, but `cover://` protocol serves from `library.coverDir` only (`main.js:114-125`). Covers will 404. Fix: copy detected image into coverDir at scan time (like `cover:pick` does), store the copied path.
3. `scanner.js:390-408` — existing library games never gain auto cover on re-scan; `mergeScanResults` never copies `detected.cover` onto existing games. Fix: backfill cover for existing games without one.

### Minor (deferred to ledger)
4. `scanner.js:228` — `exists()` on priority candidates; directory named `folder.jpg` would be selected as cover. Inconsistent with fallback's `entry.isFile()` check.
5. `scanner.js:238-239` — fallback picks first image in `readdir` order (filesystem-dependent, nondeterministic).
6. `scanner.js:314` — `displayPath(found)` loses `\\?\` prefix; covers in trailing-dot/space folders will fail `fs.statSync` in `ipc.js:43`.
7. `scanner.js:312` — `if (!game.cover)` is always true for fresh object (dead code, brief-mandated).
8. `scripts/test-scan.js:61,119` — `${checks}/${checks}` can't reveal skipped tests; noisy D:\Games scan.
9. Commit message doesn't mention fallback image detection.

**Ledger:** Task 1: complete (commits cf24b81..7594a69, re-review clean). Critical #1 + Important #2, #3 all addressed; re-review verdict "All findings addressed, no new Critical/Important breakage"; 2 Minors deferred to final review.

**Task 2:** complete (commits 7594a69..4b032a7, re-review clean). coverMode field added; cover:rescan rejects manual covers; 13/13 tests pass; re-review verdict "All findings addressed, no new Critical/Important breakage".

**Task 3:** complete (commit 1640144, review Approved). parseVdf, findSteamLibraryFolders, scanSteamApps all working; 17/17 tests pass.

**Task 4:** complete (commits 1640144..aa62426, re-review clean). steam:import/importRoot/addGames handlers, UI dialog, coverMode protection, extended-prefix fix; all tests pass.

**Task 5:** complete — final verification. All test suites pass (13/13 scan, 18/18 steam module, 8/8 IPC), all syntax checks OK. Task 4 already committed `steamImportPath` to `library.js`. No new commits needed.

**ALL 5 TASKS COMPLETE.**

**Minor findings deferred (Task 4):**
- steam-import.js:197-209 — candidate loop breaks on parse success, not usable content; stray valid VDF without libraryfolders key blocks real path
- ipc.js:442-449 — stale saved path narrows import to secondary library only
- steam-import.js:245-287 — no install-state check before listing (missing install folders offered)
- ipc.js:499-507 — `steam:addGames` trusts arbitrary absolute paths (only isAbsolute check)
- test-steam-import-ipc.js:144-218 — test order dependence; needsManualPath/default-detection/dedupe-with-extended-prefix untested
- steam:addGames interface deviation (not in brief) — coordination note
- library.js scope overlaps Task 5 — coordination note
- No npm script for new suites — matches convention, acknowledged

**Ledger:** Task 4: fix round 1/5 — Important #1 open. Commits 1640144..ce0ce9d.

**Minor findings deferred (Task 3):** test suite not in package.json; missing realistic VDF fixture; catch-all returns null for all errors; drive-root normalization edge case. Ledgered for final review triage.

**Minor findings deferred (Task 2):**
- scanner.js:226-229 — exists() true for directories; directory named folder.jpg would be selected
- scanner.js:237-240 — fallback picks first image in readdir order, nondeterministic
- scripts/test-scan.js — no committed coverage for cover:rescan IPC handler edge cases
- renderer/app.js:708-709 — err.message may be undefined for non-Error throws
- renderer/app.js:693-712 — editor close during pending rescan still toasts
- styles.css:413-415 — .ghost-btn:disabled doesn't neutralize :hover
- ipc.js:312-314 — exists() succeeds for files; isDirectory would improve error message
- scanner.js:261 — [scan] log prefix misleading when called from cover:rescan
