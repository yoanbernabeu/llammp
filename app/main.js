// Llammp main process: frameless windows, Swift sidecar supervision, and the loopback
// capture handler that feeds the visualizer.

const { app, BrowserWindow, Menu, dialog, shell, session, desktopCapturer, ipcMain, systemPreferences } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { loadSkin } = require('./skin/loader')

// Winamp 2 window geometry. Every skin is drawn for exactly these pixels.
const MAIN_W = 275
const MAIN_H = 116
const PL_W = 275
const PL_H = 232

// Once packaged the app lives inside app.asar: skins come in through --extra-resource,
// and the sidecar must be unpacked since a binary inside an asar archive is not
// executable.
const SKINS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'skins')
  : path.join(__dirname, '..', 'assets', 'skins')

const BIN_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin')
  : path.join(__dirname, 'bin')

// Personal skin folder, outside the bundle. Bundled skins are wiped on every packaging
// run, so user skins live here and survive updates. Takes precedence on name clash.
const USER_SKINS_DIR = path.join(app.getPath('userData'), 'skins')

const DEFAULT_SKIN = process.env.LLAMMP_SKIN || 'base-2.91.wsz'

let win = null
let playlistWin = null
let eqWin = null
let onboardingWin = null
let sidecar = null
let currentSkin = DEFAULT_SKIN

// Last known Apple Events status, as reported by the sidecar.
let appleEventsStatus = 'unknown'

// --- Windows ---------------------------------------------------------------

/**
 * macOS grows these frameless windows shortly after load (275x116 becomes 275x144),
 * leaving transparent padding under the skin. That padding also breaks docking: two
 * visually adjacent windows are no longer adjacent to the system. Clamping both bounds
 * is the only reliable fix; the viewport needs a separate resync after load.
 */
function lockSize (w, width, height) {
  w.setContentSize(width, height)
  w.setMinimumSize(width, height)
  w.setMaximumSize(width, height)
  w.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!w.isDestroyed()) w.setContentSize(width, height)
    }, 300)
  })
}

const baseWindowOptions = (width, height) => ({
  width,
  height,
  frame: false,
  resizable: false,
  transparent: true,
  backgroundColor: '#00000000',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
})

function createWindow () {
  win = new BrowserWindow({
    ...baseWindowOptions(MAIN_W, MAIN_H),
    title: 'Llammp',
    maximizable: false,
    fullscreenable: false
  })
  lockSize(win, MAIN_W, MAIN_H)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('closed', () => { win = null })
}

// Secondary windows are hidden rather than destroyed: recreating them would mean
// reloading the skin and re-requesting the queue on every open.
function createPlaylistWindow () {
  if (playlistWin && !playlistWin.isDestroyed()) return playlistWin

  const anchor = win ? rectOf(win) : { x: 100, y: 100, h: MAIN_H }
  playlistWin = new BrowserWindow({
    ...baseWindowOptions(PL_W, PL_H),
    title: 'Llammp — Playlist',
    x: anchor.x,
    y: anchor.y + anchor.h,
    show: false
  })
  lockSize(playlistWin, PL_W, PL_H)
  playlistWin.loadFile(path.join(__dirname, 'renderer', 'playlist.html'))
  playlistWin.on('closed', () => { playlistWin = null })
  return playlistWin
}

function createEqWindow () {
  if (eqWin && !eqWin.isDestroyed()) return eqWin

  const anchor = win ? rectOf(win) : { x: 100, y: 100, h: MAIN_H }
  eqWin = new BrowserWindow({
    ...baseWindowOptions(MAIN_W, MAIN_H),
    title: 'Llammp — Equalizer',
    x: anchor.x,
    y: anchor.y + anchor.h,
    show: false
  })
  lockSize(eqWin, MAIN_W, MAIN_H)
  eqWin.loadFile(path.join(__dirname, 'renderer', 'eq.html'))
  eqWin.on('closed', () => { eqWin = null })
  return eqWin
}

/**
 * First-run permission screen. A normal, resizable window rather than something drawn
 * inside the 275x116 skin: two permissions cannot be explained in that space, and this
 * screen is the one moment where clarity beats fidelity.
 */
function createOnboardingWindow () {
  if (onboardingWin && !onboardingWin.isDestroyed()) return onboardingWin

  onboardingWin = new BrowserWindow({
    width: 460,
    height: 470,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Llammp — Permissions',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1c1f2b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  onboardingWin.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'))
  onboardingWin.once('ready-to-show', () => onboardingWin.show())
  onboardingWin.on('closed', () => { onboardingWin = null })
  return onboardingWin
}

// Opened automatically at most once per run; reopening is then a menu action. Nothing is
// more irritating than a window that keeps coming back.
let onboardingAutoShown = false

/** Shown only when something is actually missing — never in the way once set up. */
function showOnboardingIfNeeded () {
  if (onboardingAutoShown) return
  const screenMissing = systemPreferences.getMediaAccessStatus('screen') !== 'granted'
  // "music_not_running" tells us nothing about consent, so it is not treated as missing.
  const aeMissing = appleEventsStatus === 'denied' || appleEventsStatus === 'undetermined'
  if (!screenMissing && !aeMissing) return
  onboardingAutoShown = true
  createOnboardingWindow()
}

// --- Sidecar ---------------------------------------------------------------

function startSidecar () {
  const bin = path.join(BIN_DIR, 'llammp-sidecar')
  if (!fs.existsSync(bin)) {
    sendToRenderer('sidecar-error', { message: 'sidecar binary missing — run sidecar/build.sh' })
    return
  }

  sidecar = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })

  // One JSON object per line. A stdout chunk can split a line in half, so buffer until
  // the newline instead of parsing chunk by chunk.
  let buffer = ''
  sidecar.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const event = JSON.parse(line)
        // Surface sidecar diagnostics: without them a denied Apple Events prompt looks
        // exactly like "Music.app is closed".
        if (['log', 'unavailable', 'permission'].includes(event.type)) console.log('[sidecar]', line)
        if (event.type === 'permission') {
          const changed = appleEventsStatus !== event.appleEvents
          appleEventsStatus = event.appleEvents
          // Close the screen by itself once everything is granted, instead of leaving a
          // window the user has to dismiss.
          if (changed && event.appleEvents === 'granted') closeOnboardingIfSatisfied()
          showOnboardingIfNeeded()
        }
        sendToRenderer('music-event', event)
      } catch {
        console.error('[sidecar] unreadable line:', line.slice(0, 200))
      }
    }
  })

  sidecar.stderr.on('data', (d) => console.error('[sidecar:err]', d.toString().trim()))

  sidecar.on('exit', (code) => {
    console.error('[sidecar] exited, code', code)
    sidecar = null
    sendToRenderer('sidecar-error', { message: `sidecar stopped (code ${code})` })
  })
}

function sendCommand (cmd) {
  if (!sidecar || sidecar.killed) return
  try {
    sidecar.stdin.write(JSON.stringify(cmd) + '\n')
  } catch (e) {
    console.error('[sidecar] write failed:', e.message)
  }
}

// All three windows, hidden ones included: a hidden window must already carry the right
// skin when reopened.
function sendToRenderer (channel, payload) {
  for (const w of [win, playlistWin, eqWin, onboardingWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function closeOnboardingIfSatisfied () {
  if (!onboardingWin || onboardingWin.isDestroyed()) return
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return
  if (appleEventsStatus !== 'granted') return
  // Let the user see the last checkmark turn green before the window goes away.
  setTimeout(() => {
    if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close()
  }, 1200)
}

// --- Loopback capture ------------------------------------------------------

function installDisplayMediaHandler () {
  // Electron's callback takes a stream descriptor, not a Node error-first argument.
  /* eslint-disable n/no-callback-literal */
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      })
      if (!sources.length) return callback({})
      // A video source is mandatory to get an audio track; the renderer stops it right
      // after acquisition and the audio survives.
      callback({ video: sources[0], audio: 'loopback' })
    } catch (e) {
      console.error('[loopback] handler failed:', e.message)
      callback({})
    }
  }, { useSystemPicker: false })
  /* eslint-enable n/no-callback-literal */
}

// --- Skins -----------------------------------------------------------------

function ensureUserSkinsDir () {
  try {
    fs.mkdirSync(USER_SKINS_DIR, { recursive: true })
  } catch (e) {
    console.error('[skins] cannot create user folder:', e.message)
  }
}

function resolveSkinPath (fileName) {
  const base = path.basename(fileName || DEFAULT_SKIN)
  const userPath = path.join(USER_SKINS_DIR, base)
  return fs.existsSync(userPath) ? userPath : path.join(SKINS_DIR, base)
}

function listSkinsIn (dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wsz'))
  } catch {
    return []
  }
}

function listSkins () {
  return [...new Set([...listSkinsIn(SKINS_DIR), ...listSkinsIn(USER_SKINS_DIR)])].sort()
}

/**
 * Copy a .wsz into the user folder and activate it. The file is parsed before being
 * copied, otherwise a broken archive would sit in the menu and fail on every open.
 */
async function installSkin (sourcePath) {
  if (!sourcePath || !/\.wsz$/i.test(sourcePath)) {
    return { ok: false, error: 'Not a .wsz skin file' }
  }
  try {
    await loadSkin(sourcePath)
  } catch (e) {
    return { ok: false, error: `Unreadable skin: ${e.message}` }
  }

  ensureUserSkinsDir()
  const base = path.basename(sourcePath)
  const dest = path.join(USER_SKINS_DIR, base)
  try {
    if (path.resolve(sourcePath) !== path.resolve(dest)) fs.copyFileSync(sourcePath, dest)
  } catch (e) {
    return { ok: false, error: `Copy failed: ${e.message}` }
  }

  currentSkin = base
  sendToRenderer('skin-changed', base)
  return { ok: true, name: base }
}

// --- Window docking --------------------------------------------------------

const SNAP = 12 // magnet distance
const TOUCH_TOL = 2 // slack when deciding two windows are already joined

function windowFor (target) {
  if (target === 'playlist') return playlistWin
  if (target === 'eq') return eqWin
  return win
}

function visibleWindows () {
  return [win, playlistWin, eqWin].filter((w) => w && !w.isDestroyed() && w.isVisible())
}

// Content bounds, not getSize(): see lockSize() above for why the frame lies.
function rectOf (w) {
  const b = w.getContentBounds()
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}

function moveContentTo (w, x, y) {
  const b = w.getContentBounds()
  w.setContentBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height })
}

function isAttached (a, b) {
  const A = rectOf(a)
  const B = rectOf(b)
  const overlapX = A.x < B.x + B.w && B.x < A.x + A.w
  const overlapY = A.y < B.y + B.h && B.y < A.y + A.h
  const touchV = Math.abs((A.y + A.h) - B.y) <= TOUCH_TOL || Math.abs((B.y + B.h) - A.y) <= TOUCH_TOL
  const touchH = Math.abs((A.x + A.w) - B.x) <= TOUCH_TOL || Math.abs((B.x + B.w) - A.x) <= TOUCH_TOL
  return (touchV && overlapX) || (touchH && overlapY)
}

// Transitive: an EQ window stuck under the playlist, itself under the main window,
// follows when the whole stack moves.
function attachedGroup (origin) {
  const pool = visibleWindows()
  const group = [origin]
  let added = true
  while (added) {
    added = false
    for (const candidate of pool) {
      if (group.includes(candidate)) continue
      if (group.some((member) => isAttached(member, candidate))) {
        group.push(candidate)
        added = true
      }
    }
  }
  return group
}

function snapRect (rect, others) {
  let { x, y } = rect
  for (const o of others) {
    const O = rectOf(o)
    const nearX = x < O.x + O.w + SNAP && O.x < x + rect.w + SNAP
    const nearY = y < O.y + O.h + SNAP && O.y < y + rect.h + SNAP

    if (nearX) {
      if (Math.abs(y - (O.y + O.h)) <= SNAP) y = O.y + O.h
      else if (Math.abs((y + rect.h) - O.y) <= SNAP) y = O.y - rect.h
    }
    if (nearY) {
      if (Math.abs(x - (O.x + O.w)) <= SNAP) x = O.x + O.w
      else if (Math.abs((x + rect.w) - O.x) <= SNAP) x = O.x - rect.w
    }
    // Edge alignment, so stacked windows stay flush.
    if (nearX && Math.abs(x - O.x) <= SNAP) x = O.x
    if (nearY && Math.abs(y - O.y) <= SNAP) y = O.y
  }
  return { x, y }
}

// Start positions are frozen on mousedown. Applying cumulative deltas to a fixed origin
// avoids the drift that accumulating deltas onto an already-snapped position would cause.
let dragState = null

// A secondary window moved by hand stops auto-docking under the main one.
const detached = { playlist: false, eq: false }

function dockUnderMain (w, kind) {
  if (detached[kind] || !win || win.isDestroyed()) return
  const m = rectOf(win)
  moveContentTo(w, m.x, m.y + m.h)
}

function beginDrag (target) {
  const w = windowFor(target)
  if (!w || w.isDestroyed()) return

  // Dragging the main window carries the whole attached group; dragging a secondary one
  // moves only itself, which is how it detaches.
  const group = target === 'main' ? attachedGroup(w) : [w]
  if (target === 'playlist' || target === 'eq') detached[target] = true

  dragState = {
    members: group.map((m) => {
      const r = rectOf(m)
      return { win: m, origin: { x: r.x, y: r.y } }
    }),
    outsiders: visibleWindows().filter((o) => !group.includes(o))
  }
}

function dragBy (dx, dy) {
  if (!dragState) return
  const lead = dragState.members[0]
  if (!lead.win || lead.win.isDestroyed()) return

  const size = rectOf(lead.win)
  const free = { x: lead.origin.x + dx, y: lead.origin.y + dy, w: size.w, h: size.h }
  const snapped = snapRect(free, dragState.outsiders)

  const shiftX = snapped.x - lead.origin.x
  const shiftY = snapped.y - lead.origin.y
  for (const m of dragState.members) {
    if (!m.win || m.win.isDestroyed()) continue
    moveContentTo(m.win, m.origin.x + shiftX, m.origin.y + shiftY)
  }
}

// --- Secondary windows -----------------------------------------------------

function togglePlaylist () {
  const w = createPlaylistWindow()
  if (w.isVisible()) {
    w.hide()
    return false
  }
  dockUnderMain(w, 'playlist')
  w.show()
  // Already loaded: ask for the queue now. Otherwise the renderer will ask for itself
  // once ready — sending now would land before any listener exists.
  if (!w.webContents.isLoading()) sendCommand({ cmd: 'refresh' })
  return true
}

function toggleEq () {
  const w = createEqWindow()
  if (w.isVisible()) {
    w.hide()
    return false
  }
  if (!detached.eq) {
    const anchor = (playlistWin && !playlistWin.isDestroyed() && playlistWin.isVisible())
      ? playlistWin
      : win
    if (anchor && !anchor.isDestroyed()) {
      const a = rectOf(anchor)
      moveContentTo(w, a.x, a.y + a.h)
    }
  }
  w.show()
  return true
}

// --- Context menu ----------------------------------------------------------

async function pickAndInstallSkin (parent) {
  const picked = await dialog.showOpenDialog(parent, {
    title: 'Add a Winamp skin',
    filters: [{ name: 'Winamp skins', extensions: ['wsz'] }],
    properties: ['openFile']
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }

  const result = await installSkin(picked.filePaths[0])
  if (!result.ok && result.error) {
    dialog.showMessageBox(parent, { type: 'warning', message: result.error })
  }
  return result
}

function popupContextMenu (target) {
  const skins = listSkins()
  const parent = windowFor(target)
  const hasSkin = skins.length > 0

  Menu.buildFromTemplate([
    {
      label: 'Skin',
      submenu: hasSkin
        ? skins.map((file) => ({
          label: file.replace(/\.wsz$/i, ''),
          type: 'radio',
          checked: file === currentSkin,
          click: () => {
            currentSkin = file
            sendToRenderer('skin-changed', file)
          }
        }))
        : [{ label: 'No skin installed', enabled: false }]
    },
    { label: 'Add a skin…', click: () => pickAndInstallSkin(parent) },
    {
      label: 'Open skins folder',
      click: () => {
        ensureUserSkinsDir()
        shell.openPath(USER_SKINS_DIR)
      }
    },
    { type: 'separator' },
    {
      label: 'Playlist',
      type: 'checkbox',
      enabled: hasSkin,
      checked: !!(playlistWin && !playlistWin.isDestroyed() && playlistWin.isVisible()),
      click: () => togglePlaylist()
    },
    {
      // Music.app exposes no writable equalizer, so this window is decorative.
      label: 'Equalizer (decorative)',
      type: 'checkbox',
      enabled: hasSkin,
      checked: !!(eqWin && !eqWin.isDestroyed() && eqWin.isVisible()),
      click: () => toggleEq()
    },
    { type: 'separator' },
    { label: 'Permissions…', click: () => createOnboardingWindow() },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: !!(win && win.isAlwaysOnTop()),
      click: () => {
        const next = !win.isAlwaysOnTop()
        for (const w of visibleWindows()) w.setAlwaysOnTop(next)
      }
    },
    { type: 'separator' },
    { label: 'Quit Llammp', click: () => app.quit() }
  ]).popup({ window: parent })
}

// --- IPC -------------------------------------------------------------------

ipcMain.on('command', (_e, cmd) => sendCommand(cmd))

// A renderer reports that its listeners are wired. loadFile() is async and ES modules
// run later still, so state pushed at show() time would be lost — this was why the
// playlist came up empty on first open.
ipcMain.on('renderer-ready', () => sendCommand({ cmd: 'refresh' }))

// Returns null rather than throwing: a missing or malformed skin must leave the app
// usable, showing the welcome screen instead of an unhandled rejection.
ipcMain.handle('load-skin', async (_e, fileName) => {
  const target = resolveSkinPath(fileName)
  if (!fs.existsSync(target)) return null
  try {
    return await loadSkin(target)
  } catch (e) {
    console.error('[skins] cannot read', path.basename(target), '—', e.message)
    return null
  }
})
ipcMain.handle('list-skins', async () => listSkins())
ipcMain.handle('add-skin', async (_e, filePath) => installSkin(filePath))
ipcMain.handle('choose-skin-file', async () => pickAndInstallSkin(win))

ipcMain.handle('cycle-skin', async () => {
  const skins = listSkins()
  if (!skins.length) return currentSkin
  currentSkin = skins[(skins.indexOf(currentSkin) + 1) % skins.length]
  sendToRenderer('skin-changed', currentSkin)
  return currentSkin
})

ipcMain.handle('audio-permission', async () => ({
  screen: systemPreferences.getMediaAccessStatus('screen'),
  packaged: app.isPackaged
}))

ipcMain.on('window-drag-begin', (_e, { target }) => beginDrag(target))
ipcMain.on('window-drag', (_e, { dx, dy }) => dragBy(dx, dy))
ipcMain.on('window-drag-end', () => { dragState = null })

ipcMain.on('context-menu', (_e, { target }) => popupContextMenu(target))
ipcMain.handle('toggle-playlist', () => togglePlaylist())
ipcMain.handle('toggle-eq', () => toggleEq())
// Deep links into the exact System Settings panes. Ticking a box there raises no event,
// which is why the onboarding screen polls instead of waiting.
const SETTINGS_PANES = {
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

ipcMain.on('open-settings', (_e, pane) => {
  const url = SETTINGS_PANES[pane]
  if (url) shell.openExternal(url)
})

ipcMain.on('close-onboarding', () => {
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close()
})

ipcMain.on('show-onboarding', () => createOnboardingWindow())

// Screen recording consent is only picked up by a fresh process, so offering the restart
// is the only way out of that state from inside the app.
ipcMain.on('restart-app', () => {
  app.relaunch()
  app.quit()
})

ipcMain.on('window-close', () => app.quit())
ipcMain.on('window-minimize', () => win && win.minimize())

// --- Lifecycle -------------------------------------------------------------

app.whenReady().then(() => {
  ensureUserSkinsDir()
  installDisplayMediaHandler()
  createWindow()
  startSidecar()

  // Development-only harnesses, kept out of the production path.
  if (process.env.LLAMMP_SNAPSHOT || process.env.LLAMMP_TEST_DOCK) {
    require('./devtools').install({
      app,
      ipcMain,
      windows: () => ({ win, playlistWin, eqWin, onboardingWin }),
      helpers: { rectOf, moveContentTo, isAttached, togglePlaylist, toggleEq, createPlaylistWindow, createEqWindow, createOnboardingWindow, sendCommand, sendToRenderer },
      geometry: { MAIN_H }
    })
  }
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  if (sidecar && !sidecar.killed) {
    // Closing stdin is enough: the sidecar exits when its input closes.
    try { sidecar.stdin.end() } catch {}
    sidecar.kill()
  }
})
