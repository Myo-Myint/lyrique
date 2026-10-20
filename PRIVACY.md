# Privacy Policy — Lyrique and Lyrique Bridge

_Last updated: October 20, 2026_

Lyrique (the app for Mac and Windows) and Lyrique Bridge (the Chrome extension) are free and don't collect
data about you. There are no accounts, analytics, ads or trackers.

## What the extension reads

On music.youtube.com only, Lyrique Bridge reads:

- the current track's title, artist, album, artwork link and duration,
- the playback position and whether it's playing,
- the next song in your queue (to fetch its lyrics early),
- loudness levels of the playing audio, as numbers, ~50 times a second (so lyrics can line
  up automatically). **Audio is never recorded or transmitted.**

## Where it goes

Only to the Lyrique app **on the same computer**, over a local connection (`127.0.0.1`).
It is not sent to the developer or any third party, not sold, and not used for advertising.

## What the app sends over the internet

To find lyrics, Lyrique sends the track's **title, artist, album and duration** to:

- [LRCLIB](https://lrclib.net) and
- QQ Music's public lyrics search,

and loads artwork from Google's image servers (the same images YouTube Music shows).
For songs playing in Apple Music, the cover may be looked up by title and artist in Apple's
public catalogue search (`itunes.apple.com`) when the Music app doesn't provide it.

**Romanization and translation** are off until you switch them on (the **T** key or the
menu-bar icon → *Lyrics*). While on, the song's lyric text is sent to Google Translate's
public endpoint (`translate.googleapis.com`) to translate it, or to romanize Japanese and
other scripts. Korean and Chinese romanization happen on your Mac. Nothing else is sent with
the lyrics — no account, title, or listening history.

**Lyric cards** you share are made on your Mac and only go where you paste or save them.
If you choose **Publish to LRCLIB** after syncing lyrics yourself, those lyrics and timings
are published publicly and anonymously on lrclib.net — only after you confirm.

Now and then the app asks GitHub whether a newer version of Lyrique is out. Nothing about you
or your music is sent. Turn it off in Settings → *Check for updates*.

**Copy Diagnostics** puts a short report (app and macOS versions, extension status, the
current song, which lyrics sources were tried and the last few problems) on your clipboard. It
is only shared if you paste it somewhere yourself.

Lyrique keeps a small log of problems (failed lookups, player errors, crashes) in
`~/Library/Logs/Lyrique/lyrique.log` (Windows: `%APPDATA%\Lyrique\logs`). It stays on your
computer, with your home folder shortened to `~`.

On Windows, the installer shows a short version of this policy before it installs.

## Stored on your computer

Settings, timing offsets, cached lyrics and lyrics you synced are stored locally in
`~/Library/Application Support/Lyrique` (Windows: `%APPDATA%\Lyrique`). Delete that folder to
remove them.

## Contact

Questions about privacy: email [hello@lyrique.app](mailto:hello@lyrique.app), or open an issue on
[github.com/Myo-Myint/lyrique](https://github.com/Myo-Myint/lyrique/issues).
