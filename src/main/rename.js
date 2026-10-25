'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  displayPath,
  exists,
  hasInvalidName,
  sanitizeFolderName,
  toExtended
} = require('./paths');

/**
 * Pontra (vagy szóközre) végződő mappanév javítása.
 *
 * A Windows a sima útvonalakból lecsipkedi a záró pontot, ezért az ilyen
 * mappába a játékok többsége nem tud írni (mentés, log, config) és el sem
 * indul. Az átnevezés csak a mappanevet változtatja meg.
 */

function planRename(folder) {
  const current = displayPath(folder);
  if (!hasInvalidName(current)) {
    return { ok: false, message: 'Ezzel a mappanévvel nincs probléma.' };
  }

  const parent = path.win32.dirname(current);
  const base = path.win32.basename(current);

  if (hasInvalidName(parent)) {
    return {
      ok: false,
      message:
        'A szülőkönyvtár neve is pontra végződik. Ezt csak kézzel lehet javítani.'
    };
  }

  const targetBase = sanitizeFolderName(base);
  let target = path.win32.join(parent, targetBase);
  let counter = 2;
  while (exists(target)) {
    target = path.win32.join(parent, `${targetBase} (${counter})`);
    counter += 1;
  }

  return { ok: true, from: current, to: target, base, targetBase };
}

function renameFolder(folder) {
  const plan = planRename(folder);
  if (!plan.ok) return plan;

  try {
    fs.renameSync(toExtended(plan.from), toExtended(plan.to));
  } catch (err) {
    return { ok: false, message: `Nem sikerült átnevezni: ${err.message}` };
  }

  return { ok: true, from: plan.from, to: plan.to };
}

module.exports = { planRename, renameFolder };
