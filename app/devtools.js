// Development harnesses, loaded only when the matching env var is set.
//
//   LLAMMP_SNAPSHOT=/tmp/main.png npm start     capture windows to PNG, then quit
//   LLAMMP_TEST_DOCK=1 npm start                exercise window docking without a mouse
//
// Both exist because the UI cannot be checked by reading code: the window is 275x116
// pixels of bitmap sprites, and docking depends on real window geometry.

const fs = require('node:fs')

function install ({ app, ipcMain, windows, helpers, geometry }) {
  if (process.env.LLAMMP_SNAPSHOT) scheduleSnapshot({ app, windows, helpers })
  if (process.env.LLAMMP_TEST_DOCK === '1') runDockTest({ app, ipcMain, windows, helpers, geometry })
}

function scheduleSnapshot ({ app, windows, helpers }) {
  const target = process.env.LLAMMP_SNAPSHOT
  const delay = Number(process.env.LLAMMP_SNAPSHOT_DELAY || 3000)
  const plTarget = process.env.LLAMMP_SNAPSHOT_PLAYLIST
  const eqTarget = process.env.LLAMMP_SNAPSHOT_EQ

  if (plTarget) {
    // LLAMMP_PL_LATE opens the playlist through the same path a user click takes, just
    // before capture. Opening it early would hide first-open race conditions.
    if (process.env.LLAMMP_PL_LATE === '1') {
      setTimeout(() => helpers.togglePlaylist(), Math.max(200, delay - 800))
    } else {
      const w = helpers.createPlaylistWindow()
      w.once('ready-to-show', () => { w.show(); helpers.sendCommand({ cmd: 'refresh' }) })
    }
  }
  if (eqTarget) {
    const w = helpers.createEqWindow()
    w.once('ready-to-show', () => w.show())
  }
  // Opened late on purpose: when every permission is already granted the screen closes
  // itself a second after it appears, so an early open would never survive to capture.
  if (process.env.LLAMMP_SNAPSHOT_ONBOARDING) {
    setTimeout(() => helpers.createOnboardingWindow(), Math.max(200, delay - 1800))
  }

  if (process.env.LLAMMP_SWITCH_SKIN) {
    setTimeout(() => {
      helpers.sendToRenderer('skin-changed', process.env.LLAMMP_SWITCH_SKIN)
      console.log('[skin] hot switch to', process.env.LLAMMP_SWITCH_SKIN)
    }, Math.max(500, delay - 1500))
  }

  setTimeout(async () => {
    const { win, playlistWin, eqWin, onboardingWin } = windows()
    const shots = [
      [target, win],
      [plTarget, playlistWin],
      [eqTarget, eqWin],
      [process.env.LLAMMP_SNAPSHOT_ONBOARDING, onboardingWin]
    ]
    for (const [file, w] of shots) {
      if (!file || !w || w.isDestroyed()) continue
      try {
        fs.writeFileSync(file, (await w.capturePage()).toPNG())
        console.log('[snapshot] wrote', file)
      } catch (e) {
        console.error('[snapshot] failed:', e.message)
      }
    }
    app.quit()
  }, delay)
}

function runDockTest ({ app, ipcMain, windows, helpers, geometry }) {
  const { rectOf, moveContentTo, isAttached, togglePlaylist, toggleEq } = helpers

  setTimeout(() => {
    const show = (label) => {
      const w = windows()
      const parts = [['main', w.win], ['playlist', w.playlistWin], ['eq', w.eqWin]]
        .filter(([, x]) => x && !x.isDestroyed() && x.isVisible())
        .map(([n, x]) => { const r = rectOf(x); return `${n}=${r.x},${r.y} [${r.w}x${r.h}]` })
      console.log(`[dock] ${label} → ${parts.join('  ')}`)
    }
    const drag = (target, dx, dy) => {
      ipcMain.emit('window-drag-begin', null, { target })
      ipcMain.emit('window-drag', null, { dx, dy })
      ipcMain.emit('window-drag-end', null)
    }

    // Read the handles only after the playlist exists: togglePlaylist() creates it.
    togglePlaylist()
    const { win, playlistWin } = windows()

    moveContentTo(win, 400, 300)
    moveContentTo(playlistWin, 400, 300 + geometry.MAIN_H)
    show('start (playlist docked under main)')
    console.log('[dock] attached?', isAttached(win, playlistWin))

    drag('main', 120, 60)
    show('after moving main (+120,+60)')

    drag('playlist', 300, 200)
    show('after moving playlist alone')
    console.log('[dock] attached?', isAttached(win, playlistWin))

    const m = rectOf(win)
    const p = rectOf(playlistWin)
    drag('playlist', (m.x + 6) - p.x, (m.y + m.h + 7) - p.y)
    show('after approaching within 6-7 px (snap expected)')
    console.log('[dock] attached?', isAttached(win, playlistWin))
    const f = rectOf(playlistWin)
    console.log('[dock] exact alignment?', f.x === m.x && f.y === m.y + m.h)

    // Three-window chain: moving main must carry playlist and EQ.
    toggleEq()
    setTimeout(() => {
      const w = windows()
      show('EQ opened under playlist')
      drag('main', -80, -40)
      show('after moving main (-80,-40)')

      const M = rectOf(w.win)
      const P = rectOf(w.playlistWin)
      const E = rectOf(w.eqWin)
      console.log('[dock] chain intact?',
        P.x === M.x && P.y === M.y + M.h && E.x === P.x && E.y === P.y + P.h)
      app.quit()
    }, 400)
  }, 2500)
}

module.exports = { install }
