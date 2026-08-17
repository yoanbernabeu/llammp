// Sprite atlas for Winamp 2 skins.
//
// Each sprite is [x, y, width, height] inside its source bitmap. These coordinates have
// been fixed since 1997 — a skin is valid precisely because it follows this grid, so
// changing them breaks every existing skin.

export const MAIN_W = 275
export const MAIN_H = 116

// --- Main window -----------------------------------------------------------

export const TITLEBAR = {
  file: 'titlebar.bmp',
  active: [27, 0, 275, 14],
  inactive: [27, 15, 275, 14],
  // Buttons: released state on top, pressed state right below.
  menu: [0, 0, 9, 9],
  menuActive: [0, 9, 9, 9],
  minimize: [9, 0, 9, 9],
  minimizeActive: [9, 9, 9, 9],
  shade: [0, 18, 9, 9],
  shadeActive: [9, 18, 9, 9],
  close: [18, 0, 9, 9],
  closeActive: [18, 9, 9, 9]
}

export const TITLEBAR_POS = {
  menu: [6, 3],
  minimize: [244, 3],
  shade: [254, 3],
  close: [264, 3]
}

export const CBUTTONS = {
  file: 'cbuttons.bmp',
  previous: [0, 0, 23, 18],
  play: [23, 0, 23, 18],
  pause: [46, 0, 23, 18],
  stop: [69, 0, 23, 18],
  next: [92, 0, 22, 18],
  eject: [114, 0, 22, 16]
}

export const CBUTTONS_PRESSED_DY = 18
export const EJECT_PRESSED_DY = 16

export const TRANSPORT_POS = {
  previous: [16, 88],
  play: [39, 88],
  pause: [62, 88],
  stop: [85, 88],
  next: [108, 88],
  eject: [136, 89]
}

export const SHUFREP = {
  file: 'shufrep.bmp',
  repeatOff: [0, 0, 28, 15],
  repeatOffPressed: [0, 15, 28, 15],
  repeatOn: [0, 30, 28, 15],
  repeatOnPressed: [0, 45, 28, 15],
  shuffleOff: [28, 0, 47, 15],
  shuffleOffPressed: [28, 15, 47, 15],
  shuffleOn: [28, 30, 47, 15],
  shuffleOnPressed: [28, 45, 47, 15],
  eqOff: [0, 61, 23, 12],
  eqOn: [0, 73, 23, 12],
  plOff: [23, 61, 23, 12],
  plOn: [23, 73, 23, 12]
}

export const SHUFREP_POS = {
  shuffle: [164, 89],
  repeat: [210, 89],
  eq: [219, 58],
  pl: [242, 58]
}

export const POSBAR = {
  file: 'posbar.bmp',
  background: [0, 0, 248, 10],
  thumb: [248, 0, 29, 10],
  thumbPressed: [278, 0, 29, 10],
  pos: [16, 72],
  travel: 248 - 29
}

// Volume and balance share a layout: 28 background frames stacked every 15 px, then the
// thumb at the bottom of the bitmap.
export const VOLUME = {
  file: 'volume.bmp',
  frameW: 68,
  frameH: 13,
  frameCount: 28,
  frameStride: 15,
  thumb: [15, 422, 14, 11],
  thumbPressed: [0, 422, 14, 11],
  pos: [107, 57],
  travel: 68 - 14
}

export const BALANCE = {
  file: 'balance.bmp',
  frameW: 38,
  frameH: 13,
  frameCount: 28,
  frameStride: 15,
  thumb: [15, 422, 14, 11],
  thumbPressed: [0, 422, 14, 11],
  pos: [177, 57],
  travel: 38 - 14
}

// Verified against the bitmap: "stereo" occupies the LEFT half (x=0), "mono" the right
// (x=29) — the opposite of their on-screen order. Row 0 lit, row 12 dim.
export const MONOSTER = {
  file: 'monoster.bmp',
  stereoOn: [0, 0, 29, 12],
  stereoOff: [0, 12, 29, 12],
  monoOn: [29, 0, 29, 12],
  monoOff: [29, 12, 29, 12],
  monoPos: [212, 41],
  stereoPos: [239, 41]
}

export const PLAYPAUS = {
  file: 'playpaus.bmp',
  play: [0, 0, 9, 9],
  pause: [9, 0, 9, 9],
  stop: [18, 0, 9, 9],
  pos: [26, 28]
}

// --- Text and digits -------------------------------------------------------

// 11 cells of 9x13: digits 0-9 then a blank.
export const NUMBERS = {
  file: 'numbers.bmp',
  charW: 9,
  charH: 13,
  // Minutes and seconds are separated by the ":" painted into main.bmp.
  positions: [[48, 26], [60, 26], [78, 26], [90, 26]],
  minusPos: [36, 26]
}

// 5x6 bitmap font, three rows of 31 characters.
export const TEXT = {
  file: 'text.bmp',
  charW: 5,
  charH: 6,
  // Read off the enlarged bitmap, column by column. The trap is in row 1: an EMPTY cell
  // follows the ellipsis, shifting everything after it by one. Without it "-" resolves
  // to ")" and titles render as gibberish.
  rows: [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ"@   ',
    '0123456789… :()-\'!_+\\/[]^&%,=$#',
    'ÅÖÄ?*                          '
  ],
  marqueePos: [111, 27],
  marqueeW: 154,
  kbpsPos: [111, 43],
  khzPos: [156, 43]
}

// --- Playlist window -------------------------------------------------------

// pledit.bmp is 280x186. The window is tiled: two corners and a repeating tile on top,
// repeating side borders, two corners at the bottom.
export const PLEDIT = {
  file: 'pledit.bmp',
  topLeft: [0, 0, 25, 20],
  topTitle: [26, 0, 100, 20],
  topTile: [127, 0, 25, 20],
  topRight: [153, 0, 25, 20],
  topLeftInactive: [0, 21, 25, 20],
  topTitleInactive: [26, 21, 100, 20],
  topTileInactive: [127, 21, 25, 20],
  topRightInactive: [153, 21, 25, 20],

  leftTile: [0, 42, 12, 29],
  rightTile: [32, 42, 20, 29],

  bottomLeft: [0, 72, 125, 38],
  bottomTile: [179, 0, 25, 38],
  bottomRight: [126, 72, 150, 38],

  scrollHandle: [52, 53, 8, 18],

  titleH: 20,
  bottomH: 38,
  borderW: 12,
  rightW: 20
}

export const PLAYLIST_W = 275
export const PLAYLIST_H = 232

// --- Equalizer window ------------------------------------------------------

// Decorative only: Music.app refuses to enable its equalizer or report the active
// preset, so only the background and centered thumbs are drawn.
export const EQMAIN = {
  file: 'eqmain.bmp',
  background: [0, 0, 275, 116],
  titleActive: [0, 134, 275, 14],
  titleInactive: [0, 149, 275, 14],
  slider: [0, 164, 11, 11],
  sliderPressed: [0, 176, 11, 11]
}

export const EQ_W = 275
export const EQ_H = 116

// --- Visualizer ------------------------------------------------------------

export const VIS = {
  pos: [24, 43],
  width: 76,
  height: 16
}

/** Background frame index (0..count-1) for a value in 0..max. */
export function frameIndex (value, max, count) {
  if (max <= 0) return 0
  return Math.min(Math.max(Math.round((value / max) * (count - 1)), 0), count - 1)
}
