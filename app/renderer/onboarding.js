// First-run permission screen.
//
// Both permissions behave differently and the screen has to reflect that honestly:
//   - Apple Events can be requested from here, macOS shows a consent dialog;
//   - Screen & System Audio Recording shows no dialog at all on an ad-hoc signed build,
//     so the only honest instruction is "open System Settings and tick the box".
//
// State is polled rather than pushed: macOS notifies no one when a checkbox is ticked in
// System Settings.

const els = {
  ae: document.getElementById('ae'),
  aeAllow: document.getElementById('aeAllow'),
  aeSettings: document.getElementById('aeSettings'),
  aeState: document.getElementById('aeState'),
  screen: document.getElementById('screen'),
  screenSettings: document.getElementById('screenSettings'),
  screenState: document.getElementById('screenState'),
  hint: document.getElementById('hint'),
  allDone: document.getElementById('allDone'),
  close: document.getElementById('close')
}

const AE_LABELS = {
  granted: '',
  denied: 'Refused — tick the box in System Settings',
  undetermined: 'Not requested yet',
  music_not_running: 'Music.app is not running',
  unknown: 'Unknown state'
}

const SCREEN_LABELS = {
  granted: '',
  denied: 'Refused — tick the box in System Settings',
  'not-determined': 'Not granted yet',
  restricted: 'Restricted by this Mac’s configuration'
}

let appleEvents = 'undetermined'
let screenAccess = 'not-determined'

function render () {
  const aeOk = appleEvents === 'granted'
  const screenOk = screenAccess === 'granted'

  els.ae.classList.toggle('done', aeOk)
  els.screen.classList.toggle('done', screenOk)
  els.ae.querySelector('.badge').textContent = aeOk ? '✓' : '!'
  els.screen.querySelector('.badge').textContent = screenOk ? '✓' : '!'
  els.aeState.textContent = AE_LABELS[appleEvents] ?? ''
  els.screenState.textContent = SCREEN_LABELS[screenAccess] ?? ''

  // The consent dialog can only be raised while the decision is still pending; once
  // refused, macOS stays silent and only System Settings can undo it.
  els.aeAllow.disabled = appleEvents !== 'undetermined'

  const done = aeOk && screenOk
  els.allDone.style.display = done ? 'inline' : 'none'
  els.hint.style.display = done ? 'none' : 'inline'
  els.close.textContent = done ? 'Done' : 'Close'
}

async function refresh () {
  screenAccess = (await window.llammp.audioPermission()).screen
  window.llammp.send({ cmd: 'checkPermission' })
  render()
}

window.llammp.onEvent((ev) => {
  if (ev.type === 'permission') {
    appleEvents = ev.appleEvents
    render()
  }
})

els.aeAllow.addEventListener('click', () => {
  els.aeState.textContent = 'Waiting for your answer…'
  els.aeAllow.disabled = true
  window.llammp.send({ cmd: 'requestPermission' })
})

els.aeSettings.addEventListener('click', () => window.llammp.openSettings('automation'))
els.screenSettings.addEventListener('click', () => window.llammp.openSettings('screen'))
els.close.addEventListener('click', () => window.llammp.closeOnboarding())

// Ticking a box in System Settings raises no event, so poll while this window is open.
setInterval(refresh, 2000)
refresh()
