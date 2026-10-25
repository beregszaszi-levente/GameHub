'use strict';

/**
 * Steam könyvtár felismerés és appmanifest parsing.
 *
 * A Steam a telepített játékait `steamapps/appmanifest_<appid>.acf` fájlokban
 * tartja nyilván (Valve KeyValues, azaz VDF formátum). A könyvtárak listája a
 * Steam gyökerében lévő `libraryfolders.vdf`-ben van.
 *
 * Csak olvas: semmit nem ír a Steam telepítésbe.
 */

const fs = require('node:fs');
const path = require('node:path');
const { toExtended } = require('./paths');

const STEAM_DEFAULT = 'C:\\Program Files (x86)\\Steam';

/** Kis- és nagybetűtől független kulcskeresés (a Valve fájlok vegyesen írják). */
function findEntry(obj, wanted) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = String(wanted).toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) return obj[key];
  }
  return undefined;
}

/** String érték a megadott kulcsból, trim-elve; más típusra üres string. */
function stringEntry(obj, wanted) {
  const value = findEntry(obj, wanted);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Minimális VDF (Valve KeyValues) parser.
 *
 * A `"kulcs" "érték"` párokat és a `"kulcs" { ... }` blokkokat dolgozza fel,
 * tetszőleges mélységig. A `//` kommenteket és a BOM-ot kihagyja, a string
 * escape-eket (`\\`, `\"`, `\n`, `\t`) feloldja.
 *
 * @param {string} text
 * @returns {object}
 * @throws {Error} ha a szöveg szerkezetileg hibás (lezáratlan blokk/idézőjel)
 */
function parseVdf(text) {
  const tokens = tokenizeVdf(String(text == null ? '' : text));
  let pos = 0;

  function parseObject(isRoot) {
    const obj = {};

    while (pos < tokens.length) {
      const token = tokens[pos];

      if (token.type === 'close') {
        if (isRoot) throw new Error('Érvénytelen VDF: váratlan "}".');
        pos++;
        return obj;
      }
      if (token.type !== 'string') {
        throw new Error('Érvénytelen VDF: kulcs helyén "{" áll.');
      }

      const key = token.value;
      pos++;

      if (pos >= tokens.length) {
        throw new Error(`Érvénytelen VDF: hiányzó érték a(z) "${key}" kulcs után.`);
      }

      const next = tokens[pos];
      if (next.type === 'open') {
        pos++;
        obj[key] = parseObject(false);
      } else if (next.type === 'string') {
        obj[key] = next.value;
        pos++;
      } else {
        throw new Error(`Érvénytelen VDF: hiányzó érték a(z) "${key}" kulcs után.`);
      }
    }

    if (!isRoot) throw new Error('Érvénytelen VDF: lezáratlan blokk.');
    return obj;
  }

  return parseObject(true);
}

/** A VDF szöveget tokenekre bontja: string, nyitó és záró kapcsos zárójel. */
function tokenizeVdf(text) {
  const src = text.replace(/^\uFEFF/, '');
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Sor komment: // ... a sor végéig
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (ch === '{' || ch === '}') {
      tokens.push({ type: ch === '{' ? 'open' : 'close' });
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') {
          const escaped = src[i + 1];
          if (escaped === undefined) break;
          if (escaped === '\\' || escaped === '"') {
            value += escaped;
            i += 2;
            continue;
          }
          if (escaped === 'n') {
            value += '\n';
            i += 2;
            continue;
          }
          if (escaped === 't') {
            value += '\t';
            i += 2;
            continue;
          }
          // Ismeretlen escape: a backslasht megtartjuk.
          value += c;
          i++;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) throw new Error('Érvénytelen VDF: lezáratlan idézőjel.');
      tokens.push({ type: 'string', value });
      continue;
    }

    // Idézőjel nélküli token (a Valve fájlokban ritka, de előfordul).
    const start = i;
    while (i < src.length && !/\s/.test(src[i]) && src[i] !== '{' && src[i] !== '}') i++;
    tokens.push({ type: 'string', value: src.slice(start, i) });
  }

  return tokens;
}

/** A VDF-ből kapott útvonal egységesítése (per-jel, záró backslash). */
function normalizeLibraryPath(value) {
  let p = String(value || '').trim();
  if (!p) return '';
  p = p.replace(/\//g, '\\');
  // Meghajtó gyökeret (C:\) nem szabad csonkítani.
  if (p.length > 3) p = p.replace(/\\+$/, '');
  return p;
}

/**
 * A Steam könyvtárak listája a `libraryfolders.vdf`-ből.
 *
 * Kezeli az új (beágyazott `"0" { "path" ... }`) és a régi (lapos
 * `"1" "D:\\SteamLibrary"`) formátumot is. A duplikált könyvtárakat
 * kis-nagybetűtől függetlenül kiszűri.
 *
 * @param {string} [steamRoot] Steam gyökér, alapból a szokásos telepítési hely.
 * @returns {string[] | null} könyvtár-útvonalak, vagy null ha nincs/olvashatatlan.
 */
function findSteamLibraryFolders(steamRoot = STEAM_DEFAULT) {
  const root = steamRoot ? String(steamRoot) : STEAM_DEFAULT;
  // A valódi Steam telepítésben a libraryfolders.vdf a steamapps mappában van,
  // de a korábbi/tesztelt elrendezés a gyökérben is előfordulhat.
  const candidates = [
    path.join(root, 'libraryfolders.vdf'),
    path.join(root, 'steamapps', 'libraryfolders.vdf')
  ];

  let parsed = null;
  for (const vdfPath of candidates) {
    try {
      parsed = parseVdf(fs.readFileSync(toExtended(vdfPath), 'utf8'));
      break;
    } catch {
      /* próbáljuk a következő lehetséges helyet */
    }
  }
  if (!parsed) return null;

  const folders = findEntry(parsed, 'libraryfolders');
  if (!folders || typeof folders !== 'object') return null;

  const result = [];
  const seen = new Set();

  for (const [key, value] of Object.entries(folders)) {
    let rawPath;
    if (typeof value === 'string') {
      // Régi formátum: csak a számozott kulcsok alatt van útvonal,
      // a TimeNextStatsReport / ContentStatsID mezőket ki kell hagyni.
      if (!/^\d+$/.test(key)) continue;
      rawPath = value;
    } else {
      rawPath = stringEntry(value, 'path');
    }

    const libraryPath = normalizeLibraryPath(rawPath);
    if (!libraryPath) continue;
    const seenKey = libraryPath.toLowerCase();
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    result.push(libraryPath);
  }

  return result.length ? result : null;
}

/**
 * Egy Steam könyvtár `steamapps` mappájában lévő appmanifest-ek beolvasása.
 *
 * A hibás ACF fájlokat egyenként kihagyja, nem állítja le a teljes beolvasást.
 * Csak a `appmanifest_<szám>.acf` fájlokat veszi figyelembe.
 *
 * @param {string} libraryFolder Steam könyvtár gyökere (amiben a `steamapps` van).
 * @returns {{ appid: string, name: string, installDir: string }[]}
 */
function scanSteamApps(libraryFolder) {
  if (!libraryFolder) return [];

  const steamapps = path.join(String(libraryFolder), 'steamapps');

  let entries;
  try {
    entries = fs.readdirSync(toExtended(steamapps));
  } catch {
    return [];
  }

  const games = [];

  for (const entry of entries) {
    if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;

    try {
      const text = fs.readFileSync(toExtended(path.join(steamapps, entry)), 'utf8');
      const parsed = parseVdf(text);
      const state = findEntry(parsed, 'AppState');
      if (!state || typeof state !== 'object') continue;

      const name = stringEntry(state, 'name');
      const installDir = stringEntry(state, 'installdir');
      // Ha az appid kimaradt, a fájlnévből pótoljuk.
      const appid =
        stringEntry(state, 'appid') ||
        entry.replace(/^appmanifest_/i, '').replace(/\.acf$/i, '');

      // Használhatatlan bejegyzés (név vagy telepítési mappa nélkül).
      if (!appid || !name || !installDir) continue;

      games.push({ appid, name, installDir });
    } catch {
      /* hibás ACF: kihagyjuk, a többi játékot tovább olvassuk */
    }
  }

  // Determinisztikus sorrend a könyvtár bejárási sorrendje helyett.
  games.sort((a, b) => a.name.localeCompare(b.name, 'hu', { sensitivity: 'base' }));
  return games;
}

module.exports = {
  parseVdf,
  findSteamLibraryFolders,
  scanSteamApps,
  STEAM_DEFAULT
};
