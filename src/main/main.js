'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');

const { LibraryStore } = require('./library');
const { registerIpc } = require('./ipc');

// Az adatok mindig ide kerülnek, függetlenül attól, hogy fejlesztői
// vagy portable verziót futtatsz.
app.setName('GameHub');
app.setPath('userData', path.join(app.getPath('appData'), 'GameHub'));
app.setAppUserModelId('hu.beregszaszi.gamehub');

// A borítók saját protokollon keresztül érhetők el, hogy a renderer
// ne kapjon közvetlen fájlrendszer-hozzáférést.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cover',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let hub = null;
let library = null;

function iconPath() {
  const file = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  return fs.existsSync(file) ? file : undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e13',
    title: 'GameHub',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fejlesztői segédlet: `electron . --screenshot=utvonal.png` képernyőképet
  // készít és kilép. Az automatikus ellenőrzéshez használjuk.
  const shotArg = process.argv.find((arg) => arg.startsWith('--screenshot='));
  if (shotArg) {
    mainWindow.once('ready-to-show', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(shotArg.slice('--screenshot='.length), image.toPNG());
          console.log('[dev] képernyőkép mentve');
        } catch (err) {
          console.error('[dev] képernyőkép hiba:', err.message);
        }
        app.quit();
      }, 1200);
    });
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;

  library = new LibraryStore(app.getPath('userData'));
  library.load();

  const coverDir = library.coverDir;
  protocol.handle('cover', (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(coverDir, relative);
      if (!file.toLowerCase().startsWith(path.resolve(coverDir).toLowerCase())) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(file)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).toString());
    } catch (err) {
      console.error('[cover] hiba:', err.message);
      return new Response('Error', { status: 500 });
    }
  });

  Menu.setApplicationMenu(null);

  hub = registerIpc({ library, getWindow: () => mainWindow });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try {
    hub?.stop();
    library?.saveNow();
  } catch (err) {
    console.error('[app] mentési hiba kilépéskor:', err.message);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[app] kezeletlen hiba:', err);
});
