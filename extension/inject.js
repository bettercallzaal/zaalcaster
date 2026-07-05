// inject.js - MAIN world, document_start. Patches getUserMedia BEFORE Juke's
// SDK grabs the mic, so the mic Juke publishes is actually a live mix of your
// voice + captured tab audio + local files. Same mechanism as Space DJ, scoped
// to juke.audio.
//
// Talks to the content script (isolated world) via window CustomEvents:
//   in : zc-dj-tab-stream {streamId} | zc-dj-stop-tab | zc-dj-file {url,name}
//        zc-dj-gain {bus,value} | zc-dj-level-req
//   out: zc-dj-state {mic,tab,files} | zc-dj-level {value} | zc-dj-error {message}

(function () {
  if (window.__zcDjInstalled) return
  window.__zcDjInstalled = true

  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)

  let ctx = null, dest = null, micGain = null, musicGain = null, analyser = null
  let micStream = null, tabStream = null
  const files = new Map() // name -> { el, node }

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }))
  }
  function state() {
    return { mic: !!micStream, tab: !!tabStream, files: [...files.keys()] }
  }
  function emitState() { emit('zc-dj-state', state()) }
  function err(message) { emit('zc-dj-error', { message }) }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      ctx = new AC()
      dest = ctx.createMediaStreamDestination()
      micGain = ctx.createGain()
      musicGain = ctx.createGain()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      micGain.connect(dest); micGain.connect(analyser)
      musicGain.connect(dest); musicGain.connect(analyser)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  // Patch: any audio getUserMedia returns the mixed destination stream.
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (!constraints || !constraints.audio) return realGUM(constraints)
    ensureCtx()
    if (!micStream) {
      try {
        micStream = await realGUM({ audio: constraints.audio })
        ctx.createMediaStreamSource(micStream).connect(micGain)
      } catch (e) { err('mic: ' + e.message); throw e }
    }
    if (constraints.video) {
      try {
        const v = await realGUM({ video: constraints.video })
        for (const t of v.getVideoTracks()) dest.stream.addTrack(t)
      } catch {}
    }
    emitState()
    return dest.stream
  }

  async function addTabStream(streamId) {
    ensureCtx()
    try {
      const s = await realGUM({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } },
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } },
      })
      for (const t of s.getVideoTracks()) t.stop()
      if (!s.getAudioTracks().length) { err('shared source had no audio - re-share with "share tab audio" checked'); return }
      tabStream = new MediaStream(s.getAudioTracks())
      ctx.createMediaStreamSource(tabStream).connect(musicGain)
      tabStream.getAudioTracks()[0].addEventListener('ended', stopTab)
      emitState()
    } catch (e) { err('tab capture: ' + e.message) }
  }

  function stopTab() {
    if (tabStream) { for (const t of tabStream.getTracks()) t.stop(); tabStream = null }
    emitState()
  }

  async function addFile(url, name) {
    ensureCtx()
    try {
      const el = new Audio(); el.src = url; el.crossOrigin = 'anonymous'
      const node = ctx.createMediaElementSource(el)
      node.connect(musicGain)
      files.set(name, { el, node })
      await el.play()
      el.addEventListener('ended', () => { files.delete(name); emitState() })
      emitState()
    } catch (e) { err('file: ' + e.message) }
  }

  function level() {
    if (!analyser) return 0
    const buf = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(buf)
    let peak = 0
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128))
    return peak / 128
  }

  window.addEventListener('zc-dj-tab-stream', (e) => addTabStream(e.detail.streamId))
  window.addEventListener('zc-dj-stop-tab', stopTab)
  window.addEventListener('zc-dj-file', (e) => addFile(e.detail.url, e.detail.name))
  window.addEventListener('zc-dj-gain', (e) => {
    ensureCtx()
    const g = e.detail.bus === 'mic' ? micGain : musicGain
    if (g) g.gain.value = Math.max(0, Math.min(1.5, Number(e.detail.value)))
  })
  window.addEventListener('zc-dj-level-req', () => emit('zc-dj-level', { value: level() }))

  emit('zc-dj-ready', {})
})();
