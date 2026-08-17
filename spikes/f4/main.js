// M0/F4 spike jetable : la capture loopback d'Electron produit-elle du vrai signal ?
// Moitie main process de F4.1 : sans setDisplayMediaRequestHandler + audio:'loopback',
// le renderer obtient une piste audio de silence pur.

const { app, BrowserWindow, session, desktopCapturer, ipcMain, systemPreferences } = require('electron')
const path = require('node:path')

const fs = require('node:fs')

// Lancee par `open`, l app packagee n a plus de console attachee : sans ce doublon
// fichier, le test de la voie de production est aveugle.
const LOG_FILE = process.env.F4_LOG_FILE || null
const log = (...a) => {
  const line = a.map(x => typeof x === 'string' ? x : String(x)).join(' ')
  console.log(line)
  if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, line + '\n') } catch {} }
}

// macOS 14.2+ / Electron 39+ : Chromium capture l audio via CoreAudio Tap, qui exige
// NSAudioCaptureUsageDescription dans l Info.plist (et dans celui du programme parent
// en dev). Sans la cle, le flux audio est mort sans erreur. Ce switch force l ancien
// chemin, adosse a l autorisation "Enregistrement de l ecran" deja accordee.
// Pilote par la variable d env pour pouvoir comparer les deux chemins.
if (process.env.F4_LEGACY_AUDIO === '1') {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
  log('[diag] switch applique : --disable-features=MacCatapLoopbackAudioForScreenShare')
}

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 420,
    title: 'F4 loopback spike',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile('index.html')
}

app.whenReady().then(async () => {
  log('=== SPIKE F4 — capture loopback ===')
  log('Electron', process.versions.electron, '| Chromium', process.versions.chrome)
  log('Plateforme', process.platform, process.arch)

  // --- Diagnostic TCC : une piste morte-nee vient souvent d une autorisation absente ---
  log('[diag] getMediaAccessStatus("screen") =', systemPreferences.getMediaAccessStatus('screen'))
  log('[diag] getMediaAccessStatus("microphone") =', systemPreferences.getMediaAccessStatus('microphone'))
  log('[diag] executable =', app.getPath('exe'))
  try {
    const srcs = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 32, height: 32 },
    })
    for (const s of srcs) {
      // Sans autorisation, macOS renvoie des noms generiques et des vignettes vides.
      log(`[diag] source id=${s.id} name="${s.name}" thumbEmpty=${s.thumbnail.isEmpty()} size=${JSON.stringify(s.thumbnail.getSize())}`)
    }
  } catch (e) {
    log('[diag] getSources a echoue :', e.message)
  }
  log('')

  // --- Moitie main process de F4.1 ---
  try {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      log('[main] setDisplayMediaRequestHandler appele')
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        })
        log('[main] sources ecran disponibles :', sources.length)
        if (!sources.length) {
          log('[main] AUCUNE source ecran -> callback vide')
          callback({})
          return
        }
        // audio:'loopback' = son systeme. C'est le point teste.
        callback({ video: sources[0], audio: 'loopback' })
        log('[main] callback({video: <ecran>, audio: "loopback"}) emis')
      } catch (e) {
        log('[main] ERREUR dans le handler :', e.message)
        callback({})
      }
    }, { useSystemPicker: false })
    log('[main] handler installe OK')
  } catch (e) {
    log('[main] ECHEC installation handler :', e.message)
  }

  ipcMain.on('report', (_e, r) => {
    log(`[t=${String(r.t).padStart(5)}ms] phase=${r.phase.padEnd(12)} ` +
        `rms=${r.rms.toFixed(5)}  peak=${r.peak.toFixed(5)}  ` +
        `bandes=[${r.bands.map(b => String(b).padStart(3)).join(' ')}]`)
  })

  ipcMain.on('event', (_e, m) => log('[renderer]', m))

  ipcMain.on('verdict', (_e, v) => {
    log('')
    log('================= VERDICT F4 =================')
    for (const line of v.lines) log(line)
    log('=============================================')
    setTimeout(() => app.quit(), 500)
  })

  createWindow()
})

app.on('window-all-closed', () => app.quit())

// Filet de securite : ne jamais laisser le spike tourner indefiniment
setTimeout(() => {
  log('[main] timeout global atteint, arret')
  app.quit()
}, 60000)
