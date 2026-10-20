# Publishing Lyrique Bridge to the Chrome Web Store

Package: `npm run pack:extension` → `dist/lyrique-bridge.zip` (upload this).
Requires a Chrome Web Store developer account (one-time $5). Publishing makes the extension public.

## Listing

**Name:** Lyrique Bridge for YouTube Music

**Summary (≤132 chars):**
Connects YouTube Music to the Lyrique desktop app on your Mac for synced, word-by-word lyrics.

**Description:**
Lyrique Bridge connects music.youtube.com to Lyrique, a macOS app that shows beautiful,
time-synced lyrics for whatever you're playing — on your laptop or full screen on a big display.

- Sends the current track (title, artist, artwork, position) to Lyrique on this computer
- Lets Lyrique control playback: play/pause, skip, seek
- Measures when singing happens (loudness levels only) so Lyrique can line lyrics up automatically

Requires the Lyrique desktop app running on the same Mac. Nothing is sent anywhere else.

**Category:** Entertainment · **Language:** English

## Permission justifications

| Permission | Why |
|---|---|
| `host_permissions: https://music.youtube.com/*` | Read the playing track and playback position from the YouTube Music page, and control playback when you use Lyrique's buttons. |
| `storage` | Remember the local port Lyrique listens on. |
| `alarms` | Periodically retry connecting to the Lyrique app if it was closed. |

Single purpose: show synced lyrics for YouTube Music in the Lyrique desktop app.

Remote code: none. All code ships in the package.

## Privacy practices (data disclosure form)

- **Data collected:** website content (track title, artist, album, artwork URL, playback
  position, the next queued song, and per-20 ms loudness levels of the playing audio).
- **Where it goes:** only to the Lyrique app on the same computer, over `ws://127.0.0.1`. Not
  sent to the developer or any third party. Not sold. Not used for advertising or credit.
- **Audio:** the extension never records or transmits audio, only numeric loudness levels.
- The Lyrique app itself looks up lyrics by title/artist from LRCLIB (lrclib.net) and QQ Music.

A privacy policy URL is required; this section can be published as that page.
