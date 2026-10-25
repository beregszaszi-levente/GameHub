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
  const existing = { ...detected, cover: manualCover };
  const store = { games: [existing], data: { games: [] }, scheduleSave() {} };
  mergeScanResults(store, { games: [detected], errors: [] });
  assert.strictEqual(existing.cover, manualCover, 'a kézi borító nem íródhat felül');
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

console.log(`Borító-tesztek: ${checks}/${checks} sikeres`);
