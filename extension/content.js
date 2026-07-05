// content.js - isolated world. Injects a floating DJ panel into juke.audio and
// bridges: toolbar/desktopCapture (via background) <-> the MAIN-world mixer in
// inject.js (via window CustomEvents). No page code can see these listeners.

(function () {
  if (window.__zcDjPanel) return
  window.__zcDjPanel = true

  const send = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }))

  const panel = document.createElement('div')
  panel.id = 'zc-dj-panel'
  panel.innerHTML = `
    <style>
      #zc-dj-panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: 260px; font: 13px/1.4 -apple-system, system-ui, sans-serif;
        background: #151529; color: #e8e8ea; border: 1px solid #33334d;
        border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.5); overflow: hidden; }
      #zc-dj-panel .hd { display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; background: #1b1b33; border-bottom: 1px solid #2a2a44; }
      #zc-dj-panel .hd b { font-size: 12px; letter-spacing: .4px; }
      #zc-dj-panel .hd .x { cursor: pointer; color: #8a8a9a; }
      #zc-dj-panel .bd { padding: 12px; }
      #zc-dj-panel button { width: 100%; font: inherit; margin: 4px 0; padding: 8px;
        background: #242442; color: #e8e8ea; border: 1px solid #383858;
        border-radius: 8px; cursor: pointer; }
      #zc-dj-panel button:hover { border-color: #855DCD; }
      #zc-dj-panel button.live { background: #D85A30; border-color: #D85A30; color: #fff; }
      #zc-dj-panel .fader { margin: 8px 0; }
      #zc-dj-panel .fader label { display: flex; justify-content: space-between; color: #9a9aac; }
      #zc-dj-panel input[type=range] { width: 100%; accent-color: #855DCD; }
      #zc-dj-panel .meter { height: 8px; background: #0c0c1c; border-radius: 4px; overflow: hidden; margin-top: 6px; }
      #zc-dj-panel .meter i { display: block; height: 100%; width: 0;
        background: linear-gradient(90deg,#855DCD,#D85A30); }
      #zc-dj-panel .st { font-size: 11px; color: #7a7a8a; margin-top: 8px; min-height: 14px; }
      #zc-dj-panel .err { color: #ff8a6a; }
    </style>
    <div class="hd"><b>SPACE DJ</b><span class="x" id="zc-x">hide</span></div>
    <div class="bd">
      <button id="zc-tab">capture tab audio</button>
      <button id="zc-file">play a file</button>
      <input id="zc-fileinput" type="file" accept="audio/*" hidden />
      <div class="fader"><label><span>mic</span><span id="zc-micv">80%</span></label>
        <input id="zc-mic" type="range" min="0" max="150" value="80"></div>
      <div class="fader"><label><span>music</span><span id="zc-musicv">100%</span></label>
        <input id="zc-music" type="range" min="0" max="150" value="100"></div>
      <div class="meter"><i id="zc-meter"></i></div>
      <div class="st" id="zc-st">install: join your space as host, then capture a tab.</div>
    </div>`
  const mount = () => { if (document.body && !document.getElementById('zc-dj-panel')) document.body.appendChild(panel) }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)

  const $ = (id) => panel.querySelector('#' + id)
  const st = (m, isErr) => { const e = $('zc-st'); e.textContent = m; e.className = 'st' + (isErr ? ' err' : '') }

  $('zc-x').addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? '' : 'none' })

  $('zc-tab').addEventListener('click', () => {
    const btn = $('zc-tab')
    if (btn.classList.contains('live')) { send('zc-dj-stop-tab'); return }
    st('pick a tab (check "share tab audio")...')
    chrome.runtime.sendMessage({ type: 'ZC_DJ_REQUEST_TAB_CAPTURE' }, (res) => {
      if (chrome.runtime.lastError) { st(chrome.runtime.lastError.message, true); return }
      if (!res?.ok) { st(res?.error || 'capture cancelled', true); return }
      send('zc-dj-tab-stream', { streamId: res.streamId })
    })
  })

  $('zc-file').addEventListener('click', () => $('zc-fileinput').click())
  $('zc-fileinput').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return
    send('zc-dj-file', { url: URL.createObjectURL(f), name: f.name })
  })

  $('zc-mic').addEventListener('input', (e) => { $('zc-micv').textContent = e.target.value + '%'; send('zc-dj-gain', { bus: 'mic', value: e.target.value / 100 }) })
  $('zc-music').addEventListener('input', (e) => { $('zc-musicv').textContent = e.target.value + '%'; send('zc-dj-gain', { bus: 'music', value: e.target.value / 100 }) })

  window.addEventListener('zc-dj-state', (e) => {
    const s = e.detail
    $('zc-tab').classList.toggle('live', s.tab)
    $('zc-tab').textContent = s.tab ? 'stop tab audio' : 'capture tab audio'
    const on = []
    if (s.mic) on.push('mic')
    if (s.tab) on.push('tab')
    on.push(...s.files)
    st(on.length ? 'live: ' + on.join(', ') : 'ready - start your mic in the space first')
  })
  window.addEventListener('zc-dj-error', (e) => st(e.detail.message, true))
  window.addEventListener('zc-dj-level', (e) => { $('zc-meter').style.width = Math.round(e.detail.value * 100) + '%' })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ZC_DJ_TOGGLE') panel.style.display = panel.style.display === 'none' ? '' : 'none'
  })

  setInterval(() => send('zc-dj-level-req'), 100)
})();
