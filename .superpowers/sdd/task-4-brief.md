### Task 4: Steam import IPC handler és UI (steam:import)

**Files:**
- Modify: `src/main/ipc.js` — új IPC handler `steam:import()` és `steam:importRoot()`.
- Modify: `src/renderer/app.js` — import gomb, dialógus, kijelölt játékok hozzáadása a könyvtárhoz.
- Modify: `src/renderer/index.html` — import gomb és dialógus HTML.
- Modify: `src/renderer/styles.css` — import dialógus stílusa.
- Modify: `src/preload/preload.js` — `steamImport` és `steamImportRoot` exposed.

**Interfaces:**
- Consumes: `steam-import.js` (`findSteamLibraryFolders`, `scanSteamApps`, `STEAM_DEFAULT`), `library.addGame`, `library.updateGame`.
- Produces:
  - `steam:import()` IPC handler: visszaadja a talált Steam játékok listáját `{ ok: true, games: [...] }` vagy `{ ok: false, needsManualPath: true }` ha a Steam nem található.
  - `steam:importRoot(root)` IPC handler: elmenti a manuálisan kiválasztott steamapps útvonalat `library.settings.steamImportPath`-be.
  - Renderer UI: import dialógus, ahol a felhasználó kijelöli a kívakat, majd "Hozzáadás" gombbal felviheti a könyvtárba.

**Global constraints (from plan):**
- Csak Windows (`\\?\` extended path prefix, `CreateProcessW` indítás).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson (pl. `feat: ...`, `fix: ...`).
- A Steam import minden játékot csak javaslattul listázza, a felhasználó kijelöli, melyeket vegye fel.
- Ha a Steam nem az alapértelmezett helyen van, fájlválasztóval választható a `steamapps` mappa; sikeres útvonalat elmentjük `steamImportPath` beállításként.

**Task-specific decisions (from plan):**
- Előbb próbáljuk az elmentett `steamImportPath` beállítást, aztán az alapértelmezett Steam útvonalat (`findSteamLibraryFolders`), és csak utána a fájlválasztót.
- Több Steam könyvtár esetén az összesről összegyűjtjük a játékokat; duplikátum `appid` esetén csak az elsőt vesszük.
- Importált játék: `source: 'steam-import'`, `title` az ACF-ből, `folder` = `path.join(folder, 'steamapps', 'common', installDir)`, `launch` üres exe (felhasználó állítja be később), `cover` null, `coverMode` null.
- Import dialógus: lista checkboxokkal, "Kijelölt hozzáadása" gomb, "Mégsem".
- Ha nincs Steam detektálva: fájlválasztó (`pickDirectory`) a `steamapps` mappa kiválasztásához, majd `steam:importRoot` mentés, és újrapróbálkozás.

**Steps:**
1. Add `steam:import` IPC handler in `src/main/ipc.js`.
2. Add `steam:importRoot` IPC handler in `src/main/ipc.js`.
3. Add `steamImport` and `steamImportRoot` to preload (`src/preload/preload.js`).
4. Add import button HTML and import dialog overlay in `src/renderer/index.html`.
5. Add click handler and import dialog logic in `src/renderer/app.js`.
6. Add dialog styling in `src/renderer/styles.css`.
7. Commit: `git add ... && git commit -m "feat: Steam-könyvtár import IPC handler és UI dialógus"`
