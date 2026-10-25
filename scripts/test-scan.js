'use strict';

/**
 * Konzolos önteszt: végigfut a beállított könyvtárakon, és kiírja,
 * mit talált volna az app. Nem ír semmit, nem kell hozzá Electron.
 *
 * A végén a borító-automatikus-felismerés (scanner.detectGame) tesztjei futnak.
 *
 *   npm run test:scan
 *   npm run test:scan -- "D:\\Games" "E:\\MasikMappa"
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scanRoots,
  detectGame,
  mergeScanResults,
  findCoverImage,
  copyCoverToStore
} = require('../src/main/scanner');
const { toExtended, displayPath } = require('../src/main/paths');

const roots = process.argv.slice(2).filter(Boolean);
const settings = {
  libraryRoots: roots.length ? roots : ['D:\\Games'],
  skipLauncherFolders: true
};

console.log('Könyvtárak:', settings.libraryRoots.join(', '));
console.log('');

const started = Date.now();
const { games, errors } = scanRoots(settings);
const elapsed = Date.now() - started;

if (!games.length) {
  console.log('Nem találtam indítható játékot.');
}

for (const game of games) {
  console.log(`▶ ${game.title}`);
  console.log(`  mappa   : ${displayPath(game.folder)}`);
  console.log(`  indító  : [${game.launch.kind}] ${displayPath(game.launch.path)}`);
  console.log(`  cwd     : ${displayPath(game.launch.cwd)}`);
  console.log(`  folyamat: ${game.processNames.join(', ') || '-'}`);
  console.log(`  admin   : ${game.launch.elevated ? 'igen' : 'nem'}`);
  console.log(`  borító  : ${game.cover ? displayPath(game.cover) : '-'}`);
  console.log('');
}

if (errors.length) {
  console.log('Hibák:');
  for (const err of errors) console.log(`  ! ${err.root}: ${err.message}`);
}

console.log(`Összesen: ${games.length} játék, ${elapsed} ms`);
console.log('');

/* ------------------------------------------------------------------ *
 * Borító automatikus felismerés tesztjei
 * ------------------------------------------------------------------ */

let checks = 0;

/** Ideiglenes játékmappa egy exe-mal és a megadott képfájlokkal. */
function withTempGame(images, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cover-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'game.exe'), '');
    for (const image of images) fs.writeFileSync(path.join(dir, image), 'fake-image');
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Ideiglenes covers mappa a merge-tesztekhez (a valódi %APPDATA% helyett). */
function withTempCoverDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-covers-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 1. A prioritált lista élén a folder.jpg áll, akkor is, ha más kép is van.
withTempGame(['cover.jpg', 'folder.jpg'], (dir) => {
  const game = detectGame(toExtended(dir));
  assert.ok(game, 'detectGame nem adott vissza játékot');
  assert.strictEqual(
    game.cover,
    displayPath(path.join(dir, 'folder.jpg')),
    'folder.jpg-nek kell borítónak lennie'
  );
  checks++;
});

// 2. Ha nincs prioritált nevű kép, bármely képfájl jó fallbackként.
withTempGame(['screenshot.png'], (dir) => {
  const game = detectGame(toExtended(dir));
  assert.ok(game, 'detectGame nem adott vissza játékot');
  assert.strictEqual(
    game.cover,
    displayPath(path.join(dir, 'screenshot.png')),
    'a fallback képnek kell borítónak lennie'
  );
  checks++;
});

// 3. Kép nélkül nem lesz borító.
withTempGame([], (dir) => {
  const game = detectGame(toExtended(dir));
  assert.ok(game, 'detectGame nem adott vissza játékot');
  assert.strictEqual(game.cover, null, 'kép nélkül a borító null');
  checks++;
});

// 4. A scan nem írhatja felül a felhasználó által beállított borítót.
withTempGame(['folder.jpg'], (dir) => {
  const detected = detectGame(toExtended(dir));
  const manualCover = path.join(dir, 'manual.jpg');
  const existing = { ...detected, cover: manualCover, coverMode: 'manual' };
  const store = { games: [existing], data: { games: [] }, scheduleSave() {} };
  mergeScanResults(store, { games: [detected], errors: [] });
  assert.strictEqual(existing.cover, manualCover, 'a kézi borító nem íródhat felül');
  assert.strictEqual(existing.coverMode, 'manual', 'a kézi borító jelölése maradjon manual');
  checks++;
});

// 5. Új játéknál a borító a covers mappába kerül (a cover:// protokoll miatt).
withTempGame(['folder.jpg'], (dir) => {
  const detected = detectGame(toExtended(dir));
  withTempCoverDir((coverDir) => {
    const store = { games: [], data: { games: [] }, coverDir, scheduleSave() {} };
    mergeScanResults(store, { games: [detected], errors: [] });
    const saved = store.data.games[0];
    assert.ok(saved, 'a játéknak be kell kerülnie a könyvtárba');
    assert.ok(
      displayPath(saved.cover || '')
        .toLowerCase()
        .startsWith(coverDir.toLowerCase()),
      'a borítónak a covers mappába kell kerülnie'
    );
    assert.strictEqual(
      fs.readFileSync(saved.cover, 'utf8'),
      'fake-image',
      'a másolat tartalma egyezzen'
    );
    assert.strictEqual(saved.coverMode, 'auto', 'az automatikus borító jelölése auto');
    assert.ok(fs.existsSync(path.join(dir, 'folder.jpg')), 'a forrásképet meg kell hagyni');
  });
  checks++;
});

// 6. Re-scan: a meglévő, borító nélküli játék is megkapja a felismert borítót.
withTempGame(['folder.jpg'], (dir) => {
  const detected = detectGame(toExtended(dir));
  withTempCoverDir((coverDir) => {
    const existing = { ...detected, cover: null };
    const store = { games: [existing], data: { games: [existing] }, coverDir, scheduleSave() {} };
    const summary = mergeScanResults(store, { games: [detected], errors: [] });
    assert.strictEqual(summary.updated, 1, 'a borító pótlása frissítésnek számít');
    assert.ok(
      displayPath(existing.cover || '')
        .toLowerCase()
        .startsWith(coverDir.toLowerCase()),
      'a meglévő játék borítóját is a covers mappába kell másolni'
    );
    assert.strictEqual(fs.readFileSync(existing.cover, 'utf8'), 'fake-image');
    assert.strictEqual(existing.coverMode, 'auto', 'a pótolt borító jelölése auto');
  });
  checks++;
});

// 7. A cover:rescan alapja: findCoverImage az adott játék mappájában keres,
//    prioritás szerint, és a talált kép a covers mappába másolható.
withTempGame(['banner.jpg', 'folder.jpg'], (dir) => {
  const found = findCoverImage(toExtended(dir));
  assert.ok(found, 'findCoverImage nem talált képet');
  assert.strictEqual(
    displayPath(found),
    displayPath(path.join(dir, 'folder.jpg')),
    'a prioritási sorrend élén a folder.jpg áll'
  );

  withTempCoverDir((coverDir) => {
    const copied = copyCoverToStore({ coverDir }, displayPath(found), 'rescan-game');
    assert.ok(copied, 'copyCoverToStore nem adott vissza útvonalat');
    assert.ok(
      displayPath(copied).toLowerCase().startsWith(coverDir.toLowerCase()),
      'az új borítónak a covers mappába kell kerülnie'
    );
    assert.strictEqual(fs.readFileSync(copied, 'utf8'), 'fake-image');
    assert.ok(fs.existsSync(path.join(dir, 'folder.jpg')), 'a forrásképet meg kell hagyni');
  });
  checks++;
});

// 8. Kép nélküli (vagy nem létező) mappában a rescan nem talál borítót.
withTempGame([], (dir) => {
  assert.strictEqual(findCoverImage(toExtended(dir)), null, 'kép nélkül nincs találat');
  const missing = path.join(dir, 'nincs-ilyen-mappa');
  assert.strictEqual(findCoverImage(toExtended(missing)), null, 'nem létező mappára sincs találat');
  checks++;
});

/* ------------------------------------------------------------------ *
 * coverMode és cover:rescan védelem tesztjei
 * ------------------------------------------------------------------ */

const { LibraryStore, normalizeGame } = require('../src/main/library');

// 9. normalizeGame: a coverMode csak manual/auto lehet, egyébként null.
assert.strictEqual(normalizeGame({ folder: 'C:\\Games\\A' }).coverMode, null);
assert.strictEqual(normalizeGame({ folder: 'C:\\Games\\A', coverMode: 'manual' }).coverMode, 'manual');
assert.strictEqual(normalizeGame({ folder: 'C:\\Games\\A', coverMode: 'auto' }).coverMode, 'auto');
assert.strictEqual(normalizeGame({ folder: 'C:\\Games\\A', coverMode: 'bogus' }).coverMode, null);
checks++;

// 10. A coverMode átmegy az updateGame-en, és túléli a library.json körbeírást.
const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-lib-test-'));
try {
  const store = new LibraryStore(libDir);
  const added = store.addGame({ folder: 'C:\\Games\\CoverModeTest', coverMode: 'manual' });
  assert.ok(added, 'a játék hozzáadása sikerült');
  assert.strictEqual(store.getGame(added.id).coverMode, 'manual');

  store.updateGame(added.id, { coverMode: 'auto' });
  assert.strictEqual(store.getGame(added.id).coverMode, 'auto');
  store.saveNow();

  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.strictEqual(raw.games[0].coverMode, 'auto', 'a coverMode-nak a fájlban kell lennie');

  const reloaded = new LibraryStore(libDir);
  reloaded.load();
  assert.strictEqual(reloaded.getGame(added.id).coverMode, 'auto', 'betöltés után is megmarad');
} finally {
  fs.rmSync(libDir, { recursive: true, force: true });
}
checks++;

/* ------------------------------------------------------------------ *
 * cover:rescan / cover:pick / cover:reset IPC tesztek
 * (az electron modult minimális stubbal helyettesítjük)
 * ------------------------------------------------------------------ */

const Module = require('node:module');
const handlers = new Map();
let dialogResult = null;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      dialog: { showOpenDialog: async () => dialogResult },
      shell: { openPath: async () => '' }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let ipcModule;
try {
  ipcModule = require('../src/main/ipc');
} finally {
  Module._load = originalLoad;
}

function makeFakeLibrary(coverDir, games) {
  return {
    dataDir: path.dirname(coverDir),
    coverDir,
    games,
    data: { games },
    settings: { libraryRoots: [], autoScanOnStart: false },
    getGame(id) {
      return games.find((g) => g.id === id) || null;
    },
    saveNow() {},
    scheduleSave() {},
    setSettings() {},
    touchLastPlayed() {},
    addPlaytime() {}
  };
}

async function withIpc(coverDir, games, fn) {
  const library = makeFakeLibrary(coverDir, games);
  const runtime = ipcModule.registerIpc({ library, getWindow: () => null });
  try {
    return await fn(library);
  } finally {
    runtime.stop();
  }
}

function invoke(channel, ...args) {
  const handler = handlers.get(channel);
  assert.ok(handler, `${channel} nincs regisztrálva`);
  return handler(null, ...args);
}

function makeGame(id, folder, cover, coverMode) {
  return {
    id,
    title: id,
    folder,
    launch: {
      kind: 'exe',
      path: path.join(folder, 'bin', 'game.exe'),
      args: [],
      cwd: folder,
      elevated: false
    },
    processNames: ['game.exe'],
    cover,
    coverMode,
    favorite: false,
    playtimeSec: 0,
    lastPlayed: null,
    addedAt: Date.now(),
    source: 'manual'
  };
}

async function withTempGameAsync(images, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cover-ipc-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'game.exe'), '');
    for (const image of images) fs.writeFileSync(path.join(dir, image), 'fake-image');
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempCoverDirAsync(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-covers-ipc-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  try {
    // 11. Kézzel kiválasztott borítót a cover:rescan nem ír felül.
    await withTempGameAsync(['folder.jpg'], async (gameDir) => {
      await withTempCoverDirAsync(async (coverDir) => {
        const manualCover = path.join(coverDir, 'manual-old.jpg');
        fs.writeFileSync(manualCover, 'manual-image');
        const games = [makeGame('manual-game', gameDir, manualCover, 'manual')];
        await withIpc(coverDir, games, async () => {
          const result = await invoke('cover:rescan', 'manual-game');
          assert.strictEqual(result.ok, false, 'kézi borítónál a rescan nem sikerülhet');
          assert.strictEqual(
            result.message,
            'Kézzel kiválasztott borítót nem írhatom felül automatikus felismeréssel.'
          );
          assert.strictEqual(games[0].cover, manualCover, 'a kézi borító útvonala ne változzon');
          assert.strictEqual(games[0].coverMode, 'manual', 'a jelölés maradjon manual');
          assert.ok(fs.existsSync(manualCover), 'a kézi borító fájlja maradjon meg');
        });
      });
    });
    checks++;

    // 12. Automatikus borítót a cover:rescan felülír, és auto-ra állítja a jelölést.
    await withTempGameAsync(['folder.jpg'], async (gameDir) => {
      await withTempCoverDirAsync(async (coverDir) => {
        const oldAuto = path.join(coverDir, 'auto-old.jpg');
        fs.writeFileSync(oldAuto, 'old-auto');
        const games = [makeGame('auto-game', gameDir, oldAuto, 'auto')];
        await withIpc(coverDir, games, async () => {
          const result = await invoke('cover:rescan', 'auto-game');
          assert.strictEqual(result.ok, true, 'automatikus borítónál a rescan sikerüljön');
          assert.notStrictEqual(games[0].cover, oldAuto, 'a régi borítót le kell cserélni');
          assert.ok(
            displayPath(games[0].cover).toLowerCase().startsWith(coverDir.toLowerCase()),
            'az új borító a covers mappába kerüljön'
          );
          assert.strictEqual(games[0].coverMode, 'auto', 'az új jelölés auto');
          assert.strictEqual(fs.readFileSync(games[0].cover, 'utf8'), 'fake-image');
          assert.ok(!fs.existsSync(oldAuto), 'a régi kezelt borítót törölni kell');
          assert.ok(
            fs.existsSync(path.join(gameDir, 'folder.jpg')),
            'a forrásképet meg kell hagyni'
          );
        });
      });
    });
    checks++;

    // 13. cover:pick manual-ra, cover:reset null-ra állítja a coverMode-ot.
    await withTempGameAsync(['folder.jpg'], async (gameDir) => {
      await withTempCoverDirAsync(async (coverDir) => {
        const games = [makeGame('pick-game', gameDir, null, null)];
        await withIpc(coverDir, games, async () => {
          dialogResult = { canceled: false, filePaths: [path.join(gameDir, 'folder.jpg')] };

          const picked = await invoke('cover:pick', 'pick-game');
          assert.strictEqual(picked.ok, true, 'a kézi borító kiválasztása sikerüljön');
          assert.strictEqual(games[0].coverMode, 'manual', 'a kézi választás manual jelölést kap');
          assert.ok(games[0].cover, 'a borító beállítódik');

          const reset = await invoke('cover:reset', 'pick-game');
          assert.strictEqual(reset.ok, true);
          assert.strictEqual(games[0].cover, null, 'reset után nincs borító');
          assert.strictEqual(games[0].coverMode, null, 'reset után nincs coverMode');
        });
      });
    });
    checks++;

    console.log(`Borító-tesztek: ${checks}/${checks} sikeres`);
  } catch (err) {
    console.error('Borító-teszt hiba:', err.message);
    process.exitCode = 1;
  }
})();
