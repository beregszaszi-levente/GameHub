'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { exists, hasInvalidName, spawnPath, displayPath } = require('./paths');

/**
 * Indító réteg.
 *
 * - exe  : közvetlen indítás (Unreal játékoknál a beállított cwd-vel)
 * - bat  : cmd.exe-vel, vagy ha kell, PowerShell Start-Process-szel
 * - admin: a játék saját magát kérné adminra (pl. anti-cheat driver),
 *          ilyenkor mi kérjük a UAC-t, hogy egy ablak jöjjön fel
 *
 * Pontra végződő mappanévből nem indítunk: a Windows nem tud ilyen
 * munkakönyvtárat adni a folyamatnak, a játékok többsége pedig el sem indul.
 * Ilyenkor a felület felajánlja a mappa átnevezését.
 */

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function startDetached(command, args, options) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options
  });
  child.on('error', (err) => {
    console.error('[launcher] indítási hiba:', err.message);
  });
  child.unref();
}

function runPowerShell(command, { detached = true } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-Command',
      command
    ];

    if (detached) {
      startDetached('powershell.exe', args, {});
      resolve({ ok: true });
      return;
    }

    let stderr = '';
    const child = spawn('powershell.exe', args, { windowsHide: true });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => resolve({ ok: false, message: err.message }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else
        resolve({
          ok: false,
          message:
            stderr.trim() ||
            'A rendszergazdai indítás nem sikerült (valószínűleg megszakítottad a UAC ablakot).'
        });
    });
  });
}

function renameHint() {
  return {
    ok: false,
    needsRename: true,
    message:
      'Ennek a játéknak a mappaneve pontra végződik, amit a Windows nem tud kezelni – ' +
      'emiatt a játék el sem indul. Nyisd meg a részleteket, és kattints a „Mappa átnevezése” gombra.'
  };
}

async function launchGame(game) {
  const config = game?.launch;
  if (!config || !config.path) {
    return { ok: false, message: 'Ehhez a játékhoz még nincs beállítva indító.' };
  }
  if (hasInvalidName(config.path) || (config.cwd && hasInvalidName(config.cwd))) {
    return renameHint();
  }
  if (!exists(config.path)) {
    return {
      ok: false,
      message: `Az indító nem található:\n${displayPath(config.path)}`
    };
  }

  const cwd =
    config.cwd && exists(config.cwd) ? config.cwd : path.win32.dirname(config.path);
  const args = Array.isArray(config.args) ? config.args : [];

  if (config.kind === 'exe') {
    try {
      startDetached(spawnPath(config.path), args, { cwd: spawnPath(cwd) });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  // .bat / .cmd
  if (config.elevated) {
    const command =
      `Start-Process -FilePath ${psQuote(spawnPath(config.path))} ` +
      `-WorkingDirectory ${psQuote(spawnPath(cwd))} -Verb RunAs`;
    return runPowerShell(command, { detached: false });
  }

  try {
    startDetached('cmd.exe', ['/c', config.path], { cwd });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { launchGame };
