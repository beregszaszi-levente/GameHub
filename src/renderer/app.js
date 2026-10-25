'use strict';

/* ==========================================================================
   GameHub renderer
   ========================================================================== */

const api = window.gamehub;

const state = {
  data: { games: [], settings: { libraryRoots: [] }, dataDir: '' },
  view: 'library',
  query: '',
  sort: 'name',
  detailId: null,
  editorId: null,
  steamGames: []
};

const el = (id) => document.getElementById(id);

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3l-1.1-1C6.1 14.9 3 12.1 3 8.6 3 5.9 5.1 4 7.7 4c1.5 0 2.9.7 3.8 1.9l.5.6.5-.6C13.4 4.7 14.8 4 16.3 4 18.9 4 21 5.9 21 8.6c0 3.5-3.1 6.3-7.9 10.7l-1.1 1z" fill="currentColor"/></svg>';

/* ---------------------------- helpers ----------------------------------- */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hashHue(text) {
  let hash = 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function initials(title) {
  const words = String(title || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[1][0];
}

function formatPlaytime(seconds) {
  const sec = Number(seconds) || 0;
  if (sec < 60) return sec > 0 ? '1 percnél kevesebb' : 'még nem játszottál vele';
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes} perc`;
  const hours = sec / 3600;
  const rounded = hours < 10 ? hours.toFixed(1) : Math.round(hours).toString();
  return `${rounded.replace('.', ',')} óra`;
}

function formatLastPlayed(timestamp) {
  if (!timestamp) return 'még soha';
  const diff = Date.now() - Number(timestamp);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'most';
  if (diff < hour) return `${Math.round(diff / minute)} perce`;
  if (diff < day) return `${Math.round(diff / hour)} órája`;

  const days = Math.round(diff / day);
  if (days === 1) return 'tegnap';
  if (days < 7) return `${days} napja`;
  if (days < 30) return `${Math.round(days / 7)} hete`;
  if (days < 365) return `${Math.round(days / 30)} hónapja`;
  return new Date(Number(timestamp)).toLocaleDateString('hu-HU');
}

function formatTotal(games) {
  const played = games.filter((g) => g.playtimeSec > 0).length;
  const total = games.reduce((sum, g) => sum + (g.playtimeSec || 0), 0);
  const parts = [`${games.length} játék`];
  if (played) parts.push(`összesen ${formatPlaytime(total)}`);
  return parts.join(' · ');
}

function splitArgs(text) {
  const result = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    result.push(match[1] ?? match[2] ?? match[3]);
  }
  return result;
}

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<div class="toast-text">${esc(message)}</div>`;
  el('toasts').appendChild(node);

  const timeout = type === 'error' ? 7000 : 4200;
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

/* ---------------------------- data -------------------------------------- */

function games() {
  return state.data.games || [];
}

function gameById(id) {
  return games().find((game) => game.id === id) || null;
}

async function refreshState() {
  state.data = await api.getState();
}

/* ---------------------------- rendering --------------------------------- */

function visibleGames() {
  let list = games().slice();

  if (state.view === 'favorites') list = list.filter((game) => game.favorite);
  if (state.view === 'running') list = list.filter((game) => game.running);

  const query = fold(state.query);
  if (query) {
    list = list.filter((game) => fold(game.title).includes(query));
  }

  switch (state.sort) {
    case 'recent':
      list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
      break;
    case 'playtime':
      list.sort((a, b) => (b.playtimeSec || 0) - (a.playtimeSec || 0));
      break;
    case 'added':
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      break;
    default:
      list.sort((a, b) => a.title.localeCompare(b.title, 'hu', { sensitivity: 'base' }));
  }

  return list;
}

function cardMarkup(game, index, animate = false) {
  const hue = hashHue(game.title);
  const cover = game.coverUrl
    ? `<img src="${esc(game.coverUrl)}" alt="" loading="lazy" />`
    : `<div class="card-fallback"><span class="monogram">${esc(initials(game.title))}</span></div>`;

  const meta = game.running
    ? 'most fut'
    : game.needsRename
      ? '⚠ a mappa neve javítandó'
      : game.playtimeSec > 0
        ? `${formatPlaytime(game.playtimeSec)} · ${formatLastPlayed(game.lastPlayed)}`
        : 'még nem játszottál vele';

  const animStyle = animate ? `style="animation-delay:${Math.min(index * 18, 220)}ms"` : '';

  return `
    <article class="card ${game.running ? 'is-running' : ''}" data-id="${esc(game.id)}"
             role="listitem" tabindex="0" ${animStyle}>
      <div class="card-art" style="--h:${hue}">
        ${cover}
        <div class="card-shade"></div>
        ${game.running ? '<span class="badge-running">Fut</span>' : ''}
        <button class="card-fav ${game.favorite ? 'on' : ''}" data-action="favorite"
                title="${game.favorite ? 'Eltávolítás a kedvencekből' : 'Hozzáadás a kedvencekhez'}">
          ${HEART_SVG}
        </button>
        <button class="card-play" data-action="play" title="Játszás"></button>
      </div>
      <div class="card-info">
        <h3 class="card-title">${esc(game.title)}</h3>
        <div class="card-meta ${game.needsRename ? 'warn' : ''}">${esc(meta)}</div>
      </div>
    </article>`;
}

let renderCount = 0;

function render() {
  const list = visibleGames();
  const all = games();
  const running = all.filter((game) => game.running).length;
  const favorites = all.filter((game) => game.favorite).length;

  el('count-library').textContent = String(all.length);
  el('count-favorites').textContent = String(favorites);
  el('count-running').textContent = String(running);
  el('stat-total').textContent = formatTotal(all);

  const titles = {
    library: ['Könyvtár', `${list.length} játék`],
    favorites: ['Kedvencek', `${list.length} játék`],
    running: ['Futó játékok', `${list.length} fut`]
  };
  el('view-title').textContent = titles[state.view][0];
  el('view-subtitle').textContent = titles[state.view][1];

  // Az animáció csak az első renderen és nézetváltáson fusson le, nem minden ticknél.
  const isFirst = renderCount === 0;
  renderCount += 1;

  el('grid').innerHTML = list.map((game, index) => cardMarkup(game, index, isFirst)).join('');

  const empty = el('empty');
  if (list.length === 0) {
    empty.classList.remove('hidden');
    el('grid').innerHTML = '';

    if (state.query) {
      el('empty-title').textContent = 'Nincs találat';
      el('empty-text').textContent = `Nincs a keresésre találat: „${state.query}”.`;
    } else if (state.view === 'favorites') {
      el('empty-title').textContent = 'Még nincs kedvenced';
      el('empty-text').textContent =
        'Vidd az egeret egy borító fölé, és kattints a szív ikonra a kedvencekhez adáshoz.';
    } else if (state.view === 'running') {
      el('empty-title').textContent = 'Jelenleg semmi sem fut';
      el('empty-text').textContent =
        'Amikor elindítasz egy játékot innen, itt fogod látni, és itt számoljuk a játékidőt.';
    } else if (!all.length) {
      el('empty-title').textContent = 'Még nincs játékod';
      el('empty-text').textContent =
        'Add hozzá a játékaid mappáját, vagy olvasd újra a beállított könyvtárakat. A D:\\Games mappát alapból figyeljük.';
    } else {
      el('empty-title').textContent = 'Nincs megjeleníthető játék';
      el('empty-text').textContent = 'Próbálj másik nézetet vagy keresést.';
    }
  } else {
    empty.classList.add('hidden');
  }

  if (state.detailId) renderDetail(state.detailId);
}

/* ---------------------------- detail ------------------------------------ */

function renderDetail(id) {
  const game = gameById(id);
  if (!game) {
    closeOverlay('detail');
    return;
  }

  try {
    const hue = hashHue(game.title);
    const hero = el('detail-hero');
    if (hero) hero.style.setProperty('--h', hue);

    const cover = el('detail-cover');
    const fallback = el('detail-fallback');
    if (game.coverUrl) {
      if (cover) {
        cover.src = game.coverUrl;
        cover.classList.remove('hidden');
      }
      if (fallback) fallback.classList.add('hidden');
    } else {
      if (cover) {
        cover.removeAttribute('src');
        cover.classList.add('hidden');
      }
      if (fallback) fallback.classList.remove('hidden');
    }

    const titleEl = el('detail-title');
    const subEl = el('detail-sub');
    const timeEl = el('detail-time');
    const lastEl = el('detail-last');
    const launchEl = el('detail-launch');

    if (titleEl) titleEl.textContent = game.title;
    if (subEl)
      subEl.textContent = `${formatPlaytime(game.playtimeSec)} · ${formatLastPlayed(
        game.lastPlayed
      )}`;
    if (timeEl)
      timeEl.textContent = game.running ? 'most játszik' : formatPlaytime(game.playtimeSec);
    if (lastEl) lastEl.textContent = formatLastPlayed(game.lastPlayed);
    if (launchEl) {
      launchEl.textContent = game.launch.pathDisplay || 'nincs beállítva';
      launchEl.title = game.launch.pathDisplay || '';
    }

    const note = el('detail-note');
    const noteText = el('detail-note-text');
    const fix = el('detail-fix-name');
    if (note) note.classList.add('hidden');
    if (fix) fix.classList.add('hidden');

    if (game.needsRename) {
      if (noteText) {
        noteText.textContent =
          'A mappa neve pontra végződik, amit a Windows nem tud kezelni – emiatt a játék ' +
          'el sem indul. Az átnevezés csak a mappa nevét változtatja meg, a játékfájlokhoz nem nyúl.';
      }
      if (note) note.classList.remove('hidden');
      if (fix) fix.classList.remove('hidden');
    } else if (game.folderMissing) {
      if (noteText) {
        noteText.textContent =
          'A játék mappája nem található. Lehet, hogy áthelyezted vagy törölted.';
      }
      if (note) note.classList.remove('hidden');
    } else if (game.launcherMissing) {
      if (noteText) {
        noteText.textContent =
          'Az indító nem található. Nyisd meg a szerkesztőt, és válaszd ki újra az indítót.';
      }
      if (note) note.classList.remove('hidden');
    }

    const play = el('detail-play');
    if (play) {
      play.disabled = Boolean(game.running);
      play.innerHTML = game.running
        ? '<span class="play-icon"></span> Már fut'
        : '<span class="play-icon"></span> Játszás';
    }

    const fav = el('detail-fav');
    if (fav) fav.textContent = game.favorite ? 'Kedvencek közül ki' : 'Kedvencekhez';
  } catch (err) {
    console.error('[renderDetail] hiba:', err);
    toast('Hiba a részletek betöltésekor.', 'error');
  }
}

function openDetail(id) {
  const game = gameById(id);
  if (!game) {
    toast('Ez a játék már nem szerepel a listában.', 'error');
    return;
  }
  state.detailId = id;
  renderDetail(id);
  const detail = el('detail');
  if (detail) detail.classList.remove('hidden');
}

/* ---------------------------- editor ------------------------------------ */

function openEditor(id) {
  const game = gameById(id);
  if (!game) return;
  state.editorId = id;

  el('editor-title').textContent = 'Játék szerkesztése';
  el('edit-title').value = game.title;
  el('edit-kind').value = game.launch.kind || 'exe';
  el('edit-path').value = game.launch.pathDisplay || game.launch.path || '';
  el('edit-args').value = (game.launch.args || []).join(' ');
  el('edit-cwd').value = game.launch.cwd || '';
  el('edit-process').value = (game.processNames || []).join(', ');
  el('edit-elevated').checked = Boolean(game.launch.elevated);

  updateCoverPreview(game);
  closeOverlay('detail');
  el('editor').classList.remove('hidden');
}

function updateCoverPreview(game) {
  const preview = el('edit-cover-preview');
  if (game.coverUrl) {
    preview.innerHTML = `<img src="${esc(game.coverUrl)}" alt="" />`;
  } else {
    preview.textContent = initials(game.title);
  }
}

async function saveEditor() {
  const id = state.editorId;
  if (!id) return;

  const title = el('edit-title').value.trim();
  const path = el('edit-path').value.trim();
  if (!title) {
    toast('A név nem lehet üres.', 'error');
    return;
  }
  if (!path) {
    toast('Válassz indítót (exe vagy bat).', 'error');
    return;
  }

  const processNames = el('edit-process')
    .value.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const patch = {
    title,
    launch: {
      kind: el('edit-kind').value,
      path,
      args: splitArgs(el('edit-args').value),
      cwd: el('edit-cwd').value.trim(),
      elevated: el('edit-elevated').checked
    },
    processNames
  };

  const result = await api.updateGame(id, patch);
  if (!result.ok) {
    toast(result.message || 'Nem sikerült menteni.', 'error');
    return;
  }

  await refreshState();
  render();
  closeOverlay('editor');
  toast('Beállítások mentve.', 'success');
}

/* ---------------------------- settings ---------------------------------- */

function renderSettings() {
  const roots = state.data.settings.libraryRoots || [];
  el('root-list').innerHTML = roots
    .map(
      (root) => `
      <li class="root-item">
        <span class="path">${esc(root)}</span>
        <button data-root="${esc(root)}" title="Eltávolítás">Eltávolítás</button>
      </li>`
    )
    .join('');

  el('opt-autoscan').checked = state.data.settings.autoScanOnStart !== false;
  el('opt-skip-launchers').checked = state.data.settings.skipLauncherFolders !== false;
  el('settings-datadir').textContent = state.data.dataDir || '';
}

/* ---------------------------- steam import ------------------------------ */

function folderKey(folder) {
  return String(folder || '')
    .replace(/[\\/]+$/g, '')
    .toLowerCase();
}

function updateSteamImportSelection() {
  const boxes = [
    ...el('steam-import-list').querySelectorAll('input[data-appid]:not(:disabled)')
  ];
  const checked = boxes.filter((box) => box.checked);
  const selectAll = el('steam-import-all');

  selectAll.disabled = boxes.length === 0;
  selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;

  el('steam-import-count').textContent = `${checked.length} / ${boxes.length} kiválasztva`;

  const add = el('steam-import-add');
  add.disabled = checked.length === 0;
  add.textContent = checked.length
    ? `Kijelölt hozzáadása (${checked.length})`
    : 'Kijelölt hozzáadása';
}

function renderSteamImport(result) {
  state.steamGames = result.games;
  const existingKeys = new Set(games().map((game) => folderKey(game.folder)));
  const existingCount = result.games.filter((game) =>
    existingKeys.has(folderKey(game.folder))
  ).length;

  el('steam-import-sub').textContent = result.steamRoot
    ? `Steam könyvtár: ${result.steamRoot}. Válaszd ki, mely játékokat vedd fel; ` +
      'az indítót később a szerkesztőben állíthatod be.'
    : 'Válaszd ki, mely Steam játékokat vedd fel a könyvtárba.';

  el('steam-import-list').innerHTML = result.games.length
    ? result.games
        .map((game) => {
          const existing = existingKeys.has(folderKey(game.folder));
          return `
      <label class="steam-import-item ${existing ? 'is-existing' : ''}">
        <input type="checkbox" data-appid="${esc(game.appid)}" ${existing ? 'disabled' : ''} />
        <span class="steam-import-info">
          <span class="steam-import-name">${esc(game.name)}</span>
          <span class="steam-import-path">${esc(game.folder)}</span>
        </span>
        ${existing ? '<span class="steam-import-badge">már a könyvtárban</span>' : ''}
      </label>`;
        })
        .join('')
    : '<p class="steam-import-empty">Nem találtam importálható Steam játékot.</p>';

  updateSteamImportSelection();

  if (result.games.length && existingCount === result.games.length) {
    el('steam-import-count').textContent = 'Minden megtalált játék már a könyvtárban van.';
  }
}

async function openSteamImport(button) {
  if (button) button.disabled = true;
  try {
    let result = await api.steamImport();

    // Ha a Steam nincs az alapértelmezett helyen, a felhasználó kiválaszthatja
    // a steamapps mappát; a sikeres útvonalat elmentjük és újrapróbáljuk.
    if (!result.ok && result.needsManualPath) {
      toast(
        'Nem találtam a Steamöt az alapértelmezett helyen. Válaszd ki a Steam steamapps mappáját.',
        'info'
      );
      const picked = await api.pickDirectory();
      if (!picked.ok) return;

      const saved = await api.steamImportRoot(picked.path);
      if (!saved.ok) {
        toast(saved.message || 'Nem sikerült elmenteni a Steam útvonalat.', 'error');
        return;
      }

      result = await api.steamImport();
    }

    if (!result.ok) {
      toast(result.message || 'Steam import hiba.', 'error');
      return;
    }

    renderSteamImport(result);
    el('steam-import').classList.remove('hidden');
  } catch (err) {
    toast(`Steam import hiba: ${err?.message || err}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function addSteamSelection(button) {
  const selected = [
    ...el('steam-import-list').querySelectorAll('input[data-appid]:checked')
  ]
    .map((input) => state.steamGames.find((game) => game.appid === input.dataset.appid))
    .filter(Boolean);

  if (!selected.length) return;
  if (button) button.disabled = true;

  try {
    const result = await api.steamAddGames(selected);
    if (!result.ok) {
      toast(result.message || 'Nem sikerült hozzáadni a kijelölt játékokat.', 'error');
      return;
    }

    await refreshState();
    render();
    closeOverlay('steam-import');

    if (!result.added) {
      toast('A kijelölt játékok már szerepelnek a könyvtárban.', 'info');
      return;
    }

    const parts = [`${result.added} játék hozzáadva`];
    if (result.skipped) parts.push(`${result.skipped} kihagyva`);
    toast(`${parts.join(', ')}. Az indítót a szerkesztőben állíthatod be.`, 'success');
  } catch (err) {
    toast(`Import hiba: ${err?.message || err}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------------------------- overlays ---------------------------------- */

function closeOverlay(name) {
  el(name).classList.add('hidden');
  if (name === 'detail') state.detailId = null;
  if (name === 'editor') state.editorId = null;
  if (name === 'steam-import') state.steamGames = [];
  if (name === 'settings') render();
}

/* ---------------------------- actions ----------------------------------- */

async function launchGame(id, button) {
  if (button) button.disabled = true;
  try {
    const result = await api.launch(id);
    if (!result.ok) {
      toast(result.message || 'Nem sikerült elindítani a játékot.', 'error');
    } else if (result.alreadyRunning) {
      toast('Ez a játék már fut.', 'info');
    } else {
      const game = gameById(id);
      toast(`${game ? game.title : 'A játék'} indítása…`, 'success');
    }
  } catch (err) {
    toast(`Indítási hiba: ${err.message}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleFavorite(id) {
  const game = gameById(id);
  if (!game) return;
  await api.updateGame(id, { favorite: !game.favorite });
  await refreshState();
  render();
}

async function rescan(button) {
  if (button) button.classList.add('spin');
  try {
    const result = await api.scan();
    if (!result.ok) {
      toast(result.message || 'Az újraolvasás nem sikerült.', 'error');
      return;
    }
    await refreshState();
    render();
    const parts = [];
    if (result.added) parts.push(`${result.added} új`);
    if (result.updated) parts.push(`${result.updated} frissítve`);
    if (!parts.length) parts.push('nincs változás');
    toast(`Könyvtárak beolvasva – ${parts.join(', ')}.`, 'success');
    if (result.errors?.length) {
      toast(
        `Néhány könyvtár nem érhető el:\n${result.errors
          .map((err) => err.root)
          .join('\n')}`,
        'error'
      );
    }
  } finally {
    if (button) button.classList.remove('spin');
  }
}

async function addGame() {
  const result = await api.addFromFolder();
  if (!result.ok) {
    if (!result.canceled) toast(result.message || 'Nem sikerült hozzáadni.', 'error');
    return;
  }
  await refreshState();
  render();
  if (result.needsManual) {
    toast('Nem találtam indítót – állítsd be kézzel.', 'info');
    openEditor(result.id);
  } else {
    toast('Játék hozzáadva.', 'success');
  }
}

/* ---------------------------- events ------------------------------------ */

function bind() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderCount = 0; // animáció újra lejátszódása nézetváltáskor
      document
        .querySelectorAll('.nav-item[data-view]')
        .forEach((item) => item.classList.toggle('is-active', item === button));
      render();
    });
  });

  el('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderCount = 0; // animáció újra lejátszódása kereséskor
    render();
  });

  el('sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderCount = 0; // animáció újra lejátszódása rendezéskor
    render();
  });

  el('btn-refresh').addEventListener('click', (event) => rescan(event.currentTarget));
  el('empty-scan').addEventListener('click', (event) => rescan(event.currentTarget));
  el('btn-add').addEventListener('click', addGame);
  el('empty-add').addEventListener('click', addGame);
  el('btn-steam-import').addEventListener('click', (event) =>
    openSteamImport(event.currentTarget)
  );
  el('btn-settings').addEventListener('click', () => {
    renderSettings();
    el('settings').classList.remove('hidden');
  });

  el('grid').addEventListener('click', (event) => {
    const card = event.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const action = event.target.closest('[data-action]')?.dataset.action;

    if (action === 'play') {
      launchGame(id, event.target.closest('[data-action]'));
      return;
    }
    if (action === 'favorite') {
      toggleFavorite(id);
      return;
    }
    openDetail(id);
  });

  el('grid').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.card');
    if (!card) return;
    event.preventDefault();
    openDetail(card.dataset.id);
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeOverlay(button.dataset.close));
  });

  document.querySelectorAll('.overlay').forEach((overlay) => {
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeOverlay(overlay.id);
    });
  });

  // Részletek
  el('detail-play').addEventListener('click', async (event) => {
    if (state.detailId) await launchGame(state.detailId, event.currentTarget);
  });
  el('detail-fav').addEventListener('click', () => {
    if (state.detailId) toggleFavorite(state.detailId);
  });
  el('detail-folder').addEventListener('click', async () => {
    if (!state.detailId) return;
    const result = await api.openFolder(state.detailId);
    if (!result.ok) toast(result.message || 'Nem sikerült megnyitni a mappát.', 'error');
    else if (result.note) toast(result.note, 'info');
  });
  el('detail-edit').addEventListener('click', () => {
    if (state.detailId) openEditor(state.detailId);
  });
  el('detail-fix-name').addEventListener('click', async () => {
    const game = gameById(state.detailId);
    if (!game) return;

    const parts = String(game.folderDisplay).split('\\');
    const last = parts.pop();
    const fixed = last.replace(/[. ]+$/g, '') || 'Game';

    const ok = window.confirm(
      'A mappa neve pontra végződik, ami miatt a játék nem tud elindulni.\n\n' +
        `${last}  →  ${fixed}\n\n` +
        'Csak a mappa nevét változtatom meg, a játékfájlok érintetlenek. Folytatod?'
    );
    if (!ok) return;

    const result = await api.fixFolderName(game.id);
    if (!result.ok) {
      toast(result.message || 'Nem sikerült átnevezni a mappát.', 'error');
      return;
    }
    await refreshState();
    render();
    toast(`Mappa átnevezve: ${fixed}`, 'success');
  });
  el('detail-remove').addEventListener('click', async () => {
    const game = gameById(state.detailId);
    if (!game) return;
    if (!window.confirm(`Eltávolítod a listából: ${game.title}?`)) return;
    await api.removeGame(game.id);
    await refreshState();
    closeOverlay('detail');
    render();
    toast('Játék eltávolítva a listából.', 'success');
  });

  // Szerkesztő
  el('editor-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveEditor();
  });
  el('btn-browse-exe').addEventListener('click', async () => {
    const result = await api.pickExe();
    if (result.ok) el('edit-path').value = result.path;
  });
  el('btn-browse-cwd').addEventListener('click', async () => {
    const result = await api.pickDirectory();
    if (result.ok) el('edit-cwd').value = result.path;
  });
  el('btn-cover').addEventListener('click', async () => {
    if (!state.editorId) return;
    const result = await api.pickCover(state.editorId);
    if (!result.ok) {
      if (!result.canceled) toast(result.message || 'Nem sikerült beállítani a borítót.', 'error');
      return;
    }
    await refreshState();
    const game = gameById(state.editorId);
    if (game) updateCoverPreview(game);
    render();
  });
  el('btn-cover-reset').addEventListener('click', async () => {
    if (!state.editorId) return;
    await api.resetCover(state.editorId);
    await refreshState();
    const game = gameById(state.editorId);
    if (game) updateCoverPreview(game);
    render();
  });
  el('btn-cover-rescan').addEventListener('click', async (event) => {
    if (!state.editorId) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api.rescanCover(state.editorId);
      if (!result.ok) {
        toast(result.message || 'Nem találtam borítót a játék mappájában.', 'error');
        return;
      }
      await refreshState();
      const game = gameById(state.editorId);
      if (game) updateCoverPreview(game);
      render();
      toast('Borító frissítve a játék mappájából.', 'success');
    } catch (err) {
      toast(`Borítókeresési hiba: ${err.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  });

  // Beállítások
  el('btn-add-root').addEventListener('click', async () => {
    const result = await api.addRoot();
    if (!result.ok) {
      if (!result.canceled) toast(result.message || 'Nem sikerült hozzáadni.', 'error');
      return;
    }
    await refreshState();
    renderSettings();
    render();
    toast(
      result.added ? `Könyvtár hozzáadva – ${result.added} új játék.` : 'Könyvtár hozzáadva.',
      'success'
    );
  });
  el('btn-scan-settings').addEventListener('click', async (event) => {
    await rescan(event.currentTarget);
    renderSettings();
  });
  el('root-list').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-root]');
    if (!button) return;
    const root = button.dataset.root;
    if (!window.confirm(`Eltávolítod ezt a könyvtárat?\n${root}`)) return;
    const result = await api.removeRoot(root);
    if (!result.ok) {
      toast(result.message || 'Nem sikerült eltávolítani.', 'error');
      return;
    }
    await refreshState();
    renderSettings();
    render();
    toast('Könyvtár eltávolítva.', 'success');
  });
  el('opt-autoscan').addEventListener('change', async (event) => {
    await api.updateSettings({ autoScanOnStart: event.target.checked });
  });
  el('opt-skip-launchers').addEventListener('change', async (event) => {
    await api.updateSettings({ skipLauncherFolders: event.target.checked });
    toast('Változás mentve. Az újraolvasás után érvényesül.', 'info');
  });
  el('btn-open-data').addEventListener('click', async () => {
    const result = await api.openDataFolder();
    if (!result.ok) toast(result.message || 'Nem sikerült megnyitni.', 'error');
  });

  // Steam import
  el('steam-import-list').addEventListener('change', updateSteamImportSelection);
  el('steam-import-all').addEventListener('change', (event) => {
    const boxes = [
      ...el('steam-import-list').querySelectorAll('input[data-appid]:not(:disabled)')
    ];
    boxes.forEach((box) => {
      box.checked = event.target.checked;
    });
    updateSteamImportSelection();
  });
  el('steam-import-add').addEventListener('click', (event) =>
    addSteamSelection(event.currentTarget)
  );

  // Billentyűk
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const open = [...document.querySelectorAll('.overlay:not(.hidden)')].pop();
      if (open) closeOverlay(open.id);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      el('search').focus();
      el('search').select();
    }
  });
}

async function init() {
  if (!api) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:Segoe UI">A preload nem töltődött be, az app nem tud működni.</p>';
    return;
  }

  await refreshState();
  bind();
  el('sort').value = state.sort;
  render();

  api.onState((next) => {
    state.data = next;
    render();
    if (!el('settings').classList.contains('hidden')) renderSettings();
  });

  api.onPlaytime(({ id, playtimeSec }) => {
    const game = gameById(id);
    if (game) game.playtimeSec = playtimeSec;

    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .card-meta`);
    if (card && game) {
      card.textContent = `most fut`;
    }
    if (state.detailId === id) {
      el('detail-time').textContent = 'most játszik';
      el('detail-sub').textContent = `${formatPlaytime(playtimeSec)} · most`;
    }
    if (!el('settings').classList.contains('hidden')) renderSettings();
  });
}

init().catch((err) => {
  console.error(err);
  toast(`Váratlan hiba: ${err.message}`, 'error');
});
