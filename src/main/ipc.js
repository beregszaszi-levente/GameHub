'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, shell } = require('electron');

const { displayPath, exists, hasInvalidName, toExtended } = require('./paths');
const {
  scanRoots,
  mergeScanResults,
  detectGame,
  cleanTitle,
  findCoverImage,
  copyCoverToStore
} = require('./scanner');
const { slugId } = require('./library');
const { launchGame } = require('./launcher');
const { renameFolder } = require('./rename');
const { PlaytimeTracker } = require('./tracker');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const COVER_SCHEME = 'cover://local/';

/** Két mappaútvonal összehasonlítása fájlrendszeri szintre (kiszűri a \\?\ előtagot és a záró pontot/szóközt). */
function normalizeFolderForCompare(folder) {
  return displayPath(folder)
    .replace(/[. ]+$/g, '')
    .toLowerCase();
}

function registerIpc({ library, getWindow }) {
  const tracker = new PlaytimeTracker({
    library,
    onRunningChange: () => broadcast(),
    onTick: (id, playtimeSec) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('playtime:tick', { id, playtimeSec, running: true });
      }
    }
  });

  function Window() {
    return getWindow() || undefined;
  }

  function coverUrl(game) {
    if (!game.cover) return null;
    try {
      const stat = fs.statSync(game.cover);
      return `${COVER_SCHEME}${encodeURIComponent(path.basename(game.cover))}?v=${Math.round(
        stat.mtimeMs
      )}`;
    } catch {
      return null;
    }
  }

  /** Igaz, ha a borító a kezelt covers mappában van (a scan-borító a játék mappájában lehet). */
  function isManagedCover(cover) {
    if (!cover) return false;
    const dir = path.resolve(library.coverDir).toLowerCase() + path.sep;
    return path.resolve(cover).toLowerCase().startsWith(dir);
  }

  function publicState() {
    return {
      dataDir: library.dataDir,
      settings: { ...library.settings },
      games: library.games.map((game) => ({
        id: game.id,
        title: game.title,
        folder: game.folder,
        folderDisplay: displayPath(game.folder),
        launch: {
          ...game.launch,
          pathDisplay: displayPath(game.launch.path || '')
        },
        processNames: [...game.processNames],
        coverUrl: coverUrl(game),
        favorite: game.favorite,
        playtimeSec: game.playtimeSec,
        lastPlayed: game.lastPlayed,
        addedAt: game.addedAt,
        source: game.source,
        running: tracker.isRunning(game.id),
        folderMissing: !exists(game.folder),
        launcherMissing: Boolean(game.launch.path) && !exists(game.launch.path),
        needsRename: hasInvalidName(game.folder)
      }))
    };
  }

  function broadcast() {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('state:changed', publicState());
    }
  }

  function scanAndMerge() {
    const result = scanRoots(library.settings);
    const summary = mergeScanResults(library, result);
    library.saveNow();
    return summary;
  }

  function addFromDetection(detected) {
    const existing = library.games.find(
      (g) => normalizeFolderForCompare(g.folder) === normalizeFolderForCompare(detected.folder)
    );
    if (existing) return { ok: true, id: existing.id, existed: true };
    // A scan-borítót a covers mappába másoljuk, hogy a cover:// protokoll elérje.
    const copied = copyCoverToStore(library, detected.cover, detected.id);
    if (copied) {
      detected.cover = copied;
      detected.coverMode = 'auto';
    }
    library.data.games.push(detected);
    library.saveNow();
    return { ok: true, id: detected.id };
  }

  // --- állapot ------------------------------------------------------------
  ipcMain.handle('state:get', () => publicState());

  ipcMain.handle('library:scan', () => {
    const summary = scanAndMerge();
    broadcast();
    return { ok: true, ...summary };
  });

  // --- játék indítás ------------------------------------------------------
  ipcMain.handle('game:launch', async (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ez a játék már nem szerepel a listában.' };
    if (tracker.isRunning(id)) return { ok: true, alreadyRunning: true };

    const result = await launchGame(game);
    if (result.ok) {
      tracker.watch(id, game.processNames);
      library.touchLastPlayed(id);
      library.scheduleSave();
      broadcast();
    }
    return result;
  });

  // --- szerkesztés --------------------------------------------------------
  ipcMain.handle('game:update', (_event, id, patch) => {
    const updated = library.updateGame(id, patch || {});
    if (!updated) return { ok: false, message: 'Ismeretlen játék.' };
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('game:addFromFolder', async () => {
    const result = await dialog.showOpenDialog(Window(), {
      title: 'Játék mappa kiválasztása',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const folder = result.filePaths[0];
    const detected = detectGame(folder);

    if (detected) {
      const added = addFromDetection(detected);
      broadcast();
      return { ...added, detected: true };
    }

    // Nincs automatikus találat: vegyük fel üresen, a szerkesztőben beállítható.
    const id = slugId(folder);
    const now = Date.now();
    library.data.games.push({
      id,
      title: cleanTitle(path.basename(folder)) || path.basename(folder),
      folder,
      launch: { kind: 'exe', path: '', args: [], cwd: folder, elevated: false },
      processNames: [],
      cover: null,
      coverMode: null,
      favorite: false,
      playtimeSec: 0,
      lastPlayed: null,
      addedAt: now,
      source: 'manual',
      titleLocked: false,
      launchLocked: false
    });
    library.saveNow();
    broadcast();
    return { ok: true, id, needsManual: true };
  });

  ipcMain.handle('game:remove', (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };
    // Csak a kezelt covers mappában lévő borítót töröljük; a scan által
    // felismert kép a játék saját mappájában van, azt nem szabad törölni.
    if (isManagedCover(game.cover)) {
      try {
        fs.unlinkSync(game.cover);
      } catch {
        /* a borító törlése nem kritikus */
      }
    }
    library.removeGame(id);
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('game:fixFolderName', (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };

    const current = displayPath(game.folder);
    const result = renameFolder(current);
    if (!result.ok) return result;

    const replace = (value) => {
      if (!value) return value;
      const shown = displayPath(value);
      if (shown.toLowerCase().startsWith(current.toLowerCase())) {
        return result.to + shown.slice(current.length);
      }
      return shown;
    };

    game.folder = result.to;
    game.launch.path = replace(game.launch.path);
    game.launch.cwd = replace(game.launch.cwd);
    library.saveNow();
    scanAndMerge();
    broadcast();
    return { ok: true, folder: result.to, from: result.from };
  });

  ipcMain.handle('game:openFolder', async (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };
    if (exists(game.folder)) {
      const error = await shell.openPath(displayPath(game.folder));
      if (!error) return { ok: true };
      // Ha az Explorer nem boldogul a mappával, nyissuk a szülőt.
    }
    const parent = path.win32.dirname(displayPath(game.folder));
    if (exists(parent)) {
      await shell.openPath(parent);
      return { ok: true, note: 'A mappa neve miatt a szülő könyvtárat nyitottam meg.' };
    }
    return { ok: false, message: 'A mappa nem érhető el.' };
  });

  // --- borítók ------------------------------------------------------------
  function deleteOldCover(game, keep) {
    if (!game.cover || game.cover === keep) return;
    if (!isManagedCover(game.cover)) return;
    try {
      fs.unlinkSync(game.cover);
    } catch {
      /* ignore */
    }
  }

  ipcMain.handle('cover:pick', async (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };

    const result = await dialog.showOpenDialog(Window(), {
      title: 'Borítókép kiválasztása',
      properties: ['openFile'],
      filters: [{ name: 'Képek', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const source = result.filePaths[0];
    const ext = path.extname(source).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      return { ok: false, message: 'Ez a fájltípus nem használható borítóként.' };
    }

    fs.mkdirSync(library.coverDir, { recursive: true });
    const target = path.join(library.coverDir, `${game.id}-${Date.now()}${ext}`);
    try {
      fs.copyFileSync(source, target);
    } catch (err) {
      return { ok: false, message: `Nem sikerült bemásolni a képet: ${err.message}` };
    }

    deleteOldCover(game, target);
    game.cover = target;
    game.coverMode = 'manual';
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('cover:reset', (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };
    deleteOldCover(game, null);
    game.cover = null;
    game.coverMode = null;
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  // Újrakeresi a borítót a játék saját mappájában, és felülírja a korábbi
  // automatikus találatot. A megtalált képet a kezelt covers mappába másoljuk.
  // A felhasználó kézzel kiválasztott borítóját soha nem írjuk felül.
  ipcMain.handle('cover:rescan', (_event, id) => {
    const game = library.getGame(id);
    if (!game) return { ok: false, message: 'Ismeretlen játék.' };
    if (game.coverMode === 'manual') {
      return {
        ok: false,
        message: 'Kézzel kiválasztott borítót nem írhatom felül automatikus felismeréssel.'
      };
    }
    if (!exists(game.folder)) {
      return { ok: false, message: 'A játék mappája nem érhető el.' };
    }

    const found = findCoverImage(toExtended(game.folder));
    if (!found) {
      return { ok: false, message: 'Nem találtam borítóképet a játék mappájában.' };
    }

    const target = copyCoverToStore(library, displayPath(found), game.id);
    if (!target) {
      return { ok: false, message: 'Nem sikerült bemásolni a megtalált képet.' };
    }

    deleteOldCover(game, target);
    game.cover = target;
    game.coverMode = 'auto';
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  // --- beállítások --------------------------------------------------------
  ipcMain.handle('settings:update', (_event, patch) => {
    library.setSettings(patch || {});
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('settings:addRoot', async () => {
    const result = await dialog.showOpenDialog(Window(), {
      title: 'Könyvtár hozzáadása',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const root = result.filePaths[0];
    const roots = [...library.settings.libraryRoots];
    if (!roots.some((r) => r.toLowerCase() === root.toLowerCase())) {
      roots.push(root);
      library.setSettings({ libraryRoots: roots });
      library.saveNow();
    }
    const summary = scanAndMerge();
    broadcast();
    return { ok: true, root, ...summary };
  });

  ipcMain.handle('settings:removeRoot', (_event, root) => {
    const roots = library.settings.libraryRoots.filter(
      (r) => r.toLowerCase() !== String(root).toLowerCase()
    );
    if (!roots.length) {
      return { ok: false, message: 'Legalább egy könyvtárnak meg kell maradnia.' };
    }
    library.setSettings({ libraryRoots: roots });
    library.saveNow();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('dialog:pickExe', async () => {
    const result = await dialog.showOpenDialog(Window(), {
      title: 'Indító kiválasztása',
      properties: ['openFile'],
      filters: [
        { name: 'Programok', extensions: ['exe', 'bat', 'cmd'] },
        { name: 'Minden fájl', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(Window(), {
      title: 'Mappa kiválasztása',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('app:openDataFolder', async () => {
    fs.mkdirSync(library.dataDir, { recursive: true });
    const error = await shell.openPath(library.dataDir);
    return error ? { ok: false, message: error } : { ok: true };
  });

  // --- életciklus ---------------------------------------------------------
  tracker.start();

  if (library.settings.autoScanOnStart) {
    try {
      scanAndMerge();
    } catch (err) {
      console.error('[scan] hiba induláskor:', err.message);
    }
  }

  return {
    broadcast,
    tracker,
    stop() {
      tracker.stop();
    }
  };
}

module.exports = { registerIpc };
