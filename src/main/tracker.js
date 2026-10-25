'use strict';

const { execFile } = require('node:child_process');

const TICK_MS = 5000;
const PENDING_TIMEOUT_MS = 3 * 60 * 1000;
const SAVE_EVERY_TICKS = 6; // ~30 mp

function isRunning(names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return Promise.resolve(false);

  return new Promise((resolve) => {
    let remaining = list.length;
    let found = false;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) resolve(found);
    };

    for (const name of list) {
      execFile(
        'tasklist',
        ['/FI', `IMAGENAME eq ${name}`, '/NH', '/FO', 'CSV'],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (!err && stdout && stdout.toLowerCase().includes(name.toLowerCase())) {
            found = true;
          }
          done();
        }
      );
    }
  });
}

/**
 * Figyeli az általunk indított játékok folyamatait, és gyűjti a játékidőt.
 * A CoD-nál a bat csak elindítja a játékot, ezért a folyamatnévre figyelünk,
 * nem a gyerekfolyamat kilépésére.
 */
class PlaytimeTracker {
  constructor({ library, onRunningChange, onTick }) {
    this.library = library;
    this.onRunningChange = onRunningChange || (() => {});
    this.onTick = onTick || (() => {});
    this.watching = new Map(); // id -> { pendingSince, startedAt, lastTick, ticks }
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.library.saveNow();
  }

  watch(id, processNames) {
    const game = this.library.getGame(id);
    if (!game) return;
    if (processNames) game.processNames = processNames.filter(Boolean);
    if (this.watching.has(id)) return;
    this.watching.set(id, {
      pendingSince: Date.now(),
      startedAt: null,
      lastTick: null,
      ticks: 0
    });
  }

  unwatch(id) {
    this.watching.delete(id);
  }

  isRunning(id) {
    return Boolean(this.watching.get(id)?.startedAt);
  }

  runningIds() {
    return [...this.watching.entries()].filter(([, v]) => v.startedAt).map(([id]) => id);
  }

  async tick() {
    if (this.busy) return;
    if (!this.watching.size) return;
    this.busy = true;

    try {
      for (const [id, entry] of [...this.watching.entries()]) {
        const game = this.library.getGame(id);
        if (!game) {
          this.watching.delete(id);
          continue;
        }

        const running = await isRunning(game.processNames);
        const now = Date.now();

        if (running && !entry.startedAt) {
          entry.startedAt = now;
          entry.lastTick = now;
          this.library.touchLastPlayed(id);
          this.library.scheduleSave();
          this.onRunningChange(id, true);
          continue;
        }

        if (running && entry.startedAt) {
          const delta = Math.min((now - entry.lastTick) / 1000, TICK_MS / 500);
          this.library.addPlaytime(id, delta);
          entry.lastTick = now;
          entry.ticks += 1;
          this.onTick(id, this.library.getGame(id)?.playtimeSec || 0);
          if (entry.ticks % SAVE_EVERY_TICKS === 0) this.library.saveNow();
          continue;
        }

        if (!running && entry.startedAt) {
          this.library.saveNow();
          this.watching.delete(id);
          this.onRunningChange(id, false);
          continue;
        }

        // Még nem indult el (pl. UAC-ra vár, vagy hibára futott).
        if (!entry.startedAt && now - entry.pendingSince > PENDING_TIMEOUT_MS) {
          this.watching.delete(id);
          this.onRunningChange(id, false);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { PlaytimeTracker, isRunning, TICK_MS };
