// System audio capture and analysis for the visualizer.
//
// Three constraints, each measured rather than assumed:
//   - a video track is mandatory to obtain audio, but can be stopped right after: the
//     audio survives;
//   - Chromium's defaults are tuned for voice (mono + AGC + noise suppression) and must
//     be switched off, otherwise the spectrum is wrong and the signal is mono;
//   - the AnalyserNode must never reach the destination, or captured sound is fed back
//     into system output and therefore into the capture.

export class Visualizer {
  constructor () {
    this.analyser = null
    this.timeBuf = null
    this.freqBuf = null
    this.ready = false
    this.error = null
  }

  async start () {
    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: { width: 1, height: 1, frameRate: 1 }
      })
    } catch (e) {
      this.error = `capture refused: ${e.name}`
      return false
    }

    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) {
      this.error = 'no audio track'
      return false
    }

    // A track delivered already 'ended' is the signature of a missing permission:
    // getDisplayMedia resolved normally, with no error at all. Detecting it here avoids
    // showing a flat visualizer that looks like silence.
    if (audioTracks[0].readyState === 'ended') {
      this.error = 'dead audio track — "Screen & System Audio Recording" permission missing'
      return false
    }

    // The video track has done its job.
    for (const v of stream.getVideoTracks()) v.stop()

    const ctx = new AudioContext()
    await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.7
    source.connect(this.analyser)

    this.timeBuf = new Uint8Array(this.analyser.fftSize)
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount)
    this.ready = true
    return true
  }

  /** Spectrum in `bars` bands, values 0..1, logarithmic in frequency. */
  spectrum (bars) {
    if (!this.ready) return new Array(bars).fill(0)
    this.analyser.getByteFrequencyData(this.freqBuf)

    const out = new Array(bars)
    const n = this.freqBuf.length
    // Logarithmic spacing: a linear spectrum crushes all musical content into the first
    // quarter of the width.
    for (let i = 0; i < bars; i++) {
      const lo = Math.floor(Math.pow(n, i / bars))
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (i + 1) / bars)))
      let peak = 0
      for (let j = lo; j < hi && j < n; j++) {
        if (this.freqBuf[j] > peak) peak = this.freqBuf[j]
      }
      out[i] = peak / 255
    }
    return out
  }

  /** Oscilloscope: `points` samples centered on 0, in [-1, 1]. */
  waveform (points) {
    if (!this.ready) return new Array(points).fill(0)
    this.analyser.getByteTimeDomainData(this.timeBuf)
    const out = new Array(points)
    const step = Math.floor(this.timeBuf.length / points)
    for (let i = 0; i < points; i++) {
      out[i] = (this.timeBuf[i * step] - 128) / 128
    }
    return out
  }
}
