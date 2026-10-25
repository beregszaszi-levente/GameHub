'use strict';

/**
 * Windows útvonal-segédek.
 *
 * A D:\Games alatt van olyan mappa, aminek a neve pontra végződik
 * (pl. "Hacker Sim."). A Win32 API az ilyen nevekből lecsípné a pontot,
 * ezért minden fájlműveletet `\\?\` prefixszel (extended-length path)
 * végzünk. A felhasználónak megjelenített útvonalak viszont "szépek".
 */

const path = require('node:path');
const fs = require('node:fs');

const PREFIX = '\\\\?\\';
const UNC_PREFIX = '\\\\?\\UNC\\';

function toExtended(input) {
  if (!input) return input;
  let p = String(input).replace(/\//g, '\\');
  if (p.startsWith(PREFIX)) return p;
  if (p.startsWith('\\\\')) return UNC_PREFIX + p.slice(2);
  if (/^[a-zA-Z]:\\/.test(p)) return PREFIX + p;
  return PREFIX + path.win32.resolve(p);
}

function fromExtended(input) {
  if (!input) return input;
  if (input.startsWith(UNC_PREFIX)) return '\\\\' + input.slice(UNC_PREFIX.length);
  if (input.startsWith(PREFIX)) return input.slice(PREFIX.length);
  return input;
}

/** Igaz, ha bármelyik könyvtár-név pontra vagy szóközre végződik. */
function needsExtended(input) {
  if (!input) return false;
  const p = fromExtended(String(input).replace(/\//g, '\\'));
  return p
    .split('\\')
    .some((part) => part.length > 0 && /[. ]$/.test(part) && !/^[a-zA-Z]:$/.test(part));
}

/** Ugyanaz, de beszédesebb néven a felületnek. */
function hasInvalidName(input) {
  return needsExtended(input);
}

/** Pontra/szóközre végződő mappanév javítása (pl. "Hacker Sim." -> "Hacker Sim"). */
function sanitizeFolderName(name) {
  const cleaned = String(name || '').replace(/[. ]+$/g, '').trim();
  return cleaned || 'Game';
}

/** Fájlrendszer-műveletekhez mindig ezt használd. */
function fsPath(input) {
  return toExtended(input);
}

/** Gyermek útvonal összefűzése úgy, hogy a záró pont megmaradjon. */
function joinExtended(parent, name) {
  const base = toExtended(parent);
  return base.endsWith('\\') ? base + name : base + '\\' + name;
}

/** Indításhoz: sima út, ha lehet, extended csak ha muszáj. */
function spawnPath(input) {
  return needsExtended(input) ? toExtended(input) : fromExtended(String(input));
}

function exists(input) {
  try {
    return fs.existsSync(toExtended(input));
  } catch {
    return false;
  }
}

function isDirectory(input) {
  try {
    return fs.statSync(toExtended(input)).isDirectory();
  } catch {
    return false;
  }
}

/** Emberi szemnek való, rövidített útvonal. */
function displayPath(input) {
  return fromExtended(String(input));
}

module.exports = {
  PREFIX,
  toExtended,
  fromExtended,
  needsExtended,
  hasInvalidName,
  sanitizeFolderName,
  fsPath,
  joinExtended,
  spawnPath,
  exists,
  isDirectory,
  displayPath
};
