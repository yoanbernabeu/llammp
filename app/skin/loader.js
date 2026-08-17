// Winamp 2 skin (.wsz) loader: a ZIP of bitmaps plus three text config files.
// Runs in the main process, so the renderer receives ready-made data: URLs and never
// touches the filesystem.

const fs = require('node:fs/promises')
const path = require('node:path')
const JSZip = require('jszip')

// Skins disagree on case: MAIN.BMP, main.bmp and Main.Bmp all exist in the wild.
function normalizeName (name) {
  return path.basename(name).toLowerCase()
}

const MIME = { '.bmp': 'image/bmp', '.png': 'image/png', '.gif': 'image/gif' }

async function loadSkin (wszPath) {
  const buffer = await fs.readFile(wszPath)
  const zip = await JSZip.loadAsync(buffer)

  const images = {}
  const texts = {}
  const files = []

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const name = normalizeName(entry.name)
    // macOS archives carry __MACOSX/._ resource forks that would shadow real bitmaps.
    if (name.startsWith('._') || entry.name.includes('__MACOSX')) continue
    files.push(name)

    const ext = path.extname(name)
    if (MIME[ext]) {
      images[name] = `data:${MIME[ext]};base64,${await entry.async('base64')}`
    } else if (ext === '.txt') {
      texts[name] = await entry.async('string')
    }
  }

  return {
    images,
    files,
    viscolor: parseViscolor(texts['viscolor.txt']),
    pledit: parsePledit(texts['pledit.txt']),
    region: parseRegion(texts['region.txt'])
  }
}

// 24 lines of "r,g,b": 0 background, 1 grid, 2-17 spectrum gradient, 18 oscilloscope.
const DEFAULT_VISCOLOR = [
  [0, 0, 0], [24, 33, 41], [239, 49, 16], [206, 41, 16], [214, 90, 0], [214, 102, 0],
  [214, 115, 0], [198, 123, 8], [222, 165, 24], [214, 181, 33], [189, 222, 41],
  [148, 222, 33], [41, 206, 16], [50, 190, 16], [57, 181, 16], [49, 156, 8],
  [41, 148, 0], [24, 132, 8], [255, 255, 255], [214, 214, 222], [153, 153, 153],
  [0, 0, 0], [0, 0, 0], [0, 0, 0]
]

function parseViscolor (raw) {
  if (!raw) return DEFAULT_VISCOLOR
  const colors = []
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (m) colors.push([+m[1], +m[2], +m[3]])
  }
  // A truncated file is padded rather than rejected: a partial skin should still render.
  while (colors.length < 24) colors.push(DEFAULT_VISCOLOR[colors.length])
  return colors
}

// Playlist window colors, INI-style.
function parsePledit (raw) {
  const out = {
    normal: '#00FF00',
    current: '#FFFFFF',
    normalbg: '#000000',
    selectedbg: '#0000C6',
    font: 'Arial'
  }
  if (!raw) return out
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    if (key in out) out[key] = m[2]
  }
  return out
}

// Window shape polygons. Parsed and passed through; not applied yet, since V1 windows
// are rectangular.
function parseRegion (raw) {
  if (!raw) return {}
  const sections = {}
  let current = null
  for (const line of raw.split(/\r?\n/)) {
    const sec = line.match(/^\s*\[(.+?)\]\s*$/)
    if (sec) { current = sec[1]; sections[current] = {}; continue }
    const kv = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
    if (kv && current) sections[current][kv[1].toLowerCase()] = kv[2]
  }
  return sections
}

module.exports = { loadSkin, normalizeName }
