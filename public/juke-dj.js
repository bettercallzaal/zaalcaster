// juke-dj.js - the audio bridge. Mix computer/tab audio + local files with the
// mic into ONE MediaStreamTrack, and patch getUserMedia so whatever publishes
// (the Juke SDK / LiveKit, wired next slice) broadcasts the mix instead of the
// bare mic. Same mechanism as the Space DJ extension, but in our own page.
//
// Browser-only (Web Audio + getDisplayMedia). No build step, no dependencies.
//
// Usage:
//   const dj = new JukeDJ();
//   dj.installBridge();              // patch getUserMedia (call before publish)
//   await dj.startMic();             // real mic into the mix
//   await dj.captureComputerAudio(); // getDisplayMedia tab/system audio
//   dj.setMicGain(0.8); dj.setMusicGain(1.0);
//   dj.getMixedStream();             // the combined MediaStream
//
// Publishing to a real Juke room needs host/speaker promotion and the Juke SDK
// driving LiveKit in this page - that lands in the next slice. The mix + bridge
// here are the reusable core.

export class JukeDJ {
  constructor() {
    this.ctx = null
    this.destination = null   // MediaStreamDestination - the mixed output
    this.micGain = null
    this.musicGain = null
    this.analyser = null
    this.micStream = null
    this.computerStream = null
    this.sources = new Map()  // label -> { node, kind }
    this.originalGUM = null
    this.bridged = false
    this.onState = null       // optional callback(state) for UI
  }

  _emit() {
    if (this.onState) this.onState(this.state())
  }

  state() {
    return {
      ready: !!this.ctx,
      bridged: this.bridged,
      mic: !!this.micStream,
      computer: !!this.computerStream,
      files: [...this.sources.keys()].filter((k) => k.startsWith('file:')),
    }
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) throw new Error('Web Audio not supported in this browser')
      this.ctx = new AC()
      this.destination = this.ctx.createMediaStreamDestination()
      this.micGain = this.ctx.createGain()
      this.musicGain = this.ctx.createGain()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      // mic and music each pass through their own gain, then into the mix bus
      this.micGain.connect(this.destination)
      this.musicGain.connect(this.destination)
      // meter the combined output
      this.micGain.connect(this.analyser)
      this.musicGain.connect(this.analyser)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  // Patch getUserMedia so downstream mic requests receive the mixed stream.
  // The real mic is fetched via the saved original and folded into the mix,
  // so the caller still gets a live voice track - plus whatever music is on.
  installBridge() {
    if (this.bridged) return
    const md = navigator.mediaDevices
    if (!md || !md.getUserMedia) throw new Error('getUserMedia unavailable')
    this._rawGUM = md.getUserMedia            // exact original, for restore
    this.originalGUM = md.getUserMedia.bind(md) // bound, for internal calls
    const self = this
    md.getUserMedia = async function (constraints) {
      if (!constraints || !constraints.audio) return self.originalGUM(constraints)
      self._ensureCtx()
      if (!self.micStream) await self._addMic(constraints)
      // video (if any) still comes from the real device
      if (constraints.video) {
        const v = await self.originalGUM({ video: constraints.video })
        for (const t of v.getVideoTracks()) self.destination.stream.addTrack(t)
      }
      return self.destination.stream
    }
    this.bridged = true
    this._emit()
  }

  removeBridge() {
    if (this.bridged && this._rawGUM) {
      navigator.mediaDevices.getUserMedia = this._rawGUM
    }
    this.bridged = false
    this._emit()
  }

  async _addMic(constraints) {
    const req = constraints && constraints.audio ? { audio: constraints.audio } : { audio: true }
    const stream = await this.originalGUM(req)
    this.micStream = stream
    const src = this.ctx.createMediaStreamSource(stream)
    src.connect(this.micGain)
    this.sources.set('mic', { node: src, kind: 'mic' })
    this._emit()
    return stream
  }

  // Explicit mic start (when not driven through the bridge).
  async startMic() {
    this._ensureCtx()
    if (this.micStream) return this.micStream
    const gum = this.originalGUM || navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const stream = await gum({ audio: true })
    this.micStream = stream
    const src = this.ctx.createMediaStreamSource(stream)
    src.connect(this.micGain)
    this.sources.set('mic', { node: src, kind: 'mic' })
    this._emit()
    return stream
  }

  // Capture live computer/tab audio. getDisplayMedia is the browser-native way
  // to grab tab or system audio - no extension needed. The user picks the
  // source in the browser's own share dialog; we keep only the audio.
  async captureComputerAudio() {
    this._ensureCtx()
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('getDisplayMedia not supported - use a Chromium browser')
    }
    const gdm = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    // drop the video track; we only want the audio
    for (const t of gdm.getVideoTracks()) t.stop()
    if (!gdm.getAudioTracks().length) {
      throw new Error('No audio in the shared source - re-share and check "share tab audio"')
    }
    this.computerStream = new MediaStream(gdm.getAudioTracks())
    const src = this.ctx.createMediaStreamSource(this.computerStream)
    src.connect(this.musicGain)
    this.sources.set('computer', { node: src, kind: 'computer' })
    // ending the share from the browser UI should clean up
    gdm.getAudioTracks()[0].addEventListener('ended', () => this.stopComputerAudio())
    this._emit()
    return this.computerStream
  }

  stopComputerAudio() {
    if (this.computerStream) {
      for (const t of this.computerStream.getTracks()) t.stop()
      this.computerStream = null
    }
    const s = this.sources.get('computer')
    if (s) { try { s.node.disconnect() } catch {} this.sources.delete('computer') }
    this._emit()
  }

  // Play a local audio file into the music bus.
  async playFile(file) {
    this._ensureCtx()
    const el = new Audio()
    el.src = URL.createObjectURL(file)
    el.loop = false
    const src = this.ctx.createMediaElementSource(el)
    src.connect(this.musicGain)
    const label = `file:${file.name}`
    this.sources.set(label, { node: src, kind: 'file', el })
    await el.play()
    el.addEventListener('ended', () => {
      const s = this.sources.get(label)
      if (s) { try { s.node.disconnect() } catch {} this.sources.delete(label) }
      this._emit()
    })
    this._emit()
    return label
  }

  setMicGain(v) { if (this.micGain) this.micGain.gain.value = clamp01(v) }
  setMusicGain(v) { if (this.musicGain) this.musicGain.gain.value = clamp01(v) }

  // 0..1 output level for a VU meter.
  level() {
    if (!this.analyser) return 0
    const buf = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteTimeDomainData(buf)
    let peak = 0
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128))
    return peak / 128
  }

  getMixedStream() {
    this._ensureCtx()
    return this.destination.stream
  }

  async stopAll() {
    this.stopComputerAudio()
    if (this.micStream) { for (const t of this.micStream.getTracks()) t.stop() ; this.micStream = null }
    for (const [label, s] of this.sources) {
      if (s.el) { s.el.pause() }
      try { s.node.disconnect() } catch {}
      this.sources.delete(label)
    }
    this.removeBridge()
    if (this.ctx) { await this.ctx.close().catch(() => {}) ; this.ctx = null }
    this._emit()
  }
}

function clamp01(v) {
  v = Number(v)
  if (!isFinite(v)) return 1
  return Math.max(0, Math.min(1.5, v))
}
