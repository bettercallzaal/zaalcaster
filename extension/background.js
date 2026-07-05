// background.js - service worker. Two jobs:
//  1. Run the desktopCapture picker (only callable from the extension, not a
//     content script) and hand the resulting tab-audio streamId back.
//  2. Toggle the DJ panel when the toolbar icon is clicked.

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'ZC_DJ_TOGGLE' }).catch(() => {})
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'ZC_DJ_REQUEST_TAB_CAPTURE') return
  const tab = sender.tab
  if (!tab || !tab.id) { sendResponse({ ok: false, error: 'no originating tab' }); return true }

  // ['tab','audio'] lets the host pick a tab and include its audio.
  chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], tab, (streamId) => {
    if (!streamId) { sendResponse({ ok: false, error: 'cancelled' }); return }
    sendResponse({ ok: true, streamId })
  })
  return true // async response
})
