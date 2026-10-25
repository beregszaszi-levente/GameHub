### Task 2: Borító újrakikeresés gomb a szerkesztőben (opció B)

**Files:**
- Modify: `src/main/ipc.js` — új IPC handler `cover:rescan(id)`.
- Modify: `src/renderer/app.js` — új gomb a szerkesztőben, eseménykezelő.
- Modify: `src/renderer/index.html` — gomb HTML eleme a szerkesztő overlay-ban.
- Modify: `src/renderer/styles.css` — gomb stílusa.
- Modify: `src/preload/preload.js` — expose `rescanCover` to renderer (check if already there).

**Interfaces:**
- Consumes: `cover:rescan(id)` IPC handler; `copyCoverToStore(store, source, gameId)` from `scanner.js` (already exported by Task 1).
- Produces: `cover:rescan` IPC handler returns `{ ok: true }` or `{ ok: false, message }`; renderer refreshes cover preview.

**Global constraints (from plan):**
- Csak Windows (`\\?\` extended path prefix, `CreateProcessW` indítás).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson (pl. `feat: ...`, `fix: ...`).
- A felhasználó kézzel beállított borítója soha ne kerüljön felülírásra automatikus felismeréssel.

**Task-specific decisions (from plan):**
- `cover:rescan(id)` runs the same cover-search logic as `findCoverImage()` in `scanner.js` against the specific game's folder, and if found, copies it into `library.coverDir` (using `copyCoverToStore`) and sets `game.cover` to the copied path — overwriting any previous auto-set cover.
- A "Borító keresése a mappában" button goes in the editor panel next to "Borító kiválasztása".
- Hungarian UI copy: button label "Borító keresése a mappában".

**Steps:**
1. Add `cover:rescan` IPC handler in `src/main/ipc.js` (after `cover:reset`).
2. Add `rescanCover` to preload bridge if not already exposed (`src/preload/preload.js`).
3. Add button HTML in `src/renderer/index.html` editor overlay.
4. Add click handler in `src/renderer/app.js` — call `api.rescanCover(state.editorId)`, refresh state, update cover preview, show toast.
5. Add button styling in `src/renderer/styles.css`.
6. Commit: `git add ... && git commit -m "feat: borító újrakikeresése a mappából a szerkesztőben (cover:rescan)"`
