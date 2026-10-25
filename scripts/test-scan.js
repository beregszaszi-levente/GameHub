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

const { scanRoots, detectGame, mergeScanResults } = require('../src/main/scanner');
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

console.log(`Borító-tesztek: ${checks}/${checks} sikeres`);
