const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Named commands only — the renderer never gets raw IPC access.
contextBridge.exposeInMainWorld('llammp', {
  // Playback commands, forwarded to Music.app through the sidecar
  send: (cmd) => ipcRenderer.send('command', cmd),

  // Call once listeners are wired; the main process replies with the current state.
  ready: () => ipcRenderer.send('renderer-ready'),

  onEvent: (fn) => ipcRenderer.on('music-event', (_e, payload) => fn(payload)),
  onSidecarError: (fn) => ipcRenderer.on('sidecar-error', (_e, payload) => fn(payload)),

  // Skins
  loadSkin: (name) => ipcRenderer.invoke('load-skin', name),
  listSkins: () => ipcRenderer.invoke('list-skins'),
  cycleSkin: () => ipcRenderer.invoke('cycle-skin'),
  onSkinChanged: (fn) => ipcRenderer.on('skin-changed', (_e, name) => fn(name)),
  chooseSkinFile: () => ipcRenderer.invoke('choose-skin-file'),
  // A File's disk path is no longer reachable from the renderer; webUtils is the only
  // way, and it has to live here.
  addSkinFromDrop: (file) => ipcRenderer.invoke('add-skin', webUtils.getPathForFile(file)),

  audioPermission: () => ipcRenderer.invoke('audio-permission'),
  openSettings: (pane) => ipcRenderer.send('open-settings', pane),
  showOnboarding: () => ipcRenderer.send('show-onboarding'),
  restartApp: () => ipcRenderer.send('restart-app'),
  closeOnboarding: () => ipcRenderer.send('close-onboarding'),

  // Frameless windows are moved by hand. Deltas are cumulative from the start of the
  // gesture, not incremental — that is what lets the main process snap without drift.
  beginDrag: (target) => ipcRenderer.send('window-drag-begin', { target }),
  dragWindow: (dx, dy) => ipcRenderer.send('window-drag', { dx, dy }),
  endDrag: () => ipcRenderer.send('window-drag-end'),

  contextMenu: (target) => ipcRenderer.send('context-menu', { target }),
  togglePlaylist: () => ipcRenderer.invoke('toggle-playlist'),
  toggleEq: () => ipcRenderer.invoke('toggle-eq'),
  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize')
})
