const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onState: (callback) => {
    ipcRenderer.on('state-update', (_event, data) => callback(data));
  },
  onSpeech: (callback) => {
    ipcRenderer.on('speech', (_event, data) => callback(data));
  },
  onWalkState: (callback) => {
    ipcRenderer.on('walk-state', (_event, data) => callback(data));
  },
  onLanded: (callback) => {
    ipcRenderer.on('landed', () => callback());
  },
  onTaskAction: (callback) => {
    ipcRenderer.on('task-action', (_event, data) => callback(data));
  },
  onEnemySpawn: (callback) => {
    ipcRenderer.on('enemy-spawn', () => callback());
  },
  onEnemyClear: (callback) => {
    ipcRenderer.on('enemy-clear', () => callback());
  },
  onSystemLoad: (callback) => {
    ipcRenderer.on('system-load', (_event, data) => callback(data));
  },
  requestQuit: () => ipcRenderer.send('pet:quit'),
  requestReset: () => ipcRenderer.send('pet:reset'),
  requestContextMenu: () => ipcRenderer.send('pet:context-menu'),
  requestReady: () => ipcRenderer.send('pet:ready'),
});
