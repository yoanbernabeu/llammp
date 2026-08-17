import * as S from './sprites.js'

const canvas = document.getElementById('screen')
const ctx = canvas.getContext('2d', { alpha: true })
ctx.imageSmoothingEnabled = false

const W = S.PLAYLIST_W
const H = S.PLAYLIST_H
const ROW_H = 13 // row height, as in Winamp

const state = {
  focused: true,
  queue: null,
  scroll: 0, // first visible row, as an absolute index
  colors: null
}

let images = {}

async function loadSkin (name) {
  const skin = await window.llammp.loadSkin(name)
  if (!skin) return
  state.colors = skin.pledit
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
  const img = images[S.PLEDIT.file]
  if (!img || !sprite) return
  const [sx, sy, sw, sh] = sprite
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh)
}

function visibleRows () {
  return Math.floor((H - S.PLEDIT.titleH - S.PLEDIT.bottomH) / ROW_H)
}

function drawChrome () {
  const P = S.PLEDIT
  const active = state.focused

  const left = active ? P.topLeft : P.topLeftInactive
  const tile = active ? P.topTile : P.topTileInactive
  const title = active ? P.topTitle : P.topTitleInactive
  const right = active ? P.topRight : P.topRightInactive

  blit(left, 0, 0)
  for (let x = left[2]; x < W - right[2]; x += tile[2]) blit(tile, x, 0)
  blit(title, Math.round((W - title[2]) / 2), 0)
  blit(right, W - right[2], 0)

  const bodyTop = P.titleH
  const bodyBottom = H - P.bottomH
  for (let y = bodyTop; y < bodyBottom; y += P.leftTile[3]) {
    blit(P.leftTile, 0, y)
    blit(P.rightTile, W - P.rightW, y)
  }

  blit(P.bottomLeft, 0, H - P.bottomH)
  for (let x = P.bottomLeft[2]; x < W - P.bottomRight[2]; x += P.bottomTile[2]) {
    blit(P.bottomTile, x, H - P.bottomH)
  }
  blit(P.bottomRight, W - P.bottomRight[2], H - P.bottomH)
}

function drawList () {
  const c = state.colors || {}
  const x0 = S.PLEDIT.borderW
  const y0 = S.PLEDIT.titleH
  const listW = W - S.PLEDIT.borderW - S.PLEDIT.rightW
  const rows = visibleRows()

  // Cover the whole area, not just rows * ROW_H: the leftover pixels would otherwise
  // stay transparent and show through the window.
  ctx.fillStyle = c.normalbg || '#000000'
  ctx.fillRect(x0, y0, listW, H - S.PLEDIT.titleH - S.PLEDIT.bottomH)

  const q = state.queue
  if (!q) return

  ctx.font = '9px Arial, sans-serif'
  ctx.textBaseline = 'top'

  if (!q.available) {
    ctx.fillStyle = c.normal || '#00FF00'
    // Streaming sources expose no queue at all. Say so explicitly rather than showing an
    // empty list, which would read as a bug.
    ctx.fillText(
      q.reason === 'streaming_source' ? 'Streaming source — no queue available' : 'No playlist',
      x0 + 4, y0 + 4)
    return
  }

  for (let i = 0; i < rows; i++) {
    const absIndex = state.scroll + i
    const track = trackAt(absIndex)
    if (!track) continue

    const y = y0 + i * ROW_H
    const isCurrent = absIndex === q.currentIndex

    if (isCurrent) {
      ctx.fillStyle = c.selectedbg || '#0000C6'
      ctx.fillRect(x0, y, listW, ROW_H)
    }
    ctx.fillStyle = isCurrent ? (c.current || '#FFFFFF') : (c.normal || '#00FF00')

    const label = `${absIndex}. ${track.artist ? track.artist + ' - ' : ''}${track.name}`
    const duration = formatDuration(track.duration)
    const durW = ctx.measureText(duration).width

    // Clip the title so it cannot run under the right-aligned duration.
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0 + 3, y, listW - durW - 12, ROW_H)
    ctx.clip()
    ctx.fillText(label, x0 + 3, y + 2)
    ctx.restore()
    ctx.fillText(duration, x0 + listW - durW - 4, y + 2)
  }
}

// The sidecar sends a window of tracks around the current one, not the whole playlist.
function trackAt (absIndex) {
  const q = state.queue
  if (!q?.tracks) return null
  const offset = absIndex - q.windowStart
  return offset >= 0 && offset < q.tracks.length ? q.tracks[offset] : null
}

function formatDuration (seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function draw () {
  ctx.clearRect(0, 0, W, H)
  drawChrome()
  drawList()
  requestAnimationFrame(draw)
}

// --- Interaction -----------------------------------------------------------

canvas.addEventListener('wheel', (e) => {
  if (!state.queue?.available) return
  state.scroll = clampScroll(state.scroll + Math.sign(e.deltaY) * 3)
  e.preventDefault()
}, { passive: false })

function clampScroll (value) {
  const q = state.queue
  if (!q?.available) return 0
  // Scrolling is bounded by the received window, not the whole playlist: going further
  // would require asking the sidecar for another window.
  const min = q.windowStart
  const max = Math.max(min, q.windowStart + q.tracks.length - visibleRows())
  return Math.min(max, Math.max(min, value))
}

canvas.addEventListener('dblclick', (e) => {
  const q = state.queue
  if (!q?.available) return
  const r = canvas.getBoundingClientRect()
  const y = Math.floor((e.clientY - r.top) * (H / r.height))
  const row = Math.floor((y - S.PLEDIT.titleH) / ROW_H)
  if (row < 0 || row >= visibleRows()) return

  const absIndex = state.scroll + row
  if (!trackAt(absIndex)) return
  window.llammp.send({
    cmd: 'playTrackAt',
    playlistPersistentId: q.playlistPersistentId,
    index: absIndex
  })
})

canvas.addEventListener('mousedown', (e) => {
  const r = canvas.getBoundingClientRect()
  const y = Math.floor((e.clientY - r.top) * (H / r.height))
  if (y < S.PLEDIT.titleH) startWindowDrag(e)
})

// Dragged alone, the playlist detaches from the group — but snaps back as soon as it
// comes within range of another window.
function startWindowDrag (e) {
  const startX = e.screenX
  const startY = e.screenY
  window.llammp.beginDrag('playlist')
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
  window.llammp.contextMenu('playlist')
})

window.addEventListener('focus', () => { state.focused = true })
window.addEventListener('blur', () => { state.focused = false })

// --- Events ----------------------------------------------------------------

window.llammp.onEvent((ev) => {
  if (ev.type === 'queue') {
    const first = !state.queue
    state.queue = ev
    if (ev.available) {
      // Recenter on the current track on first load, or whenever it scrolls out of view.
      const rows = visibleRows()
      if (first || ev.currentIndex < state.scroll || ev.currentIndex >= state.scroll + rows) {
        state.scroll = clampScroll(ev.currentIndex - Math.floor(rows / 2))
      } else {
        state.scroll = clampScroll(state.scroll)
      }
    }
  } else if (ev.type === 'unavailable') {
    state.queue = null
  }
})

window.llammp.onSkinChanged((name) => { loadSkin(name) })

;(async () => {
  await loadSkin()
  requestAnimationFrame(draw)
  // Listeners are wired: ask for the current queue instead of waiting for the next
  // track change, which may be minutes away.
  window.llammp.ready()
})()
