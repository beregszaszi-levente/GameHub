'use strict';

/**
 * A Steam import IPC réteg integrációs tesztje.
 *
 * Az `electron` modult minimálisan mockolja (ipcMain.handle), így a regisztrált
 * handlereket közvetlenül lehet hívni. Valódi fájlrendszeren dolgozik,
 * ideiglenes mappákkal; a Steam telepítést nem olvassa és nem módosítja.
 *
 *   node scripts/test-steam-import-ipc.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const { LibraryStore, slugId } = require('../src/main/library');

const handlers = new Map();

/** Betölti az ipc.js-t úgy, hogy az `electron` modul helyett mockot kapjon. */
function loadIpcWithMockedElectron() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          handle(channel, handler) {
            handlers.set(channel, handler);
          }
        },
        dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
        shell: { openPath: async () => '' }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require('../src/main/ipc');
  } finally {
    Module._load = originalLoad;
  }
}

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  OK ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function vdfQuote(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function manifest({ appid, name, installdir }) {
  return `"AppState"
{
	"appid"		"${appid}"
	"name"		"${name}"
	"installdir"		"${installdir}"
}
`;
}

function libraryFoldersVdf(roots) {
  const entries = roots
    .map((root, index) => `\t"${index}" { "path" "${vdfQuote(root)}" }`)
    .join('\n');
  return `"libraryfolders"
{
${entries}
}
`;
}

function newLibrary(dataDir) {
  const library = new LibraryStore(dataDir);
  library.load();
  library.setSettings({ autoScanOnStart: false });
  return library;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-steam-ipc-'));
  const dataDir = path.join(tmp, 'data');
  const steamRoot = path.join(tmp, 'Steam');
  const steamapps = path.join(steamRoot, 'steamapps');
  const secondRoot = path.join(tmp, 'SteamLibrary');
  const secondApps = path.join(secondRoot, 'steamapps');

  let ipc = null;

  try {
    writeFile(
      path.join(steamapps, 'appmanifest_123.acf'),
      manifest({ appid: '123', name: 'Alpha Game', installdir: 'AlphaGame' })
    );
    writeFile(
      path.join(steamapps, 'appmanifest_456.acf'),
      manifest({ appid: '456', name: 'Beta Game', installdir: 'BetaGame' })
    );
    writeFile(
      path.join(steamapps, 'appmanifest_789.acf'),
      manifest({ appid: '789', name: 'Gamma Game', installdir: 'GammaGame' })
    );
    writeFile(path.join(steamapps, 'libraryfolders.vdf'), libraryFoldersVdf([steamRoot, secondRoot]));

    // Ugyanaz az appid a második könyvtárban: az első találat nyer.
    writeFile(
      path.join(secondApps, 'appmanifest_123.acf'),
      manifest({ appid: '123', name: 'Alpha Duplicate', installdir: 'AlphaDuplicate' })
    );
    writeFile(
      path.join(secondApps, 'appmanifest_999.acf'),
      manifest({ appid: '999', name: 'Delta Game', installdir: 'DeltaGame' })
    );

    const library = newLibrary(dataDir);
    const { registerIpc } = loadIpcWithMockedElectron();
    ipc = registerIpc({ library, getWindow: () => null });

    const importRoot = handlers.get('steam:importRoot');
    const steamImport = handlers.get('steam:import');
    const addGames = handlers.get('steam:addGames');

    await test('steam:importRoot elmenti a steamapps útvonalat', async () => {
      assert.ok(importRoot, 'steam:importRoot handler regisztrálva');
      const result = await importRoot({}, steamapps);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.path, steamapps);

      const reloaded = newLibrary(dataDir);
      assert.strictEqual(reloaded.settings.steamImportPath, steamapps);
    });

    await test('steam:importRoot könyvtárgyökérből is megtalálja a steamapps mappát', async () => {
      const result = await importRoot({}, steamRoot);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.path, steamapps);
    });

    await test('steam:importRoot elutasítja a nem steamapps mappát', async () => {
      const result = await importRoot({}, path.join(tmp, 'nincs-ilyen'));
      assert.strictEqual(result.ok, false);
      assert.ok(result.message);
    });

    await test('steam:import minden könyvtárat beolvas és appid szerint dedupál', async () => {
      assert.ok(steamImport, 'steam:import handler regisztrálva');
      const result = await steamImport({});
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.steamRoot, steamRoot);
      assert.deepStrictEqual(
        result.games.map((game) => game.appid),
        ['123', '456', '999', '789']
      );
      assert.deepStrictEqual(
        result.games.map((game) => game.name),
        ['Alpha Game', 'Beta Game', 'Delta Game', 'Gamma Game']
      );
      assert.strictEqual(
        result.games.find((game) => game.appid === '999').folder,
        path.join(secondRoot, 'steamapps', 'common', 'DeltaGame')
      );
    });

    await test('steam:addGames steam-import forrással veszi fel a kijelölteket', async () => {
      assert.ok(addGames, 'steam:addGames handler regisztrálva');
      const games = await steamImport({});
      const selected = games.games.filter((game) => ['123', '999'].includes(game.appid));

      const result = await addGames({}, selected);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.added, 2);
      assert.strictEqual(result.skipped, 0);

      const alpha = library.games.find((game) => game.folder === selected[0].folder);
      assert.ok(alpha);
      assert.strictEqual(alpha.title, 'Alpha Game');
      assert.strictEqual(alpha.source, 'steam-import');
      assert.strictEqual(alpha.launch.path, '');
      assert.strictEqual(alpha.launch.cwd, alpha.folder);
      assert.strictEqual(alpha.cover, null);
      assert.strictEqual(alpha.coverMode, null);

      // A forrás a mentés után is megmarad.
      const reloaded = newLibrary(dataDir);
      assert.strictEqual(reloaded.getGame(alpha.id).source, 'steam-import');
    });

    await test('steam:addGames kihagyja a már létező és a duplikált tételeket', async () => {
      const games = await steamImport({});
      const alpha = games.games.find((game) => game.appid === '123');
      const beta = games.games.find((game) => game.appid === '456');

      const result = await addGames({}, [alpha, alpha, beta]);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.skipped, 2);
      assert.strictEqual(library.games.length, 3);
    });

    await test('steam:addGames kihagyja a \\\\?\\ előtaggal mentett meglévő mappát', async () => {
      // Regresszió: a scanner `\\?\` előtaggal menti a mappát, a Steam import
      // viszont sima útvonalat ad. A két alakot össze kell vetni, különben a
      // LibraryStore.addGame azonos id-n felülírná a meglévő játékot.
      const games = await steamImport({});
      const gamma = games.games.find((game) => game.appid === '789');
      assert.ok(gamma, 'Gamma Game megtalálható');

      const extended = `\\\\?\\${gamma.folder}`;
      const existing = library.addGame({
        title: 'Saját cím',
        folder: extended,
        launch: {
          kind: 'exe',
          path: 'D:\\Games\\gamma.exe',
          args: [],
          cwd: extended,
          elevated: false
        },
        processNames: ['gamma.exe'],
        cover: 'D:\\covers\\gamma.png',
        coverMode: 'manual',
        favorite: true,
        playtimeSec: 120,
        lastPlayed: null,
        addedAt: Date.now(),
        source: 'auto',
        titleLocked: true,
        launchLocked: true
      });
      assert.ok(existing, 'a meglévő játék létrejött');
      // Ugyanaz az id, amit a sima útvonalú Steam import kapna -> ezért kell a szűrés.
      assert.strictEqual(existing.id, slugId(gamma.folder));

      const countBefore = library.games.length;
      const result = await addGames({}, [gamma]);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(library.games.length, countBefore);

      const after = library.getGame(existing.id);
      assert.strictEqual(after.folder, extended);
      assert.strictEqual(after.title, 'Saját cím');
      assert.strictEqual(after.source, 'auto');
      assert.strictEqual(after.launch.path, 'D:\\Games\\gamma.exe');
      assert.strictEqual(after.cover, 'D:\\covers\\gamma.png');
      assert.strictEqual(after.coverMode, 'manual');
      assert.strictEqual(after.favorite, true);
      assert.deepStrictEqual(after.processNames, ['gamma.exe']);
    });

    await test('steam:addGames érvénytelen elemeket kihagy', async () => {
      const result = await addGames({}, [{ name: '', folder: '' }, { name: 'Nincs mappa' }, null]);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 3);
    });
  } finally {
    if (ipc) ipc.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Steam-import IPC tesztek: ${passed}/${total} sikeres`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
