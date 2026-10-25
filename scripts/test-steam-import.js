'use strict';

/**
 * A Steam import modul öntesztje: VDF/ACF parser és libraryfolders felismerés.
 * Mock könyvtárakkal dolgozik, a valódi Steam telepítést nem olvassa.
 *
 *   node scripts/test-steam-import.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseVdf,
  findSteamLibraryFolders,
  scanSteamApps,
  STEAM_DEFAULT
} = require('../src/main/steam-import');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

/** Ideiglenes gyökér a mock Steam könyvtárhoz. */
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-steam-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/** VDF-en belüli string escape (backslash és idézőjel). */
function vdfQuote(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Egy tipikus appmanifest_*.acf tartalma. */
function manifest({ appid, name, installdir }) {
  return `"AppState"
{
	"appid"		"${appid}"
	"name"		"${name}"
	"installdir"		"${installdir}"
}
`;
}

/* ------------------------------------------------------------------ *
 * parseVdf
 * ------------------------------------------------------------------ */

test('parseVdf: egyszerű kulcs-érték párok', () => {
  const parsed = parseVdf(`"AppState"
{
	"appid"		"123"
	"name"		"Test Game"
	"installdir"		"TestGame"
}`);
  assert.deepStrictEqual(parsed, {
    AppState: { appid: '123', name: 'Test Game', installdir: 'TestGame' }
  });
});

test('parseVdf: beágyazott blokkok és escape-elt backslash', () => {
  const parsed = parseVdf(String.raw`"libraryfolders"
{
	"0" { "path" "D:\\SteamLibrary" }
	"1" { "path" "E:\\Games\\Steam" }
}`);
  assert.deepStrictEqual(parsed, {
    libraryfolders: {
      0: { path: 'D:\\SteamLibrary' },
      1: { path: 'E:\\Games\\Steam' }
    }
  });
});

test('parseVdf: BOM, kommentek és egysoros blokkok', () => {
  const parsed = parseVdf(
    '\uFEFF// fejléc komment\n"root" { "a" "1" // sor végi komment\n"url" "http://pelda.hu" }'
  );
  assert.deepStrictEqual(parsed, {
    root: { a: '1', url: 'http://pelda.hu' }
  });
});

test('parseVdf: hibás VDF kivételt dob', () => {
  assert.throws(() => parseVdf('"AppState" { "appid" "1"'), /VDF/);
  assert.throws(() => parseVdf('"AppState" }'), /VDF/);
  assert.throws(() => parseVdf('"AppState" { "appid" }'), /VDF/);
  assert.throws(() => parseVdf('"AppState" { "name" "nyitott'), /VDF/);
});

/* ------------------------------------------------------------------ *
 * findSteamLibraryFolders
 * ------------------------------------------------------------------ */

test('findSteamLibraryFolders: több könyvtár beolvasása', () => {
  withTempDir((dir) => {
    const libA = path.join(dir, 'SteamLibrary');
    const libB = path.join(dir, 'Masik Library');
    writeFile(
      path.join(dir, 'libraryfolders.vdf'),
      `"libraryfolders"
{
	"0"
	{
		"path"		"${vdfQuote(libA)}"
		"label"		""
	}
	"1"
	{
		"path"		"${vdfQuote(libB)}"
	}
}`
    );
    assert.deepStrictEqual(findSteamLibraryFolders(dir), [libA, libB]);
  });
});

test('findSteamLibraryFolders: útvonal normalizálás és duplikáció kiszűrése', () => {
  withTempDir((dir) => {
    writeFile(
      path.join(dir, 'libraryfolders.vdf'),
      String.raw`"libraryfolders"
{
	"0" { "path" "D:\\SteamLibrary\\" }
	"1" { "path" "d:\\steamlibrary" }
	"2" { "path" "E:/Steam/Games" }
}`
    );
    assert.deepStrictEqual(findSteamLibraryFolders(dir), [
      'D:\\SteamLibrary',
      'E:\\Steam\\Games'
    ]);
  });
});

test('findSteamLibraryFolders: régi (lapos) libraryfolders.vdf formátum', () => {
  withTempDir((dir) => {
    writeFile(
      path.join(dir, 'libraryfolders.vdf'),
      String.raw`"LibraryFolders"
{
	"TimeNextStatsReport"	"1620259922"
	"ContentStatsID"		"1234567890"
	"1"		"D:\\SteamLibrary"
}`
    );
    assert.deepStrictEqual(findSteamLibraryFolders(dir), ['D:\\SteamLibrary']);
  });
});

test('findSteamLibraryFolders: a steamapps mappában lévő VDF (valódi Steam elrendezés)', () => {
  withTempDir((dir) => {
    const lib = path.join(dir, 'SteamLibrary');
    writeFile(
      path.join(dir, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"
{
	"0" { "path" "${vdfQuote(lib)}" }
}`
    );
    assert.deepStrictEqual(findSteamLibraryFolders(dir), [lib]);
  });
});

test('findSteamLibraryFolders: hiányzó libraryfolders.vdf → null', () => {
  withTempDir((dir) => {
    assert.strictEqual(findSteamLibraryFolders(dir), null);
  });
});

test('findSteamLibraryFolders: hibás VDF → null', () => {
  withTempDir((dir) => {
    writeFile(path.join(dir, 'libraryfolders.vdf'), '"libraryfolders" { "0"');
    assert.strictEqual(findSteamLibraryFolders(dir), null);
  });
});

test('findSteamLibraryFolders: könyvtár nélküli VDF → null', () => {
  withTempDir((dir) => {
    writeFile(path.join(dir, 'libraryfolders.vdf'), '"libraryfolders" { }');
    assert.strictEqual(findSteamLibraryFolders(dir), null);
  });
});

/* ------------------------------------------------------------------ *
 * scanSteamApps
 * ------------------------------------------------------------------ */

test('scanSteamApps: appmanifest fájlok beolvasása névsorban', () => {
  withTempDir((dir) => {
    const steamapps = path.join(dir, 'steamapps');
    writeFile(
      path.join(steamapps, 'appmanifest_456.acf'),
      manifest({ appid: '456', name: 'Beta Game', installdir: 'BetaGame' })
    );
    writeFile(
      path.join(steamapps, 'appmanifest_123.acf'),
      manifest({ appid: '123', name: 'Alpha Game', installdir: 'AlphaGame' })
    );
    writeFile(path.join(steamapps, 'libraryfolders.vdf'), '"libraryfolders" { }');
    writeFile(path.join(steamapps, 'appmanifest_789.txt'), 'nem acf');

    assert.deepStrictEqual(scanSteamApps(dir), [
      { appid: '123', name: 'Alpha Game', installDir: 'AlphaGame' },
      { appid: '456', name: 'Beta Game', installDir: 'BetaGame' }
    ]);
  });
});

test('scanSteamApps: hibás ACF kihagyása, a többi beolvasása', () => {
  withTempDir((dir) => {
    const steamapps = path.join(dir, 'steamapps');
    writeFile(
      path.join(steamapps, 'appmanifest_111.acf'),
      manifest({ appid: '111', name: 'Jo Jatek', installdir: 'JoJatek' })
    );
    writeFile(path.join(steamapps, 'appmanifest_222.acf'), '"AppState" { "appid" "222"');
    writeFile(
      path.join(steamapps, 'appmanifest_333.acf'),
      '"AppState" { "appid" "333" "name" "Hianyos" }'
    );

    assert.deepStrictEqual(scanSteamApps(dir), [
      { appid: '111', name: 'Jo Jatek', installDir: 'JoJatek' }
    ]);
  });
});

test('scanSteamApps: appid kimarad → fájlnévből pótolja', () => {
  withTempDir((dir) => {
    const steamapps = path.join(dir, 'steamapps');
    writeFile(
      path.join(steamapps, 'appmanifest_777.acf'),
      '"AppState" { "name" "Id Nelkul" "installdir" "IdNelkul" }'
    );

    assert.deepStrictEqual(scanSteamApps(dir), [
      { appid: '777', name: 'Id Nelkul', installDir: 'IdNelkul' }
    ]);
  });
});

test('scanSteamApps: üres steamapps → []', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'steamapps'), { recursive: true });
    assert.deepStrictEqual(scanSteamApps(dir), []);
  });
});

test('scanSteamApps: hiányzó steamapps mappa → []', () => {
  withTempDir((dir) => {
    assert.deepStrictEqual(scanSteamApps(dir), []);
  });
});

test('scanSteamApps: üres könyvtárparaméter → []', () => {
  assert.deepStrictEqual(scanSteamApps(''), []);
});

/* ------------------------------------------------------------------ *
 * Egyéb
 * ------------------------------------------------------------------ */

test('STEAM_DEFAULT a szokásos Steam telepítési út', () => {
  assert.strictEqual(STEAM_DEFAULT, 'C:\\Program Files (x86)\\Steam');
});

console.log('');
console.log(`Steam-import tesztek: ${passed}/${total} sikeres`);
if (passed !== total) process.exitCode = 1;
