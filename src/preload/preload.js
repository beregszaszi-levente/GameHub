'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('gamehub', {
  getState: () => ipcRenderer.invoke('state:get'),

  scan: () => ipcRenderer.invoke('library:scan'),

  launch: (id) => ipcRenderer.invoke('game:launch', id),

  updateGame: (id, patch) => ipcRenderer.invoke('game:update', id, patch),
  addFromFolder: () => ipcRenderer.invoke('game:addFromFolder'),
  removeGame: (id) => ipcRenderer.invoke('game:remove', id),
  openFolder: (id) => ipcRenderer.invoke('game:openFolder', id),

  pickCover: (id) => ipcRenderer.invoke('cover:pick', id),
  resetCover: (id) => ipcRenderer.invoke('cover:reset', id),
  rescanCover: (id) => ipcRenderer.invoke('cover:rescan', id),
  fixFolderName: (id) => ipcRenderer.invoke('game:fixFolderName', id),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  addRoot: () => ipcRenderer.invoke('settings:addRoot'),
  removeRoot: (root) => ipcRenderer.invoke('settings:removeRoot', root),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),

  steamImport: () => ipcRenderer.invoke('steam:import'),
  steamImportRoot: (root) => ipcRenderer.invoke('steam:importRoot', root),
  steamAddGames: (games) => ipcRenderer.invoke('steam:addGames', games),

  pickExe: () => ipcRenderer.invoke('dialog:pickExe'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  onState: (callback) => subscribe('state:changed', callback),
  onPlaytime: (callback) => subscribe('playtime:tick', callback)
});
