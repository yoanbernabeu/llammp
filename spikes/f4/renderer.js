// Moitie renderer de F4.1 + isolation de F4.2.
// Protocole du spike :
//   phase "avec-video"  (0 -> 4 s)  : piste video encore active
//   arret de la piste video a t=4 s (F4.2)
//   phase "sans-video"  (4 -> 14 s) : l'audio survit-il ?
// Verdict base sur le RMS mesure dans chaque phase.

const S = window.spike
const statusEl = document.getElementById('status')
const canvas = document.getElementById('viz')
const ctx = canvas.getContext('2d')

const lines = []
function say(msg, cls) {
  lines.push(cls ? `<span class="${cls}">${msg}</span>` : msg)
  statusEl.innerHTML = lines.join('\n')
  S.event(msg.replace(/<[^>]+>/g, ''))
}

const T_STOP_VIDEO = 4000
const T_END = 14000

const samples = { 'avec-video': [], 'sans-video': [] }
let phase = 'avec-video'
let t0 = 0

async function main() {
  let stream
  try {
    // La moitie renderer : video obligatoire, sinon la piste audio est muette (§F4.1)
    // Par defaut Chromium applique echoCancellation / noiseSuppression / autoGainControl :
    // des traitements de voix qui deforment le spectre attendu par le visualiseur.
    const audioConstraint = S.rawAudio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : true
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: audioConstraint,
      video: { width: 1, height: 1, frameRate: 1 },
    })
  } catch (e) {
    say(`ECHEC getDisplayMedia : ${e.name} — ${e.message}`, 'ko')
    S.verdict({ lines: [
      'RESULTAT : ECHEC — getDisplayMedia a rejete',
      `  ${e.name}: ${e.message}`,
      '  Cause probable : autorisation de capture refusee ou indisponible.',
    ]})
    return
  }

  const aTracks = stream.getAudioTracks()
  const vTracks = stream.getVideoTracks()
  say(`stream obtenu — ${aTracks.length} piste(s) audio, ${vTracks.length} piste(s) video`,
      aTracks.length ? 'ok' : 'ko')

  if (!aTracks.length) {
    S.verdict({ lines: [
      'RESULTAT : ECHEC — aucune piste audio dans le stream.',
      '  Le handler main process n a pas fourni audio:"loopback".',
    ]})
    return
  }

  for (const t of vTracks) {
    say(`  video: label="${t.label}" enabled=${t.enabled} state=${t.readyState}`)
  }

  for (const t of aTracks) {
    const s = t.getSettings ? t.getSettings() : {}
    say(`  audio: label="${t.label}" enabled=${t.enabled} state=${t.readyState}`)
    say(`         settings=${JSON.stringify(s)}`)
  }

  // Chaine d analyse (F4.3)
  const ac = new AudioContext()
  await ac.resume()
  const src = ac.createMediaStreamSource(stream)
  const analyser = ac.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.8
  src.connect(analyser)
  // NOTE : on ne connecte PAS analyser -> destination, sinon on reinjecte le son
  // capture dans la sortie systeme (boucle de larsen).
  say(`AudioContext sampleRate=${ac.sampleRate} state=${ac.state}`)

  const timeBuf = new Uint8Array(analyser.fftSize)
  const freqBuf = new Uint8Array(analyser.frequencyBinCount)

  let videoStopped = false
  let lastReport = 0
  t0 = performance.now()

  function frame() {
    const t = performance.now() - t0

    // F4.2 : arret de la piste video, l audio doit survivre
    if (!videoStopped && t >= T_STOP_VIDEO) {
      videoStopped = true
      for (const v of vTracks) v.stop()
      phase = 'sans-video'
      say(`t=${Math.round(t)}ms — piste(s) video STOPPEE(S) (F4.2)`, 'warn')
      say(`  audio track apres stop : state=${aTracks[0].readyState} enabled=${aTracks[0].enabled}`)
    }

    analyser.getByteTimeDomainData(timeBuf)
    analyser.getByteFrequencyData(freqBuf)

    // RMS sur le domaine temporel, centre sur 128
    let sum = 0, peak = 0
    for (let i = 0; i < timeBuf.length; i++) {
      const d = (timeBuf[i] - 128) / 128
      sum += d * d
      if (Math.abs(d) > peak) peak = Math.abs(d)
    }
    const rms = Math.sqrt(sum / timeBuf.length)
    samples[phase].push(rms)

    draw(freqBuf, rms)

    if (t - lastReport >= 1000) {
      lastReport = t
      const bands = []
      const step = Math.floor(freqBuf.length / 8)
      for (let b = 0; b < 8; b++) {
        let m = 0
        for (let i = b * step; i < (b + 1) * step; i++) m = Math.max(m, freqBuf[i])
        bands.push(m)
      }
      S.report({ t: Math.round(t), phase, rms, peak, bands })
    }

    if (t >= T_END) { finish(); return }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function draw(freqBuf, rms) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const bars = 64
  const step = Math.floor(freqBuf.length / bars)
  const w = canvas.width / bars
  for (let i = 0; i < bars; i++) {
    let m = 0
    for (let j = i * step; j < (i + 1) * step; j++) m = Math.max(m, freqBuf[j])
    const h = (m / 255) * canvas.height
    ctx.fillStyle = `hsl(${120 - (m / 255) * 120}, 100%, 50%)`
    ctx.fillRect(i * w, canvas.height - h, w - 1, h)
  }
  ctx.fillStyle = rms > 0.001 ? '#00ff00' : '#ff4444'
  ctx.fillRect(0, 0, Math.min(rms * 2000, canvas.width), 3)
}

function stats(arr) {
  if (!arr.length) return { n: 0, avg: 0, max: 0, nonZero: 0 }
  let sum = 0, max = 0, nz = 0
  for (const v of arr) { sum += v; if (v > max) max = v; if (v > 0.0005) nz++ }
  return { n: arr.length, avg: sum / arr.length, max, nonZero: nz }
}

function finish() {
  const a = stats(samples['avec-video'])
  const b = stats(samples['sans-video'])
  const SEUIL = 0.0005

  const out = []
  out.push(`Phase AVEC video  : n=${a.n} rms_moy=${a.avg.toFixed(5)} rms_max=${a.max.toFixed(5)} frames_avec_signal=${a.nonZero}/${a.n}`)
  out.push(`Phase SANS video  : n=${b.n} rms_moy=${b.avg.toFixed(5)} rms_max=${b.max.toFixed(5)} frames_avec_signal=${b.nonZero}/${b.n}`)
  out.push('')

  const sigA = a.max > SEUIL
  const sigB = b.max > SEUIL

  if (!sigA && !sigB) {
    out.push('RESULTAT : ECHEC — piste audio SILENCIEUSE dans les deux phases.')
    out.push('  Soit rien ne jouait, soit le loopback ne capture pas le son systeme.')
  } else if (sigA && !sigB) {
    out.push('RESULTAT : REGRESSION SUR F4.2 — le signal DISPARAIT apres arret de la video.')
    out.push('  La piste video ne peut pas etre stoppee : il faut la garder vivante.')
  } else if (sigB) {
    out.push('RESULTAT : SUCCES — signal capture ET conserve apres arret de la piste video.')
    out.push('  F4.1 et F4.2 sont valides sur cette machine.')
    const ratio = a.max > 0 ? (b.max / a.max) : 0
    out.push(`  Ratio d amplitude sans/avec video : ${ratio.toFixed(2)}`)
  }
  S.verdict({ lines: out })
  say('spike termine', 'ok')
}

main()
