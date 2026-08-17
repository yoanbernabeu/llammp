const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  rawAudio: process.env.F4_RAW_AUDIO === '1',
  report: (r) => ipcRenderer.send('report', r),
  event: (m) => ipcRenderer.send('event', m),
  verdict: (v) => ipcRenderer.send('verdict', v),
})
