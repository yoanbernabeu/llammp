import * as S from './sprites.js'

// Equalizer window — DECORATIVE.
//
// Measured against Music.app: `EQ enabled` rejects writes (error -10006) and
// `current EQ preset` rejects reads (-1728). Writing the bands of a preset does work,
// but with no way to switch the equalizer on or know which preset is active, the
// feature has no value.
//
// The frequencies do not line up either: Music.app exposes
// 32/64/125/250/500/1k/2k/4k/8k/16k while the Winamp skin shows
// 60/170/310/600/1k/3k/6k/12k/14k/16k. There is no 1:1 mapping.
//
// So the sliders are drawn centered and do not respond to the mouse.

const canvas = document.getElementById('screen')
const ctx = canvas.getContext('2d', { alpha: true })
ctx.imageSmoothingEnabled = false

const state = { focused: true }
let images = {}

const PREAMP_X = 21
const BAND_X0 = 78
const BAND_STEP = 18
const BAND_COUNT = 10
// Slider travel: +12 dB at the top, -12 dB at the bottom, 0 dB in the middle.
const SLIDER_TOP = 38
const SLIDER_TRAVEL = 50
const CENTER_Y = SLIDER_TOP + Math.round(SLIDER_TRAVEL / 2)

async function loadSkin (name) {
  const skin = await window.llammp.loadSkin(name)
  if (!skin) return
  const loaded = {}
  await Promise.all(Object.entries(skin.images).map(([file, dataUrl]) =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => { loaded[file] = img; resolve() }
      img.onerror = () => resolve()
      img.src = dataUrl
    })
  ))
  images = loaded
}

function blit (sprite, dx, dy) {
  const img = images[S.EQMAIN.file]
  if (!img || !sprite) return
  const [sx, sy, sw, sh] = sprite
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh)
}

function draw () {
  ctx.clearRect(0, 0, S.EQ_W, S.EQ_H)
  blit(S.EQMAIN.background, 0, 0)
  blit(state.focused ? S.EQMAIN.titleActive : S.EQMAIN.titleInactive, 0, 0)

  blit(S.EQMAIN.slider, PREAMP_X, CENTER_Y)
  for (let i = 0; i < BAND_COUNT; i++) {
    blit(S.EQMAIN.slider, BAND_X0 + i * BAND_STEP, CENTER_Y)
  }

  requestAnimationFrame(draw)
}

canvas.addEventListener('mousedown', (e) => {
  const r = canvas.getBoundingClientRect()
  const y = Math.floor((e.clientY - r.top) * (S.EQ_H / r.height))
  // Only the title bar reacts; the sliders are deliberately inert.
  if (y < 14) startWindowDrag(e)
})

function startWindowDrag (e) {
  const startX = e.screenX
  const startY = e.screenY
  window.llammp.beginDrag('eq')
  const onMove = (ev) => window.llammp.dragWindow(ev.screenX - startX, ev.screenY - startY)
  const onUp = () => {
    window.llammp.endDrag()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.llammp.contextMenu('eq')
})

window.addEventListener('focus', () => { state.focused = true })
window.addEventListener('blur', () => { state.focused = false })
window.llammp.onSkinChanged((name) => { loadSkin(name) })

;(async () => {
  await loadSkin()
  requestAnimationFrame(draw)
})()
