<img src="docs/icon.png" width="96" alt="Lyrique" />

# Lyrique

> **Lyrica is now Lyrique.** New name and icon, same app. Install Lyrique and open it: your
> settings and synced lyrics come along. Then drag the old Lyrica app to the Trash.

Beautiful, time-synced lyrics for **Spotify, Apple Music and YouTube Music** on your Mac:
word-by-word highlighting,
full screen on a big display, a floating mini bar, romanization and translation, and lyrics
that line themselves up with the song.

Free and [open source](https://github.com/Myo-Myint/lyrique). For macOS on Apple Silicon (M1 and later) and Intel Macs, and
Windows 10 and 11 in beta.

**Website and demo:** https://lyrique.app/

## Install

1. **Download** from the [latest release](../../releases/latest):
   - `Lyrique-<version>-arm64.dmg` for Apple Silicon Macs (M1, M2, M3, M4 and later)
   - `Lyrique-<version>-x64.dmg` for Intel Macs

   Not sure which Mac you have? Apple menu → About This Mac: "Chip: Apple M…" means arm64,
   "Processor: … Intel" means x64.
2. Open the DMG and drag **Lyrique** into **Applications**.
3. **First launch only:** this early version isn't notarized by Apple yet, so macOS asks you
   to confirm it once:
   1. Open Lyrique from Applications. macOS says it can't verify the app — click **Done**.
   2. Open **System Settings → Privacy & Security**, scroll down to the Lyrique message, and
      click **Open Anyway**, then confirm.

   After that, Lyrique opens normally.
4. **Spotify or Apple Music:** nothing else to install. Play a song; the first time, macOS
   asks to let Lyrique see Spotify or Music — click **Allow**.
5. **YouTube Music:** add the browser extension _Lyrique Bridge_. Its Chrome Web Store
   listing is in review (link coming soon); until then Lyrique's Setup Guide walks you
   through loading it. It works in **Chrome, Edge, Brave, Arc, Opera and Vivaldi**.

### Windows (beta)

1. **Download** from the [Windows beta release](../../releases/tag/v0.6.0-beta.1):
   - `Lyrique-0.6.0-x64.exe` for almost every Windows PC (Intel or AMD)
   - `Lyrique-0.6.0-arm64.exe` for Windows on Arm (Snapdragon laptops, Surface Pro X)
2. Run it. After a short privacy notice it installs just for you, with no admin rights needed.
   The beta isn't code-signed yet, so if SmartScreen says "Windows protected your PC", click
   **More info → Run anyway**. Signing is being set up: see the
   [code signing policy](https://lyrique.app/code-signing.html).
3. Spotify and Apple Music are followed through Windows' own media controls, with nothing to
   set up. YouTube Music uses the same browser extension as on the Mac.

Lyrics appear as soon as a song plays. With several players open, Lyrique follows the one
that started playing most recently.

## Using it

| | |
|---|---|
| **Settings** (players, text, timing, where lyrics show) | **⌘,**, or the sliders button in the top bar |
| **Every keyboard shortcut** | **?**, or the ? button at the bottom right |
| **Play / pause, ±10 s, previous / next** | the buttons at the bottom of the window (move the mouse), or Space · ← / → · ⇧← / ⇧→ |
| **Full screen on another display** | menu-bar icon → *Show on Display*, then **F** |
| **Karaoke** (full screen, lyrics only, extra large) | **K** (Esc to leave), or menu-bar icon → *Karaoke Mode* |
| **Cover view** (artwork as the hero) | **C**, or click the artwork |
| **Mini lyrics bar** over every window | **M** in Lyrique, or **⌥⌘L** from anywhere |
| **Romanization / translation** under each line | **T** (translation language: menu-bar icon → *Lyrics* → *Translate To*) |
| **Text size** | **+** / **−** (or menu-bar icon → *Lyrics*) |
| **Font** (system, rounded, serif) | menu-bar icon → *Lyrics* |
| **Share a line** as an image | right-click the line, or **S** for the current one |
| **Wrong lyrics?** | ↻ in the top bar (or click the source name) to pick another version |
| **Lyrics in the menu bar** | menu-bar icon → *Lyrics in Menu Bar* |
| **Language** (English, Español, Français, Português, မြန်မာ, ไทย, 日本語, 한국어, 简体中文, 繁體中文) | follows your Mac; change it in Settings → *Language* |
| **What's new** after an update | shown once; reopen from the menu-bar icon → *What's New…* |
| **Calmer view** (still background, lines fade instead of slide) | Settings → *Reduce motion* (on automatically with macOS Reduce Motion) |
| **Choose which apps to follow** | menu-bar icon → *Follow* |
| **Lyrics timing off?** | − / + in the top bar nudges this song; ⌥ − / + adjusts for your headphones (e.g. AirPods) |
| **No lyrics?** | *Sync it yourself*: paste the words and tap Space as each line starts |

## Updates

Lyrique checks this page and tells you when a new version is out (menu-bar icon → *Update
Available*). Download it and replace the app in Applications.

## Problems or ideas

[Open an issue](../../issues/new/choose). For bugs, click the menu-bar icon → **Copy
Diagnostics** and paste it in: it lists the app and extension versions and which lyrics
sources were tried, which makes most problems quick to find.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: nothing about your listening leaves your Mac except
title/artist lookups to lyrics services (and Apple's catalogue, for Apple Music covers),
and lyric text to Google Translate only while
romanization or translation is switched on.
