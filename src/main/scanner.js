'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  toExtended,
  fromExtended,
  joinExtended,
  isDirectory,
  exists,
  displayPath
} = require('./paths');
const { slugId } = require('./library');

const MAX_DEPTH = 7;
const MAX_ENTRIES = 20000;

/** Ezekbe a mappákba nem megyünk bele (nem tartalmaznak játék-indítót). */
const SKIP_DIR =
  /^(redist|redistributables|_commonredist|directx|directxredist|vcredist|dotnet|support|engine|content|saved|savegames|save data|logs?|config|movies|paks|audio|localization|shaders|intermediate|deriveddatacache|\.git|node_modules|__installer|installers?|crashreports?|crashlogs?|dxsetup)$/i;

/** Gyökérszinten ezek launcher-mappák, nem játékok. */
const LAUNCHER_FOLDER =
  /^(epic games|steam|steamapps|steam library|gog galaxy|origin|ea app|ea games|uplay|ubisoft connect|battle\.net|blizzard|riot client|launcher|games)$/i;

/** Ezek nem játék-indítók. */
const BLOCK_EXE =
  /(unins|uninstall|setup|installer|install|redist|dxsetup|vc_?redist|directx|crash|report|cleanup|cleaner|helper|service|broker|updater|update|wizard|attestation|bootstrapper|downloader|overlay|benchmark|editor|dedicated|eac|easyanticheat|battleye|cmd|powershell|conhost|rundll32|regsvr32|dxdiag|tasklist|timeout|python|node|dotnet)/i;

/** Technikai mappanevek, ezekből nem lesz játékcím. */
const TECH_NAME =
  /^(bin|bins|binaries|win32|win64|x64|x86|amd64|game|games|pc|sp\d+|mp\d+|redist|engine|content|data|system|plugins|scripts|support|tools|config|saved|savegames|logs?|shipping|game files|program files|resources|build|dist)$/i;

const SMALL_WORDS = /^(of|the|and|in|on|at|to|for|a|an|vs|de|la|le)$/i;

/** Borítónak elfogadott képek, prioritási sorrendben. */
const COVER_CANDIDATES = ['folder.jpg', 'cover.jpg', 'poster.jpg', 'banner.jpg'];

/** Fallback: bármely képfájl kiterjesztése. */
const COVER_FALLBACK_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function e(pathStr) {
  return toExtended(pathStr);
}

function readText(file, limit = 128 * 1024) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(limit);
      const read = fs.readSync(fd, buf, 0, limit, 0);
      return buf.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function titleCase(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.test(word)) return word.toLowerCase();
      if (/^[A-Z0-9]{2,4}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function cleanTitle(raw) {
  let text = String(raw || '')
    .replace(/[._]+$/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(
      /\b(anker\s*games|anker|repack|fitgirl|dodi|codex|plaza|empress|skidrow|elamigos|gog|multi\d*|portable|win64|win32|x64|x86)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) text = String(raw || '').trim();
  return titleCase(text);
}

/** A legmélyebb olyan szülőmappa, ami emberi címnek néz ki. */
function pickAncestorTitle(launchFile, rootFolder) {
  const rootNorm = fromExtended(rootFolder).replace(/\\+$/, '').toLowerCase();
  let current = path.win32.dirname(fromExtended(launchFile));
  const candidates = [];
  let guard = 0;
  while (current && guard++ < 12) {
    if (current.toLowerCase() === rootNorm) break;
    const base = path.win32.basename(current);
    if (
      base &&
      base.includes(' ') &&
      base.length > 3 &&
      base.length < 64 &&
      !TECH_NAME.test(base) &&
      !/^(game files|program files|common files)$/i.test(base)
    ) {
      candidates.push(base);
    }
    const parent = path.win32.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!candidates.length) return null;
  return cleanTitle(candidates[0]);
}

function exeScore(file, folderName) {
  const base = path.basename(file.name, file.ext).toLowerCase();
  let score = 0;

  if (/-shipping$/.test(base)) score += 100;
  if (/[\\/](binaries|bin)[\\/](win64|x64|win32|x86)[\\/]/i.test(file.full)) score += 25;
  if (file.size > 100 * 1024 * 1024) score += 45;
  else if (file.size > 20 * 1024 * 1024) score += 25;
  else if (file.size < 1024 * 1024) score -= 20;

  if (/^(game|client|play|start)$/.test(base)) score += 30;

  const folderTokens = cleanTitle(folderName).toLowerCase().split(/\s+/).filter(Boolean);
  const nameTokens = base.split(/[-_.\s]+/).filter(Boolean);
  if (folderTokens[0] && nameTokens.includes(folderTokens[0])) score += 15;

  score -= file.depth * 3;
  return score;
}

function batScore(file, content) {
  const name = file.name.toLowerCase();
  const hasExe = /\.exe/i.test(content);
  const delegates = !hasExe && /\.(bat|cmd)\b/i.test(content);

  let score = 20;
  if (/^run\s*me!?\.(bat|cmd)$/.test(name)) score = 130;
  else if (/^!?start[\s_-].*\.(bat|cmd)$/.test(name)) score = 140;
  else if (/^!?start\.(bat|cmd)$/.test(name)) score = 135;
  else if (/^play.*\.(bat|cmd)$/.test(name)) score = 105;
  else if (/(start|launch|run|play)/.test(name)) score = 55;

  if (hasExe) score += 10;
  // Ha csak továbbhív egy másik bat-ra, az kevésbé jó indító.
  if (delegates) score -= 25;
  return score;
}

function extractProcessNames(text) {
  const names = new Set();
  const re = /([A-Za-z0-9_\-!. ]{3,80}\.exe)/gi;
  let match;
  while ((match = re.exec(text))) {
    const base = match[1].trim().split(/[\\/]/).pop().toLowerCase();
    if (!base || base.length < 8) continue; // pl. sc.exe, cd.exe
    if (BLOCK_EXE.test(base)) continue;
    names.add(base);
  }
  return [...names];
}

function collectFiles(startDir) {
  const files = [];
  let visited = 0;
  const stack = [{ dir: e(startDir), depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > MAX_DEPTH) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (++visited > MAX_ENTRIES) return files;
      const name = entry.name;
      if (!name || name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;

      const full = joinExtended(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIR.test(name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(name).toLowerCase();
      if (ext !== '.exe' && ext !== '.bat' && ext !== '.cmd') continue;

      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      files.push({ name, full, ext, size, depth });
    }
  }
  return files;
}

/** Indítási munkakönyvtár: Unreal játékoknál a projekt gyökere kell. */
function defaultCwd(launchFile) {
  const dir = fromExtended(path.win32.dirname(launchFile));
  if (/[\\/]Binaries[\\/]Win(64|32)$/i.test(dir)) {
    return path.win32.dirname(path.win32.dirname(path.win32.dirname(dir)));
  }
  return dir;
}

/**
 * A játék mappájában található borítókép.
 * Először a prioritált neveket nézzük, aztán a mappa bármely képfájlját.
 * Extended pathot ad vissza, vagy null-t, ha nincs kép.
 */
function findCoverImage(folderExt) {
  for (const candidate of COVER_CANDIDATES) {
    const coverPath = joinExtended(folderExt, candidate);
    if (exists(coverPath)) return coverPath;
  }

  let entries;
  try {
    entries = fs.readdirSync(toExtended(folderExt), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && COVER_FALLBACK_EXT.test(entry.name)) {
      return joinExtended(folderExt, entry.name);
    }
  }
  return null;
}

/**
 * A scan során talált borítót a covers mappába másolja, mert a cover://
 * protokoll csak innen szolgál ki. Hiba esetén null-t ad vissza, hogy a
 * játék felvétele ne hiúsuljon meg.
 */
function copyCoverToStore(store, source, gameId) {
  if (!source || !gameId || !store?.coverDir) return null;
  const ext = path.extname(source).toLowerCase();
  if (!COVER_FALLBACK_EXT.test(ext)) return null;

  try {
    fs.mkdirSync(store.coverDir, { recursive: true });
    const target = path.join(store.coverDir, `${gameId}-${Date.now()}${ext}`);
    fs.copyFileSync(toExtended(source), toExtended(target));
    return target;
  } catch (err) {
    console.error('[scan] a borító bemásolása nem sikerült:', err.message);
    return null;
  }
}

function detectGame(folderExt) {
  const folderName = path.win32.basename(fromExtended(folderExt));
  const files = collectFiles(folderExt);
  if (!files.length) return null;

  const scored = [];
  for (const file of files) {
    const base = path.basename(file.name, file.ext);
    if (file.ext === '.bat' || file.ext === '.cmd') {
      const content = readText(file.full);
      if (!content) continue;
      scored.push({
        ...file,
        kind: 'bat',
        score: batScore(file, content),
        content
      });
      continue;
    }
    if (BLOCK_EXE.test(base)) continue;
    const score = exeScore(file, folderName);
    if (score <= 0) continue;
    scored.push({ ...file, kind: 'exe', score });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const launch = {
    kind: best.kind,
    path: displayPath(best.full),
    args: [],
    cwd: defaultCwd(best.full),
    elevated: false
  };

  let processNames = [];
  if (best.kind === 'bat') {
    processNames = extractProcessNames(best.content);
    launch.elevated = /runas|start-process[^\n]*-verb\s+runas/i.test(best.content);
  }
  if (!processNames.length) {
    processNames = [path.basename(best.name).toLowerCase()];
  }

  const ancestorTitle = pickAncestorTitle(best.full, folderExt);
  const title = ancestorTitle || cleanTitle(folderName);

  const game = {
    id: slugId(folderExt),
    title,
    folder: folderExt,
    launch,
    processNames,
    cover: null,
    favorite: false,
    playtimeSec: 0,
    lastPlayed: null,
    addedAt: Date.now(),
    source: 'auto',
    titleLocked: false,
    launchLocked: false
  };

  // Automatikus borítófelismerés: csak új játéknál fut, kézi borítót nem ír felül
  // (a mergeScanResults a meglévő játék cover mezőjéhez nem nyúl).
  if (!game.cover) {
    const found = findCoverImage(folderExt);
    if (found) game.cover = displayPath(found);
  }

  return game;
}

/**
 * Végigolvassa a beállított könyvtárakat, és visszaadja a talált indítókat.
 * Nem ír semmit, a hívó dönti el, hogyan vonja össze a meglévő listával.
 */
function scanRoots(settings) {
  const roots = Array.isArray(settings?.libraryRoots) ? settings.libraryRoots : [];
  const skipLaunchers = settings?.skipLauncherFolders !== false;
  const found = [];
  const errors = [];

  for (const root of roots) {
    if (!root) continue;
    if (!isDirectory(root)) {
      errors.push({ root, message: 'A könyvtár nem érhető el' });
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(e(root), { withFileTypes: true });
    } catch (err) {
      errors.push({ root, message: err.message });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;
      if (skipLaunchers && LAUNCHER_FOLDER.test(entry.name)) continue;

      const folderExt = joinExtended(e(root), entry.name);
      try {
        const game = detectGame(folderExt);
        if (game) found.push(game);
      } catch (err) {
        errors.push({ root: displayPath(folderExt), message: err.message });
      }
    }
  }

  return { games: found, errors };
}

/**
 * A scan eredményét összevonja a meglévő listával.
 * - Új mappa -> új játék
 * - Meglévő -> csak az automatikus mezők frissülnek (cím/indító, ha nem szerkesztetted kézzel)
 */
/** Két mappaútvonal összehasonlítása fájlrendszeri szintre (kiszűri a \\?\ előtagot és a záró pontot/szóközt). */
function normalizeFolderForCompare(folder) {
  return displayPath(folder)
    .replace(/[. ]+$/g, '')
    .toLowerCase();
}

function mergeScanResults(store, scan) {
  const summary = { added: 0, updated: 0, unchanged: 0, errors: scan.errors };

  for (const detected of scan.games) {
    const existing = store.games.find(
      (g) => normalizeFolderForCompare(g.folder) === normalizeFolderForCompare(detected.folder)
    );

    if (!existing) {
      // Az automatikusan talált borítót a covers mappába másoljuk, különben
      // a cover:// protokoll (ami csak a coverDir-ből szolgál ki) nem találná meg.
      const copied = copyCoverToStore(store, detected.cover, detected.id);
      if (copied) detected.cover = copied;
      store.data.games.push(detected);
      summary.added++;
      continue;
    }

    let changed = false;
    if (!existing.titleLocked && detected.title && existing.title !== detected.title) {
      existing.title = detected.title;
      changed = true;
    }
    if (!existing.launchLocked) {
      const same =
        existing.launch.kind === detected.launch.kind &&
        existing.launch.path === detected.launch.path &&
        existing.launch.cwd === detected.launch.cwd &&
        existing.launch.elevated === detected.launch.elevated;
      if (!same) {
        existing.launch = detected.launch;
        existing.processNames = detected.processNames;
        changed = true;
      }
    }
    // Re-scan: a meglévő, borító nélküli játék megkapja a felismert borítót.
    // A felhasználó által beállított borítót soha nem írjuk felül.
    if (!existing.cover && detected.cover) {
      const copied = copyCoverToStore(store, detected.cover, existing.id);
      if (copied) {
        existing.cover = copied;
        changed = true;
      }
    }
    if (changed) summary.updated++;
    else summary.unchanged++;
  }

  store.scheduleSave();
  return summary;
}

module.exports = {
  scanRoots,
  mergeScanResults,
  detectGame,
  cleanTitle,
  extractProcessNames,
  copyCoverToStore
};
