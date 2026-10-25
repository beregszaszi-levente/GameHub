'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { displayPath } = require('./paths');

const VERSION = 1;
const DEFAULT_ROOT = 'D:\\Games';

function defaultState() {
  return {
    version: VERSION,
    settings: {
      libraryRoots: [DEFAULT_ROOT],
      autoScanOnStart: true,
      skipLauncherFolders: true,
      steamImportPath: null
    },
    games: []
  };
}

function slugId(folder) {
  const hash = crypto.createHash('sha1').update(displayPath(folder).toLowerCase()).digest('hex');
  return 'g' + hash.slice(0, 12);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const folder = raw.folder ? String(raw.folder) : '';
  if (!folder) return null;
  const launch = raw.launch && typeof raw.launch === 'object' ? raw.launch : {};
  const kind = launch.kind === 'bat' ? 'bat' : 'exe';
  return {
    id: String(raw.id || slugId(folder)),
    title: String(raw.title || 'Névtelen játék').trim() || 'Névtelen játék',
    folder,
    folderDisplay: displayPath(folder),
    launch: {
      kind,
      path: launch.path ? String(launch.path) : '',
      args: Array.isArray(launch.args) ? launch.args.map(String) : [],
      cwd: launch.cwd ? String(launch.cwd) : '',
      elevated: Boolean(launch.elevated)
    },
    processNames: Array.isArray(raw.processNames)
      ? raw.processNames.map(String).filter(Boolean)
      : [],
    cover: raw.cover ? String(raw.cover) : null,
    // Ki állította be a borítót: kézi kiválasztás ('manual') vagy automatikus
    // felismerés ('auto'). A kézi borítót automatikus művelet nem írhatja felül.
    coverMode: raw.coverMode === 'manual' || raw.coverMode === 'auto' ? raw.coverMode : null,
    favorite: Boolean(raw.favorite),
    playtimeSec: num(raw.playtimeSec),
    lastPlayed: raw.lastPlayed ? num(raw.lastPlayed) : null,
    addedAt: num(raw.addedAt, Date.now()),
    source: raw.source === 'manual' || raw.source === 'steam-import' ? raw.source : 'auto',
    titleLocked: Boolean(raw.titleLocked),
    launchLocked: Boolean(raw.launchLocked)
  };
}

function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  if (Array.isArray(settings.libraryRoots)) {
    const roots = settings.libraryRoots
      .map((r) => String(r).trim())
      .filter(Boolean);
    state.settings.libraryRoots = roots.length ? roots : [DEFAULT_ROOT];
  }
  if (typeof settings.autoScanOnStart === 'boolean') {
    state.settings.autoScanOnStart = settings.autoScanOnStart;
  }
  if (typeof settings.skipLauncherFolders === 'boolean') {
    state.settings.skipLauncherFolders = settings.skipLauncherFolders;
  }
  state.settings.steamImportPath =
    typeof settings.steamImportPath === 'string' && settings.steamImportPath.trim()
      ? settings.steamImportPath.trim()
      : null;

  if (Array.isArray(raw.games)) {
    const seen = new Set();
    state.games = raw.games
      .map(normalizeGame)
      .filter((g) => {
        if (!g || seen.has(g.id)) return false;
        seen.add(g.id);
        return true;
      });
  }
  return state;
}

class LibraryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.coverDir = path.join(dataDir, 'covers');
    this.file = path.join(dataDir, 'library.json');
    this.data = defaultState();
    this._saveTimer = null;
    this._dirty = false;
  }

  ensureDirs() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.coverDir, { recursive: true });
  }

  load() {
    this.ensureDirs();
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = normalizeState(JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[library] nem sikerült betölteni, új állapot indul:', err.message);
      }
      this.data = defaultState();
    }
    return this.data;
  }

  get settings() {
    return this.data.settings;
  }

  get games() {
    return this.data.games;
  }

  getGame(id) {
    return this.data.games.find((g) => g.id === id) || null;
  }

  addGame(game) {
    const normalized = normalizeGame(game);
    if (!normalized) return null;
    if (this.getGame(normalized.id)) {
      return this.updateGame(normalized.id, normalized);
    }
    this.data.games.push(normalized);
    this.scheduleSave();
    return normalized;
  }

  updateGame(id, patch) {
    const game = this.getGame(id);
    if (!game) return null;

    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (title) {
        game.title = title;
        game.titleLocked = true;
      }
    }
    if (patch.launch && typeof patch.launch === 'object') {
      if (patch.launch.kind === 'bat' || patch.launch.kind === 'exe') {
        game.launch.kind = patch.launch.kind;
      }
      if (patch.launch.path !== undefined) game.launch.path = String(patch.launch.path);
      if (Array.isArray(patch.launch.args)) game.launch.args = patch.launch.args.map(String);
      if (patch.launch.cwd !== undefined) game.launch.cwd = String(patch.launch.cwd);
      if (patch.launch.elevated !== undefined) game.launch.elevated = Boolean(patch.launch.elevated);
      game.launchLocked = true;
    }
    if (Array.isArray(patch.processNames)) {
      game.processNames = patch.processNames.map(String).filter(Boolean);
    }
    if (typeof patch.favorite === 'boolean') game.favorite = patch.favorite;
    if (patch.cover !== undefined) game.cover = patch.cover ? String(patch.cover) : null;
    if (patch.coverMode !== undefined) {
      game.coverMode =
        patch.coverMode === 'manual' || patch.coverMode === 'auto' ? patch.coverMode : null;
    }

    this.scheduleSave();
    return game;
  }

  removeGame(id) {
    const before = this.data.games.length;
    this.data.games = this.data.games.filter((g) => g.id !== id);
    if (this.data.games.length === before) return false;
    this.scheduleSave();
    return true;
  }

  setSettings(patch) {
    if (!patch || typeof patch !== 'object') return this.data.settings;
    if (Array.isArray(patch.libraryRoots)) {
      const roots = patch.libraryRoots.map((r) => String(r).trim()).filter(Boolean);
      if (roots.length) this.data.settings.libraryRoots = roots;
    }
    if (typeof patch.autoScanOnStart === 'boolean') {
      this.data.settings.autoScanOnStart = patch.autoScanOnStart;
    }
    if (typeof patch.skipLauncherFolders === 'boolean') {
      this.data.settings.skipLauncherFolders = patch.skipLauncherFolders;
    }
    if (patch.steamImportPath === null || typeof patch.steamImportPath === 'string') {
      const value = patch.steamImportPath === null ? null : patch.steamImportPath.trim();
      this.data.settings.steamImportPath = value || null;
    }
    this.scheduleSave();
    return this.data.settings;
  }

  addPlaytime(id, seconds) {
    const game = this.getGame(id);
    if (!game || seconds <= 0) return;
    game.playtimeSec += Math.round(seconds);
    this._dirty = true;
  }

  touchLastPlayed(id) {
    const game = this.getGame(id);
    if (!game) return;
    game.lastPlayed = Date.now();
    this._dirty = true;
  }

  /** Nem azonnal ír, hogy a játékidő-tick ne terhelje a lemezt. */
  scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save();
    }, 1500);
  }

  saveNow() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.save();
  }

  save() {
    if (!this._dirty && fs.existsSync(this.file)) return;
    this.ensureDirs();
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      this._dirty = false;
    } catch (err) {
      console.error('[library] mentés hiba:', err.message);
    }
  }

  hasFolder(folder) {
    return this.data.games.some((g) => g.folder.toLowerCase() === String(folder).toLowerCase());
  }
}

module.exports = { LibraryStore, defaultState, normalizeState, normalizeGame, slugId };
