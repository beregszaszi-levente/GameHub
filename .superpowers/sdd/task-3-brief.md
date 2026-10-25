### Task 3: Steam import modul (`steam-import.js`)

**Files:**
- Create: `src/main/steam-import.js` — Steam könyvtár detektálás és appmanifest parsing.
- Create: `scripts/test-steam-import.js` — teszt a VDF és ACF parsing-re mock fájlokkal.

**Interfaces:**
- Consumes: `fs`, `path` from Node built-ins.
- Produces:
  - `findSteamLibraryFolders(steamRoot?)` → `string[] | null` — reads `libraryfolders.vdf` from `steamRoot` (default `C:\Program Files (x86)\Steam\`), returns array of Steam library paths, or `null` if not found/unreadable.
  - `scanSteamApps(libraryFolder)` → `{ appid: string, name: string, installDir: string }[]` — reads `steamapps` subfolder of `libraryFolder`, parses all `appmanifest_*.acf` files, returns game list with appid, name, installdir.
  - `parseVdf(text)` → `object` — minimal VDF parser (Key-Value format used by Valve).

**Global constraints (from plan):**
- Csak Windows (`\\?\` extended path prefix).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson (pl. `feat: ...`, `fix: ...`).

**Task-specific decisions (from plan):**
- VDF parser handles nested braces by tracking brace depth; extracts `"key" "value"` pairs.
- `libraryfolders.vdf` format: `"libraryfolders" { "0" { "path" "..." } "1" { "path" "..." } }`.
- `appmanifest_*.acf` format: `"AppState" { "appid" "123" "name" "Test Game" "installdir" "TestGame" }`.
- Malformed ACF files are skipped individually (try/catch per file), not aborting the whole scan.
- Empty steamapps returns `[]`, not null.
- Missing libraryfolders.vdf returns `null`.

**Steps:**
1. Write failing test in `scripts/test-steam-import.js` with mock `libraryfolders.vdf` and `appmanifest_*.acf` files in temp dirs.
2. Run `node scripts/test-steam-import.js` — verify FAILS (module doesn't exist).
3. Implement `src/main/steam-import.js` with `parseVdf`, `findSteamLibraryFolders`, `scanSteamApps`.
4. Run `node scripts/test-steam-import.js` — verify PASSES.
5. Commit: `git add src/main/steam-import.js scripts/test-steam-import.js && git commit -m "feat: Steam-könyvtár import modul (libraryfolders.vdf, appmanifest parsing)"`
