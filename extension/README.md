# Zaalcaster Space DJ (Chrome extension)

Play any tab's audio - music, clips, sound effects - into a Juke space you host,
mixed live with your mic. Same mechanism as Space DJ, scoped to juke.audio.

## Why an extension (and not just a web page)

To broadcast audio into a Juke space you have to be a promoted host/speaker, and
the audio is published by Juke's own page via LiveKit. An extension can patch the
browser mic on juke.audio itself, so Juke publishes your mix - no rebuilding
Juke's auth/host/publish stack. A standalone page can't reach into juke.audio's
cross-origin publish. (The standalone mixer at `public/dj.html` is for
monitoring the mix locally.)

## Install (one time)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this `extension/` folder
4. The "Zaalcaster Space DJ" icon appears in the toolbar

## Use

1. On juke.audio, open a space **you host** (create one with
   `npm run spaces create "Title" --yes`, or the Juke app) and start speaking so
   your mic is live - this is when Juke grabs the mic and the bridge takes over.
2. A **SPACE DJ** panel sits bottom-right (toolbar icon toggles it).
3. Click **capture tab audio**, pick the tab playing your music, and check
   **"Share tab audio"** in Chrome's picker.
4. Ride the **mic** and **music** faders. The meter shows the combined output.
5. **play a file** mixes a local audio file in instead of/alongside a tab.

Your space now broadcasts mic + music. Stop by toggling capture off or leaving
the space.

## Notes

- Chromium browsers only (Chrome, Brave, Arc, Edge) - uses `desktopCapture`.
- If the meter stays flat, make sure your mic is actually live in the space
  first - the mix only forms once Juke requests the mic.
- No keys, no secrets. The extension only touches juke.audio pages.
