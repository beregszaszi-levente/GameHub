'use strict';

/**
 * Konzolos önteszt: végigfut a beállított könyvtárakon, és kiírja,
 * mit talált volna az app. Nem ír semmit, nem kell hozzá Electron.
 *
 *   npm run test:scan
 *   npm run test:scan -- "D:\\Games" "E:\\MasikMappa"
 */

const { scanRoots } = require('../src/main/scanner');
const { displayPath } = require('../src/main/paths');

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
  console.log('');
}

if (errors.length) {
  console.log('Hibák:');
  for (const err of errors) console.log(`  ! ${err.root}: ${err.message}`);
}

console.log(`Összesen: ${games.length} játék, ${elapsed} ms`);
