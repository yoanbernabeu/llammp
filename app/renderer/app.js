import * as S from './sprites.js'
import { Visualizer } from './vis.js'

const canvas = document.getElementById('screen')
const ctx = canvas.getContext('2d', { alpha: true })
ctx.imageSmoothingEnabled = false

const welcome = document.getElementById('welcome')

// --- State -----------------------------------------------------------------

const state = {
  available: false, // Music.app reachable
  unavailableReason: null,
  playerState: 'stopped',
  volume: 65,
  shuffle: false,
  repeat: 'off',
  track: null,
  position: 0,
  queue: null,
  windowFocused: true,
  // While dragging, the thumb follows the mouse instead of waiting for Music.app to
  // echo back — otherwise it snaps backwards on every frame.
  dragging: null, // 'posbar' | 'volume' | null
  dragValue: 0,
  pressed: null, // currently held button
  visMode: 1, // 0 off, 1 spectrum, 2 oscilloscope
  playlistOpen: false,
  eqOpen: false,
  dropHover: false,
  dropError: null,
  marqueeOffset: 0,
  lastPositionAt: 0 // local timestamp of the last `position` event
}

let images = {}
let viscolor = null
const vis = new Visualizer()

// --- Skin loading ----------------------------------------------------------

async function loadSkin (name) {
  let skin
  try {
    skin = await window.llammp.loadSkin(name)
  } catch {
    skin = null
  }
  if (!skin) {
    showWelcome()
    return false
  }
  viscolor = skin.viscolor

  const loaded = {}
  await Promise.all(Object.entries(skin.images).map(([file, dataUrl]) =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => { loaded[file] = img; resolve() }
      // One unreadable bitmap must not take the whole skin down.
      img.onerror = () => resolve()
      img.src = dataUrl
    })
  ))

  // Without main.bmp there is nothing to draw on.
  if (!loaded['main.bmp']) {
    showWelcome()
    return false
  }

  images = loaded
  welcome.classList.add('hidden')
  canvas.classList.remove('hidden')
  return true
}

function showWelcome () {
  welcome.classList.remove('hidden')
  canvas.classList.add('hidden')
}

// --- Drawing primitives ----------------------------------------------------

function blit (file, sprite, dx, dy) {
  const img = images[file]
  if (!img || !sprite) return
  const [sx, sy, sw, sh] = sprite
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh)
}

/** Pressed states are stored directly below the released ones. */
function offsetY (sprite, dy) {
  return [sprite[0], sprite[1] + dy, sprite[2], sprite[3]]
}

// Bitmap font lookup: character -> cell in text.bmp.
const charMap = (() => {
  const map = new Map()
  S.TEXT.rows.forEach((row, rowIndex) => {
    [...row].forEach((ch, colIndex) => {
      if (!map.has(ch)) map.set(ch, [colIndex, rowIndex])
    })
  })
  return map
})()

function drawText (text, x, y, maxChars = Infinity) {
  const upper = String(text ?? '').toUpperCase()
  let cx = x
  let drawn = 0
  for (const ch of upper) {
    if (drawn >= maxChars) break
    // Spaces and unknown characters advance without drawing. Falling back to a
    // "default" cell would stamp an arbitrary glyph in place of every space.
    const cell = ch === ' ' ? null : charMap.get(ch)
    if (cell) {
      const [col, row] = cell
      blit(S.TEXT.file,
        [col * S.TEXT.charW, row * S.TEXT.charH, S.TEXT.charW, S.TEXT.charH],
        cx, y)
    }
    cx += S.TEXT.charW
    drawn++
  }
}

function drawNumber (value, positions) {
  // Some skins ship nums_ex.bmp instead; numbers.bmp stays the reference.
  const file = images[S.NUMBERS.file] ? S.NUMBERS.file : 'nums_ex.bmp'
  const digits = value.split('')
  digits.forEach((d, i) => {
    if (i >= positions.length) return
    const [dx, dy] = positions[i]
    // A space maps to the 11th cell, which is blank by design.
    const index = d === ' ' ? 10 : Number(d)
    if (Number.isNaN(index)) return
    blit(file, [index * S.NUMBERS.charW, 0, S.NUMBERS.charW, S.NUMBERS.charH], dx, dy)
  })
}

// --- Rendering ---------------------------------------------------------------

function draw () {
  if (!images['main.bmp']) return
  ctx.clearRect(0, 0, S.MAIN_W, S.MAIN_H)

  blit('main.bmp', [0, 0, S.MAIN_W, S.MAIN_H], 0, 0)
  blit(S.TITLEBAR.file, state.windowFocused ? S.TITLEBAR.active : S.TITLEBAR.inactive, 0, 0)

  drawTitlebarButtons()
  drawTransport()
  drawToggles()
  drawTimeAndTitle()
  drawSliders()
  drawIndicators()
  drawVisualizer()
}

function drawTitlebarButtons () {
  const pressed = state.pressed
  blit(S.TITLEBAR.file, pressed === 'menu' ? S.TITLEBAR.menuActive : S.TITLEBAR.menu, ...S.TITLEBAR_POS.menu)
  blit(S.TITLEBAR.file, pressed === 'minimize' ? S.TITLEBAR.minimizeActive : S.TITLEBAR.minimize, ...S.TITLEBAR_POS.minimize)
  blit(S.TITLEBAR.file, pressed === 'shade' ? S.TITLEBAR.shadeActive : S.TITLEBAR.shade, ...S.TITLEBAR_POS.shade)
  blit(S.TITLEBAR.file, pressed === 'close' ? S.TITLEBAR.closeActive : S.TITLEBAR.close, ...S.TITLEBAR_POS.close)
}

function drawTransport () {
  for (const key of ['previous', 'play', 'pause', 'stop', 'next', 'eject']) {
    const sprite = S.CBUTTONS[key]
    const dy = key === 'eject' ? S.EJECT_PRESSED_DY : S.CBUTTONS_PRESSED_DY
    const s = state.pressed === key ? offsetY(sprite, dy) : sprite
    blit(S.CBUTTONS.file, s, ...S.TRANSPORT_POS[key])
  }
}

function drawToggles () {
  const sh = state.shuffle
    ? (state.pressed === 'shuffle' ? S.SHUFREP.shuffleOnPressed : S.SHUFREP.shuffleOn)
    : (state.pressed === 'shuffle' ? S.SHUFREP.shuffleOffPressed : S.SHUFREP.shuffleOff)
  blit(S.SHUFREP.file, sh, ...S.SHUFREP_POS.shuffle)

  const rp = state.repeat !== 'off'
    ? (state.pressed === 'repeat' ? S.SHUFREP.repeatOnPressed : S.SHUFREP.repeatOn)
    : (state.pressed === 'repeat' ? S.SHUFREP.repeatOffPressed : S.SHUFREP.repeatOff)
  blit(S.SHUFREP.file, rp, ...S.SHUFREP_POS.repeat)

  // Music.app's equalizer can be neither enabled nor read back, so the EQ button only
  // reflects whether the decorative window is open.
  blit(S.SHUFREP.file, state.eqOpen ? S.SHUFREP.eqOn : S.SHUFREP.eqOff, ...S.SHUFREP_POS.eq)
  blit(S.SHUFREP.file, state.playlistOpen ? S.SHUFREP.plOn : S.SHUFREP.plOff, ...S.SHUFREP_POS.pl)
}

function drawTimeAndTitle () {
  const pos = displayPosition()
  const totalSeconds = Math.max(0, Math.floor(pos))
  const mm = Math.min(99, Math.floor(totalSeconds / 60))
  const ss = totalSeconds % 60
  const digits = state.available && state.track
    ? String(mm).padStart(2, '0') + String(ss).padStart(2, '0')
    : '    '
  drawNumber(digits, S.NUMBERS.positions)

  // Play / pause / stop indicator
  const indicator = state.playerState === 'playing'
    ? S.PLAYPAUS.play
    : state.playerState === 'paused'
      ? S.PLAYPAUS.pause
      : S.PLAYPAUS.stop
  blit(S.PLAYPAUS.file, indicator, ...S.PLAYPAUS.pos)

  drawMarquee()

  // Real values when available, empty otherwise: streaming tracks report `missing
  // value` for both, and inventing numbers would be worse than showing none.
  const t = state.track
  if (t?.bitRate) drawText(String(t.bitRate), ...S.TEXT.kbpsPos)
  if (t?.sampleRate) drawText(String(Math.round(t.sampleRate / 1000)), ...S.TEXT.khzPos)
}

function marqueeText () {
  // Immediate drag-and-drop feedback: without it a rejected skin would give no visible
  // sign and the app would look frozen.
  if (state.dropError) return state.dropError.toUpperCase()
  if (state.dropHover) return 'DEPOSER UN SKIN .WSZ'
  if (!state.available) {
    // A missing permission is not a closed app, and the user can only act if told which.
    return state.unavailableReason === 'no_permission'
      ? 'AUTORISATION REFUSEE - REGLAGES SYSTEME / AUTOMATISATION'
      : 'MUSIC.APP FERMEE'
  }
  if (!state.track) return 'LLAMMP'
  const t = state.track
  const title = t.artist ? `${t.artist} - ${t.name}` : t.name
  return title
}

function drawMarquee () {
  const text = marqueeText()
  const [x, y] = S.TEXT.marqueePos
  const visibleChars = Math.floor(S.TEXT.marqueeW / S.TEXT.charW)

  if (text.length <= visibleChars) {
    drawText(text, x, y, visibleChars)
    return
  }

  // Continuous scroll with a separator, like Winamp.
  const scroll = text + '  ***  '
  const offset = Math.floor(state.marqueeOffset) % scroll.length
  const doubled = scroll + scroll
  drawText(doubled.slice(offset, offset + visibleChars), x, y, visibleChars)
}

function drawSliders () {
  // 28 background frames, the last one meaning 100.
  const volFrame = S.frameIndex(state.volume, 100, S.VOLUME.frameCount)
  blit(S.VOLUME.file,
    [0, volFrame * S.VOLUME.frameStride, S.VOLUME.frameW, S.VOLUME.frameH],
    ...S.VOLUME.pos)

  const volValue = state.dragging === 'volume' ? state.dragValue : state.volume
  const volThumbX = S.VOLUME.pos[0] + Math.round((volValue / 100) * S.VOLUME.travel)
  blit(S.VOLUME.file,
    state.dragging === 'volume' ? S.VOLUME.thumbPressed : S.VOLUME.thumb,
    volThumbX, S.VOLUME.pos[1] + 1)

  // Balance is decorative: Music.app's scripting dictionary has no balance property at
  // all, so the thumb stays centered and inert.
  blit(S.BALANCE.file,
    [0, 0, S.BALANCE.frameW, S.BALANCE.frameH],
    ...S.BALANCE.pos)
  blit(S.BALANCE.file, S.BALANCE.thumb,
    S.BALANCE.pos[0] + Math.round(S.BALANCE.travel / 2), S.BALANCE.pos[1] + 1)

  // Position bar
  blit(S.POSBAR.file, S.POSBAR.background, ...S.POSBAR.pos)
  const duration = state.track?.duration || 0
  if (duration > 0 && state.available) {
    const ratio = state.dragging === 'posbar'
      ? state.dragValue
      : Math.min(1, Math.max(0, displayPosition() / duration))
    const thumbX = S.POSBAR.pos[0] + Math.round(ratio * S.POSBAR.travel)
    blit(S.POSBAR.file,
      state.dragging === 'posbar' ? S.POSBAR.thumbPressed : S.POSBAR.thumb,
      thumbX, S.POSBAR.pos[1])
  }
}

function drawIndicators () {
  // Music.app never reports channel count; library tracks are assumed stereo, which they
  // are in the overwhelming majority of cases.
  const stereo = !!state.track
  blit(S.MONOSTER.file, stereo ? S.MONOSTER.stereoOn : S.MONOSTER.stereoOff, ...S.MONOSTER.stereoPos)
  blit(S.MONOSTER.file, S.MONOSTER.monoOff, ...S.MONOSTER.monoPos)
}

function drawVisualizer () {
  const [vx, vy] = S.VIS.pos
  const w = S.VIS.width
  const h = S.VIS.height
  if (!viscolor) return

  const rgb = (i) => {
    const c = viscolor[i] || [0, 0, 0]
    return `rgb(${c[0]},${c[1]},${c[2]})`
  }

  // When off, leave the grid painted in main.bmp visible, exactly like Winamp: filling
  // it black would erase part of the skin.
  if (state.visMode === 0 || !vis.ready) return

  ctx.fillStyle = rgb(0)
  ctx.fillRect(vx, vy, w, h)

  if (state.visMode === 1) {
    const bars = 19 // Winamp draws 19 bars, 4 px wide, 1 px apart
    const values = vis.spectrum(bars)
    for (let i = 0; i < bars; i++) {
      const barH = Math.round(values[i] * h)
      for (let py = 0; py < barH; py++) {
        // Colors 2..17: gradient index follows bar height, as in Winamp.
        const shade = 17 - Math.floor((py / h) * 16)
        ctx.fillStyle = rgb(Math.min(17, Math.max(2, shade)))
        ctx.fillRect(vx + i * 4, vy + h - 1 - py, 3, 1)
      }
    }
  } else {
    const points = vis.waveform(w)
    ctx.fillStyle = rgb(18)
    for (let i = 0; i < w; i++) {
      const y = Math.round((h / 2) - points[i] * (h / 2 - 1))
      ctx.fillRect(vx + i, vy + Math.min(h - 1, Math.max(0, y)), 1, 1)
    }
  }
}

/** Interpolated between sidecar position events, which arrive every 250 ms. */
function displayPosition () {
  if (state.playerState !== 'playing') return state.position
  const elapsed = (performance.now() - state.lastPositionAt) / 1000
  const extrapolated = state.position + Math.min(elapsed, 1)
  const duration = state.track?.duration
  return duration ? Math.min(extrapolated, duration) : extrapolated
}

// --- Loop ------------------------------------------------------------------

let lastFrame = 0
function frame (now) {
  // The title scrolls at roughly 7 characters per second, like Winamp.
  if (state.playerState === 'playing' && now - lastFrame > 140) {
    state.marqueeOffset += 1
    lastFrame = now
  }
  draw()
  requestAnimationFrame(frame)
}

// --- Hit testing -----------------------------------------------------------

function hit (x, y, [bx, by], w, h) {
  return x >= bx && x < bx + w && y >= by && y < by + h
}

function buttonAt (x, y) {
  for (const key of ['previous', 'play', 'pause', 'stop', 'next', 'eject']) {
    const [w, h] = [S.CBUTTONS[key][2], S.CBUTTONS[key][3]]
    if (hit(x, y, S.TRANSPORT_POS[key], w, h)) return key
  }
  if (hit(x, y, S.TITLEBAR_POS.close, 9, 9)) return 'close'
  if (hit(x, y, S.TITLEBAR_POS.minimize, 9, 9)) return 'minimize'
  if (hit(x, y, S.TITLEBAR_POS.shade, 9, 9)) return 'shade'
  if (hit(x, y, S.TITLEBAR_POS.menu, 9, 9)) return 'menu'
  if (hit(x, y, S.SHUFREP_POS.shuffle, 47, 15)) return 'shuffle'
  if (hit(x, y, S.SHUFREP_POS.repeat, 28, 15)) return 'repeat'
  if (hit(x, y, S.SHUFREP_POS.eq, 23, 12)) return 'eq'
  if (hit(x, y, S.SHUFREP_POS.pl, 23, 12)) return 'pl'
  if (hit(x, y, S.VIS.pos, S.VIS.width, S.VIS.height)) return 'vis'
  return null
}

function canvasCoords (e) {
  const r = canvas.getBoundingClientRect()
  return [
    Math.floor((e.clientX - r.left) * (S.MAIN_W / r.width)),
    Math.floor((e.clientY - r.top) * (S.MAIN_H / r.height))
  ]
}

canvas.addEventListener('mousedown', (e) => {
  const [x, y] = canvasCoords(e)

  if (hit(x, y, S.POSBAR.pos, 248, 10) && state.track?.duration) {
    state.dragging = 'posbar'
    state.dragValue = posbarRatio(x)
    return
  }
  if (hit(x, y, S.VOLUME.pos, S.VOLUME.frameW, S.VOLUME.frameH)) {
    state.dragging = 'volume'
    state.dragValue = volumeValue(x)
    return
  }

  const btn = buttonAt(x, y)
  if (btn) { state.pressed = btn; return }

  // Anywhere else on the title bar drags the window.
  if (y < 14) startWindowDrag(e)
})

function posbarRatio (x) {
  const rel = x - S.POSBAR.pos[0] - 14 // thumb center
  return Math.min(1, Math.max(0, rel / S.POSBAR.travel))
}

function volumeValue (x) {
  const rel = x - S.VOLUME.pos[0] - 7
  return Math.round(Math.min(100, Math.max(0, (rel / S.VOLUME.travel) * 100)))
}

window.addEventListener('mousemove', (e) => {
  if (!state.dragging) return
  const [x] = canvasCoords(e)
  if (state.dragging === 'posbar') {
    state.dragValue = posbarRatio(x)
  } else if (state.dragging === 'volume') {
    state.dragValue = volumeValue(x)
    // The slider tracks the mouse optimistically; round-tripping to Music.app on every
    // pixel would flood the channel, so the command itself is throttled.
    throttledVolume(state.dragValue)
  }
})

window.addEventListener('mouseup', () => {
  if (state.dragging === 'posbar') {
    const duration = state.track?.duration || 0
    if (duration) window.llammp.send({ cmd: 'seek', position: state.dragValue * duration })
  } else if (state.dragging === 'volume') {
    window.llammp.send({ cmd: 'setVolume', volume: state.dragValue })
    state.volume = state.dragValue
  }
  state.dragging = null

  if (state.pressed) {
    activate(state.pressed)
    state.pressed = null
  }
})

let volumeTimer = null
let pendingVolume = null
function throttledVolume (v) {
  pendingVolume = v
  if (volumeTimer) return
  volumeTimer = setTimeout(() => {
    window.llammp.send({ cmd: 'setVolume', volume: pendingVolume })
    volumeTimer = null
  }, 80)
}

function activate (button) {
  switch (button) {
    case 'previous': window.llammp.send({ cmd: 'previous' }); break
    case 'play': window.llammp.send({ cmd: 'play' }); break
    case 'pause': window.llammp.send({ cmd: 'playpause' }); break
    case 'stop': window.llammp.send({ cmd: 'stop' }); break
    case 'next': window.llammp.send({ cmd: 'next' }); break
    case 'shuffle': window.llammp.send({ cmd: 'setShuffle', enabled: !state.shuffle }); break
    case 'repeat': {
      const order = ['off', 'all', 'one']
      const next = order[(order.indexOf(state.repeat) + 1) % order.length]
      window.llammp.send({ cmd: 'setRepeat', mode: next })
      break
    }
    case 'vis': state.visMode = (state.visMode + 1) % 3; break
    case 'pl':
      window.llammp.togglePlaylist().then((open) => { state.playlistOpen = open })
      break
    case 'eq':
      // Opens a decorative window; the button reflects that, not an active equalizer.
      window.llammp.toggleEq().then((open) => { state.eqOpen = open })
      break
    // Winamp opens a menu from this corner button; here it cycles through skins.
    case 'menu': window.llammp.cycleSkin(); break
    case 'close': window.llammp.closeWindow(); break
    case 'minimize': window.llammp.minimizeWindow(); break
    // eject: no effect in V1.
  }
}

// Electron does not move a frameless window on its own. Dragging the main window also
// carries every window docked to it.
function startWindowDrag (e) {
  const startX = e.screenX
  const startY = e.screenY
  window.llammp.beginDrag('main')
  const onMove = (ev) => window.llammp.dragWindow(ev.screenX - startX, ev.screenY - startY)
  const onUp = () => {
    window.llammp.endDrag()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// Right click: context menu (skins, windows, always on top).
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.llammp.contextMenu('main')
})

// Dropping a .wsz installs it into the user folder and applies it. Without
// preventDefault on dragover, Chromium would open the file instead of firing drop.
window.addEventListener('dragover', (e) => {
  e.preventDefault()
  state.dropHover = true
  welcome.classList.add('drop')
})
window.addEventListener('dragleave', () => {
  state.dropHover = false
  welcome.classList.remove('drop')
})
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  state.dropHover = false
  welcome.classList.remove('drop')
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  const result = await window.llammp.addSkinFromDrop(file)
  if (!result?.ok) {
    state.dropError = result?.error || 'Skin refused'
    setTimeout(() => { state.dropError = null }, 4000)
  }
})

window.addEventListener('focus', () => { state.windowFocused = true })
window.addEventListener('blur', () => { state.windowFocused = false })

// --- Sidecar events --------------------------------------------------------

window.llammp.onEvent((ev) => {
  switch (ev.type) {
    case 'state':
      state.available = true
      state.playerState = ev.playerState
      state.shuffle = ev.shuffle
      state.repeat = ev.repeat
      // Do not overwrite a value the user is currently dragging.
      if (state.dragging !== 'volume') state.volume = ev.volume
      break
    case 'track':
      state.available = true
      state.track = ev
      state.marqueeOffset = 0
      break
    case 'position':
      state.position = ev.position
      state.lastPositionAt = performance.now()
      break
    case 'queue':
      state.queue = ev
      break
    case 'unavailable':
      state.available = false
      state.unavailableReason = ev.reason
      state.track = null
      state.playerState = 'stopped'
      break
    case 'log':
      if (ev.level === 'error') console.error('[sidecar]', ev.message)
      break
  }
})

window.llammp.onSkinChanged(async (name) => {
  const wasEmpty = !images['main.bmp']
  const ok = await loadSkin(name)
  // First skin ever installed: the render loop was never started.
  if (ok && wasEmpty) requestAnimationFrame(frame)
})

window.llammp.onSidecarError((e) => {
  console.error('[sidecar]', e.message)
  state.available = false
})

// --- Startup ---------------------------------------------------------------

;(async () => {
  const skins = await window.llammp.listSkins()
  if (!skins.length) {
    showWelcome()
  } else {
    await loadSkin()
    requestAnimationFrame(frame)
  }

  // Listeners are wired: ask for the current state. Without this the window would miss
  // whatever the sidecar emitted before the renderer existed.
  window.llammp.ready()

  const ok = await vis.start()
  if (!ok) console.warn('[vis]', vis.error)
})()
