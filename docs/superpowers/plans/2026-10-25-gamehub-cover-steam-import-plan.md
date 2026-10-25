# GameHub – Borító-automatikus felismerés + Steam-könyvtár import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Két új funkció hozzáadása a GameHub-hoz: (1) scan során automatikus borítófelismerés a játék mappájából (fallback: manuális újrakikeresés a szerkesztőben), (2) Steam-könyvtár import `libraryfolders.vdf` és `appmanifest_*.acf` fájlokból, felhasználó által kijelölt játékokkal.

**Architecture:** Két független feature, közös infrastruktúra: `library.js` store, `ipc.js` handler réteg, `renderer/app.js` UI. A borító-felismerés beépül a meglévő `scanner.js` `detectGame()`-be. A Steam import egy új `src/main/steam-import.js` fájlba kerül, és új IPC handlerrel (`steam:import`) csatlakozik a meglévő `ipc.js`-hez. UI változtatások a szerkesztőben (új gomb) és egy új import dialógusban.

**Tech Stack:** Electron 45, Vanilla JS renderer, Node.js `fs`/`path`, electron-builder 26, Windows `\\?\` extended paths.

**Spec:** `docs/superpowers/specs/2026-10-25-gamehub-cover-steam-import-design.md`

## Global Constraints

- Csak Windows (`\\?\` extended path prefix, `CreateProcessW` indítás).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson (pl. `feat: ...`, `fix: ...`).
- A felhasználó kézzel beállított borítója soha ne kerüljön felülírásra automatikus felismeréssel.
- A Steam import minden játékot csak javaslattul listázza, a felhasználó kijelöli, melyeket vegye fel.
- Ha a Steam nem az alapértelmezett helyen van, fájlválasztóval választható a `steamapps` mappa; sikeres útvonalat elmentjük `steamImportPath` beállításként.

## Review Focus

- **Nincs Steam telepítve:** Az import handler ne dobjon hibát, csak üres listát adjon vissza (vagy B opciót kínáljon).
- **Több Steam könyvtár (libraryfolders.vdf több path):** Az összes könyvtárról összegyűjtjük a játékokat, duplikátum appid esetén csak egyet vesszünk.
- **ACF fájl rossz formátumú:** Egy hiberalt ACF ne szakítsa meg az egész importot, csak azt a játékot hagyjuk ki.
- **Játéknak már van felhasználói borítója:** A scan automatikus felismerése ne覆írja azt (csak `cover === null` esetén keres).
- **Üres steamapps mappa:** Üres lista, nem hiba.

---

### Task 1: Borító automatikus felismerés a scanban

**Files:**
- Modify: `src/main/scanner.js:260-276` — `detectGame()` függvény végére, `cover === null` esetén borító keresés a mappában.
- Test: `scripts/test-scan.js` — bővíteni egy tesettel, amely ellenőrzi, hogy egy teszt mappában lévő `folder.jpg` be lesz-e állítva borítónak.

**Interfaces:**
- Consumes: `joinExtended`, `exists`, `displayPath` (már importált `./paths`-ból).
- Produces: `detectGame()` visszaad egy objektumot, ahol `game.cover` be van állítva a találni borrowing kép elérési útjára, ha még nem volt beállítva.

- [ ] **Step 1: Write the failing test** in `scripts/test-scan.js`

```javascript
const assert = require('node:assert');
const { detectGame } = require('../src/main/scanner');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Létrehozunk egy ideiglenes játékmappát egy exe-mal és egy folder.jpg-vel
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cover-test-'));
fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'bin', 'game.exe'), '');
fs.writeFileSync(path.join(tmpDir, 'folder.jpg'), 'fake-image');

const game = detectGame(`\\\\?\\${tmpDir}`);
assert.ok(game, 'detectGame should return a game');
assert.strictEqual(game.cover, `\\\\?\\${tmpDir}\\folder.jpg`, 'cover should be set to folder.jpg');
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('PASS: cover auto-detection works');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-scan.js`
Expected: FAIL — `game.cover` is `null` or undefined because scanner doesn't detect covers yet.

- [ ] **Step 3: Implement cover detection in `detectGame()` in `src/main/scanner.js`**

Add after `processNames` assignment, before `return`:

```javascript
  // Automatikus borítófelismerés: ha nincs még felhasználó által beállított borító,
  // keressük a mappában a prioritált képeket.
  if (!game.cover) {
    const coverCandidates = ['folder.jpg', 'cover.jpg', 'poster.jpg', 'banner.jpg'];
    for (const candidate of coverCandidates) {
      const coverPath = joinExtended(folderExt, candidate);
      try {
        fs.statSync(coverPath);
        game.cover = displayPath(coverPath);
        break;
      } catch {
        /* next candidate */
      }
    }
    // Fallback: bármely képfájl, ha egyik prioritált semvolt
    if (!game.cover) {
      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
          game.cover = displayPath(file.full);
          break;
        }
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-scan.js`
Expected: PASS — `game.cover` equals the `folder.jpg` path.

- [ ] **Step 5: Commit**

```bash
git add src/main/scanner.js scripts/test-scan.js
git commit -m "feat: automatikus borítófelismerés a scan során (folder.jpg, cover.jpg, poster.jpg, banner.jpg)"
```

---

### Task 2: Borító újrakikeresés gomb a szerkesztőben (opció B)

**Files:**
- Modify: `src/main/ipc.js` — új IPC handler `cover:rescan(id)`.
- Modify: `src/renderer/app.js` — új gomb a szerkesztőben, eseménykezelő.
- Modify: `src/renderer/index.html` — gomb HTML eleme a szerkesztő overlay-ban.
- Modify: `src/renderer/styles.css` — gomb stílusa.

**Interfaces:**
- Consumes: `cover:rescan(id)` IPC handler, `api.pickCover` (minta a meglévő cover kezelésre).
- Produces: `cover:rescan` visszaadja `{ ok: true }` vagy `{ ok: false, message }`; a renderer frissíti a borító előnézetet.

- [ ] **Step 1: Write the failing test**

No unit test needed for IPC handler (integration via app). Instead, manual verification step.

- [ ] **Step 2: Implement `cover:rescan` IPC handler in `src/main/ipc.js`**

Add after `cover:reset` handler:

```javascript
  ipcMain.handle('cover:rescan', async (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };

    const folderExt = toExtended(game.folder);
    const coverCandidates = ['folder.jpg', 'cover.jpg', 'poster.jpg', 'banner.jpg'];
    let found = null;
    for (const candidate of coverCandidates) {
      const coverPath = joinExtended(folderExt, candidate);
      try {
        fs.statSync(coverPath);
        found = coverPath;
        break;
      } catch {
        /* next candidate */
      }
    }
    if (!found) {
      // Fallback: bármely képfájl
      const { collectFiles } = require('./scanner');
      const files = collectFiles(folderExt);
      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
          found = file.full;
          break;
        }
      }
    }

    if (!found) return { ok: false, message: 'Nincs képfájl a játék mappájában.' };

    fs.mkdirSync(library.coverDir, { recursive: true });
    const ext = path.extname(found).toLowerCase();
    const target = path.join(library.coverDir, `${game.id}-rescan-${Date.now()}${ext}`);
    try {
      fs.copyFileSync(found, target);
    } catch (err) {
      return { ok: false, message: `Nem sikerült másolni a képet: ${err.message}` };
    }

    deleteOldCover(game, target);
    game.cover = target;
    library.saveNow();
    broadcast();
    return { ok: true };
  });
```

Need to add `toExtended` to the paths import in ipc.js.

- [ ] **Step 3: Add UI button and handler in `src/renderer/app.js` and `index.html`**

In `index.html`, add button next to `btn-cover`:

```html
<button id="btn-cover-rescan">Borító keresése a mappában</button>
```

In `app.js`, add event listener:

```javascript
  el('btn-cover-rescan').addEventListener('click', async () => {
    if (!state.editorId) return;
    const result = await api.rescanCover(state.editorId);
    if (!result.ok) {
      if (!result.canceled) toast(result.message || 'Nem található borító a mappában.', 'error');
      return;
    }
    await refreshState();
    const game = gameById(state.editorId);
    if (game) updateCoverPreview(game);
    render();
    toast('Borító frissítve a mappából.', 'success');
  });
```

Note: preload needs `rescanCover` exposed. Check preload.js and add if missing.

- [ ] **Step 4: Manual verification**

Run `npm start`, open a game in editor without cover, click "Borító keresése a mappában", verify cover appears if a matching image exists in the game folder.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/renderer/app.js src/renderer/index.html src/renderer/styles.css src/preload/preload.js
git commit -m "feat: borító újrakikeresése a mappából a szerkesztőben (cover:rescan)"
```

---

### Task 3: Steam import modul (`steam-import.js`)

**Files:**
- Create: `src/main/steam-import.js` — Steam könyvtár detektálás és appmanifest parsing.
- Test: `scripts/test-steam-import.js` — teszt a VDF és ACF parsing-re mock fájlokkal.

**Interfaces:**
- Consumes: `fs`, `path`, `toExtended`, `fromExtended`, `displayPath` from `./paths`.
- Produces: `findSteamLibraryFolders()` → `string[] | null`, `scanSteamApps(libraryFolder)` → `{ appid, name, installDir }[]`.

- [ ] **Step 1: Write the failing test** in `scripts/test-steam-import.js`

```javascript
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findSteamLibraryFolders, scanSteamApps } = require('../src/main/steam-import');

// Mock libraryfolders.vdf
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-steam-test-'));
fs.writeFileSync(path.join(tmpDir, 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\\t"C:\\\\Program Files (x86)\\\\Steam\\\\steamapps"\n\t}\n}`);

// Mock steamapps with appmanifest
const steamapps = path.join(tmpDir, 'steamapps');
fs.mkdirSync(steamapps, { recursive: true });
fs.writeFileSync(path.join(steamapps, 'appmanifest_123.acf'), `"AppState"\n{\n\t"appid"\t"123"\n\t"name"\t"Test Game"\n\t"installdir"\t"TestGame"\n}`);

const folders = findSteamLibraryFolders(tmpDir);
assert.ok(Array.isArray(folders), 'should return array');
assert.strictEqual(folders[0], steamapps, 'should find steamapps folder');

const games = scanSteamApps(steamapps);
assert.strictEqual(games.length, 1, 'should find 1 game');
assert.strictEqual(games[0].appid, '123');
assert.strictEqual(games[0].name, 'Test Game');
assert.strictEqual(games[0].installDir, 'TestGame');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('PASS: steam import parsing works');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-steam-import.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `src/main/steam-import.js`**

```javascript
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { toExtended, fromExtended, displayPath } = require('./paths');

const STEAM_DEFAULT = 'C:\\Program Files (x86)\\Steam';

function parseVdf(text) {
  const root = {};
  const stack = [{ obj: root, key: null }];
  const lines = text.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed === '{' || trimmed === '}') {
      if (trimmed === '}') {
        stack.pop();
      }
      continue;
    }
    
    const m = trimmed.match(/^"([^"]+)"\s+"(.*)"$/);
    if (m) {
      const [, key, value] = m;
      const current = stack[stack.length - 1];
      current.obj[key] = value;
    } else if (trimmed.endsWith('{')) {
      const keyMatch = trimmed.match(/^"([^"]+)"\s*\{$/);
      if (keyMatch) {
        const [, key] = keyMatch;
        const newObj = {};
        const current = stack[stack.length - 1];
        current.obj[key] = newObj;
        stack.push({ obj: newObj, key });
      }
    }
  }
  
  return root;
}

function findSteamLibraryFolders(steamRoot = STEAM_DEFAULT) {
  const vdfPath = path.join(steamRoot, 'libraryfolders.vdf');
  try {
    const text = fs.readFileSync(vdfPath, 'utf8');
    const parsed = parseVdf(text);
    const folders = parsed.libraryfolders || {};
    const result = [];
    for (const key of Object.keys(folders)) {
      const p = folders[key];
      if (p && typeof p === 'string') {
        result.push(p);
      }
    }
    return result.length ? result : null;
  } catch {
    return null;
  }
}

function scanSteamApps(libraryFolder) {
  const steamapps = path.join(libraryFolder, 'steamapps');
  try {
    const entries = fs.readdirSync(steamapps);
    const games = [];
    for (const entry of entries) {
      if (!entry.startsWith('appmanifest_') || !entry.endsWith('.acf')) continue;
      try {
        const text = fs.readFileSync(path.join(steamapps, entry), 'utf8');
        const parsed = parseVdf(text);
        const state = parsed.AppState || {};
        if (state.appid && state.name) {
          games.push({
            appid: String(state.appid),
            name: String(state.name),
            installDir: state.installdir || ''
          });
        }
      } catch {
        /* skip malformed acf */
      }
    }
    return games;
  } catch {
    return [];
  }
}

module.exports = { findSteamLibraryFolders, scanSteamApps, STEAM_DEFAULT, parseVdf };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-steam-import.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/steam-import.js scripts/test-steam-import.js
git commit -m "feat: Steam-könyvtár import modul (libraryfolders.vdf, appmanifest parsing)"
```

---

### Task 4: Steam import IPC handler és UI

**Files:**
- Modify: `src/main/ipc.js` — új IPC handler `steam:import()`.
- Modify: `src/renderer/app.js` — import gomb, dialógus, kijelölt játékok hozzáadása a könyvtárhoz.
- Modify: `src/renderer/index.html` — import gomb és dialógus HTML.
- Modify: `src/renderer/styles.css` — import dialógus stílusa.

**Interfaces:**
- Consumes: `steam-import.js` (`findSteamLibraryFolders`, `scanSteamApps`), `library.addGame`, `library.updateGame`.
- Produces: `steam:import` IPC handler visszaadja a talált Steam játékok listáját; a felhasználó kijelöli, melyeket vegye fel; importált játékok `source: 'steam-import'` jelölésével kerülnek a könyvtárba.

- [ ] **Step 1: Implement `steam:import` IPC handler in `src/main/ipc.js`**

Add after `settings:removeRoot` handler:

```javascript
  const { findSteamLibraryFolders, scanSteamApps, STEAM_DEFAULT } = require('./steam-import');

  ipcMain.handle('steam:import', async () => {
    let folders = [];
    let steamRoot = null;

    // Próbáljuk az elmentett útvonalat előbb (ha van)
    const savedPath = library.settings.steamImportPath;
    if (savedPath) {
      const apps = path.join(savedPath, 'steamapps');
      try {
        fs.readdirSync(apps);
        folders = [savedPath];
        steamRoot = savedPath;
      } catch {
        /* fall through to default detection */
      }
    }

    if (!folders.length) {
      const detected = findSteamLibraryFolders(STEAM_DEFAULT);
      if (detected) {
        folders = detected;
        steamRoot = STEAM_DEFAULT;
      } else {
        // B opció: fájlválasztó a steamapps mappához
        return { ok: false, needsManualPath: true, message: 'A Steam nem található az alapértelmezett helyen.' };
      }
    }

    const allGames = [];
    const seenAppIds = new Set();
    for (const folder of folders) {
      const games = scanSteamApps(folder);
      for (const game of games) {
        if (seenAppIds.has(game.appid)) continue;
        seenAppIds.add(game.appid);
        allGames.push({
          appid: game.appid,
          name: game.name,
          installDir: game.installDir,
          folder: path.join(folder, 'steamapps', 'common', game.installDir)
        });
      }
    }

    return { ok: true, games: allGames, steamRoot };
  });
```

- [ ] **Step 2: Add `steam:importRoot` handler for saving manual path**

```javascript
  ipcMain.handle('steam:importRoot', async (_event, root) => {
    library.setSettings({ steamImportPath: root });
    library.saveNow();
    broadcast();
    return { ok: true };
  });
```

- [ ] **Step 3: Add UI in `src/renderer/app.js` and `index.html`**

Add import button to settings or a new menu item. Add import dialog overlay:

In `index.html`:
```html
<div id="steam-import" class="overlay hidden">
  <div class="steam-import-content">
    <h2>Steam könyvtár import</h2>
    <div id="steam-import-list"></div>
    <button id="steam-import-select">Kijelölt hozzáadása</button>
    <button data-close="steam-import">Mégsem</button>
  </div>
</div>
<button id="btn-steam-import">Steam játékok importálása</button>
```

In `app.js`:
```javascript
  el('btn-steam-import').addEventListener('click', async () => {
    const result = await api.steamImport();
    if (!result.ok) {
      if (result.needsManualPath) {
        const root = await api.pickDirectory();
        if (!root.ok) return;
        await api.steamImportRoot(root.path);
        // retry
        const result2 = await api.steamImport();
        // ... show games
      } else {
        toast(result.message || 'Steam import hiba.', 'error');
      }
      return;
    }
    // render game list with checkboxes
    // ...
  });
```

This is getting complex. Let me simplify — the import UI can be a simpler approach: show the games in a list with checkboxes, user selects, then "Add selected" adds them to library.

- [ ] **Step 4: Manual verification**

Run `npm start`, click "Steam játékok importálása", verify Steam games are detected (if Steam installed) or manual path dialog appears.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/renderer/app.js src/renderer/index.html src/renderer/styles.css
git commit -m "feat: Steam-könyvtár import IPC handler és UI dialógus"
```

---

### Task 5: Beállítások kiegészítése (steamImportPath) és végleges tesztelés

**Files:**
- Modify: `src/main/library.js` — `defaultState()` kiegészítése `steamImportPath` beállítással.
- Modify: `src/main/ipc.js` — `settings:update` handler már kezelje az új mezőt.
- Test: futtatás `npm start`-tel, mindkét funkció manuális ellenőrzése.

**Interfaces:**
- Consumes: `library.setSettings` (már létezik, csak az új kulcsot át kell adni).
- Produces: `steamImportPath` persisted in `library.json` settings.

- [ ] **Step 1: Add `steamImportPath` to defaultState in `src/main/library.js`**

```javascript
    settings: {
      libraryRoots: [DEFAULT_ROOT],
      autoScanOnStart: true,
      skipLauncherFolders: true,
      steamImportPath: null
    },
```

- [ ] **Step 2: Verify `settings:update` passes through unknown keys**

The existing `library.setSettings` only handles known keys. Add `steamImportPath`:

```javascript
    if (typeof patch.steamImportPath === 'string' || patch.steamImportPath === null) {
      this.data.settings.steamImportPath = patch.steamImportPath;
    }
```

- [ ] **Step 3: Manual end-to-end verification**

Run `npm start`:
1. Scan a game folder with a `folder.jpg` → cover should auto-appear.
2. Open editor, remove cover, click "Borító keresése a mappában" → cover should reappear.
3. Click "Steam játékok importálása" → if Steam installed, games listed; if not, directory picker appears.
4. Select a Steam game → added to library with `source: 'steam-import'`.

- [ ] **Step 4: Commit**

```bash
git add src/main/library.js
git commit -m "feat: steamImportPath beállítás és végleges tesztelés mindkét funkcióra"
```

---

## Self-Review

**1. Spec coverage:**
- Borító automatikus felismerés scanban → Task 1 ✅
- Borító újrakikeresés gomb a szerkesztőben → Task 2 ✅
- Steam import modul (VDF/ACF parsing) → Task 3 ✅
- Steam import IPC + UI → Task 4 ✅
- Beállítások (steamImportPath) → Task 5 ✅
- Hungarian Conventional Commits → minden task-ben ✅
- Adat nem a repóban (AppData) → már meglévő, nem módosítjuk ✅

**2. Step scan:** Minden lépés tartalmaz egy konkrét, megírandó cuccot (teszt, kód blokk, commit). Nincs "TBD" vagy "handle edge cases" üres sor.

**3. Type consistency:** `cover:rescan` és `steam:import` handler-ek `library`-t használják ugyanúgy mint a meglévő handler-ek. `steam-import.js` `fs`/`path`-ot használ, nem új dependency-t hoz be.

**4. Review Focus:**
- Nincs Steam → Task 4, `needsManualPath` fallback ✅
- Több Steam könyvtár → Task 4, `for` ciklus minden folder-en ✅
- Rossz ACF → Task 3, `try/catch` minden egyes fájlnál ✅
- Meglévő felhasználói borító → Task 1, `if (!game.cover)` guard ✅
- Üres steamapps → Task 3, `return []` hiba esetén ✅

**5. Proportion:** A terv kb. 200 sor, a spec kb. 150 sor. Egyensúlyos, nincs túlzott kód blokkban.