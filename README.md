# Lyrique

Time-synced, word-by-word lyrics for Spotify, Apple Music and YouTube Music, on macOS and
Windows (beta). Free, with no account and no server of its own.

**Download, screenshots and the user guide:** <https://lyrique.app/>
(releases and bug reports live in [lyrique-releases](https://github.com/Myo-Myint/lyrique-releases)).

## How it works

```
 Spotify / Apple Music                YouTube Music tab (Chrome, Edge, Brave, Arc…)
 macOS: AppleScript (osascript)       Lyrique Bridge extension
 Windows: system media controls       inject.js → content.js → background.js
            │                                      │ WebSocket, localhost only
            ▼                                      ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Lyrique (Electron)                                            │
 │ main: players, bridge, lyrics lookup + cache, tray, updates  │
 │ renderer: lyrics window, mini bar, settings, tap-to-sync     │
 └──────────────────────────────────────────────────────────────┘
```

- **Players.** On macOS, Spotify and Music are read with AppleScript a few times a second
  (`src/main/players.ts`). On Windows, a small PowerShell script reads the system media
  controls (SMTC) instead (`src/main/players-win.ts`). YouTube Music has no desktop API, so
  the browser extension in `extension/` reads the player in the tab and streams the track and
  position to the app over `127.0.0.1`.
- **Lyrics.** YouTube Music's own timed lyrics when the extension has them, then
  [LRCLIB](https://lrclib.net) (free and keyless, with word timings when available), then QQ
  Music, then plain text. Line-only lyrics get estimated word timings for the highlight
  (`src/shared/estimate.ts`). If nothing exists, you can sync a song yourself by tapping
  along, and optionally share it back to LRCLIB.
- **Nothing to configure, nothing collected.** There are no API keys in this repository, no
  analytics, and no Lyrique server. See the [privacy policy](https://github.com/Myo-Myint/lyrique-releases/blob/main/PRIVACY.md).

## Develop

Needs Node.js 22+.

```bash
npm install
npm run dev        # app with hot reload
npm test           # unit tests (vitest)
npm run typecheck
```

For YouTube Music, load `extension/` as an unpacked extension (`chrome://extensions` →
Developer mode → Load unpacked) and play something on music.youtube.com.

| Path | What's there |
|---|---|
| `src/main` | Electron main process: windows, tray, players, extension bridge, lyrics lookup, updates |
| `src/preload` | The `window.lyrique` API exposed to the renderer |
| `src/renderer` | Lyrics UI in plain TypeScript and CSS (no framework) |
| `src/shared` | LRC parsing, matching, word-timing estimates, romanization, translations (`locales/`) |
| `extension/` | The Lyrique Bridge browser extension (Manifest V3) |
| `tests/` | Unit tests |
| `scripts/` | Playwright scripts for smoke tests, screenshots and the site demo |
| `release-site/` | The public website and user README, published to lyrique-releases |

## Build

```bash
npm run dist:release   # macOS: dmg + zip for arm64 and x64
npm run dist:win       # Windows: NSIS installers for x64 and arm64
```

Icons are drawn from one master, `build/icon.svg` (full-bleed, unmasked, as Apple's icon
guidelines ask). After changing it, run `node scripts/make-icons.mjs` (needs Google Chrome) to
regenerate the Mac and Windows app icons, the extension icons, the website icon and the menu
bar template icons.

Always build Windows installers with `dist:win`. It forces 7-Zip's BCJ filter, because the
installer's unpacker can't read the ARM64 filter that newer 7-Zip picks for arm64 binaries.

## Translations

UI strings live in `src/shared/locales/`, one file per language, and `tests/i18n.test.ts`
checks that every language has every key with matching placeholders. Corrections from native
speakers are very welcome.

## License

[GPL-3.0](LICENSE). Lyrics belong to their rights holders. Lyrique shows them from public
sources for personal use and doesn't ship any.
