### Task 1: Borító automatikus felismerés a scanban

**Files:**
- Modify: `src/main/scanner.js:260-276` — `detectGame()` függvény végére, `cover === null` esetén borító keresés a mappában.
- Test: `scripts/test-scan.js` — bővíteni egy tesettel, amely ellenőrzi, hogy egy teszt mappában lévő `folder.jpg` be lesz-e állítva borítónak.

**Interfaces:**
- Consumes: `joinExtended`, `exists`, `displayPath` (már importált `./paths`-ból).
- Produces: `detectGame()` visszaad egy objektumot, ahol `game.cover` be van állítva a találni borrowing kép elérési útjára, ha még nem volt beállítva.

**Global constraints (from plan):**
- Csak Windows (`\\?\` extended path prefix, `CreateProcessW` indítás).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson (pl. `feat: ...`, `fix: ...`).
- A felhasználó kézzel beállított borítója soha ne kerüljön felülírásra automatikus felismeréssel.

**Pre-flight ruling on Task 1 test:**
The test asserts `game.cover === '\\\\?\\' + tmpDir + '\\folder.jpg'`, but `displayPath()` strips the `\\?\` prefix. Fix the test assertion to expect the stripped path: `displayPath(path.join(tmpDir, 'folder.jpg'))` or compute the expected value the same way `detectGame` does.

**Steps:**
1. Write the failing test in `scripts/test-scan.js` (with the corrected assertion per the pre-flight ruling).
2. Run `node scripts/test-scan.js` — verify it FAILS (cover is null).
3. Implement cover detection in `detectGame()` in `src/main/scanner.js` — add the cover-candidate search block after `processNames` assignment, before `return`.
4. Run `node scripts/test-scan.js` — verify it PASSES.
5. Commit: `git add src/main/scanner.js scripts/test-scan.js && git commit -m "feat: automatikus borítófelismerés a scan során (folder.jpg, cover.jpg, poster.jpg, banner.jpg)"`
