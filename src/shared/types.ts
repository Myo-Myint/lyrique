/** Message sent by the browser extension to the desktop app. */
export interface PlayerState {
  type: 'state'
  /** YouTube video id of the current item. */
  videoId: string
  title: string
  artist: string
  album: string
  /** Duration in seconds (0 if unknown). */
  duration: number
  /** Playback position in seconds at `sentAt`. */
  position: number
  playing: boolean
  /** Playback rate (1 = normal). */
  rate: number
  /** Largest artwork URL available, or ''. */
  artwork: string
  /** ATV = audio track, OMV = official music video, UGC = user upload, PODCAST. */
  videoType: string
  isAd: boolean
  /** Page-script feature version (absent on the first release). */
  bridge?: number
  /** Where this came from: the browser extension (YouTube Music) or a Mac app. */
  player?: 'ytm' | 'spotify' | 'music'
  /** Next song in the YouTube Music queue, if visible (used to prefetch lyrics). */
  next?: { title: string; artist: string; duration: number } | null
  /** Extension-side wall clock (ms since epoch) when `position` was sampled. */
  sentAt: number
}

export interface Word {
  text: string
  startMs: number
  endMs: number
}

export interface Line {
  text: string
  startMs: number
  /** Inferred from the next line when the source has none. */
  endMs: number
  words?: Word[]
  /**
   * A second line the lyrics file gives the same timestamp — usually romanization or a
   * translation of the line above it. Shown under the line, not as a line of its own.
   */
  sub?: string
  /**
   * Duets: who sings this line, when the file marks singers ("v1:" / "v2:", or karaoke-style
   * "M:" / "F:" / "D:"). 1 and 2 are the two singers, 3 is both together.
   */
  singer?: 1 | 2 | 3
}

export type LyricsKind = 'synced' | 'plain' | 'instrumental' | 'none'

export interface Lyrics {
  kind: LyricsKind
  source: string
  /** Lines with timings (empty for plain / none). */
  lines: Line[]
  /** Plain text lyrics (used when no synced lyrics exist). */
  plain: string
  wordSynced: boolean
  /** Providers searched to produce this result, in order (for the "nothing found" screen). */
  tried?: string[]
  /** Chosen by hand in the lyrics picker: wins over automatic matches for this song. */
  picked?: { id: string }
  /** Which track metadata this was matched against. */
  matched: { title: string; artist: string; album: string; duration: number }
}

/** Track metadata sent to the renderer together with lyrics. */
export interface TrackInfo {
  videoId: string
  title: string
  artist: string
  album: string
  duration: number
  videoType: string
  /** data: URL of the artwork or ''. */
  artwork: string
}

export interface Settings {
  alwaysOnTop: boolean
  /** Global lyrics offset in ms (positive = lyrics appear later). */
  globalOffsetMs: number
  /** Per-video offsets in ms. */
  trackOffsets: Record<string, number>
  /** Per audio-output-device offsets in ms (e.g. Bluetooth headphones play ~150–220 ms late). */
  deviceOffsets: Record<string, number>
  /** Offsets found by audio auto-sync, per video id, valid only for the lyrics source they were measured on. */
  autoOffsets: Record<string, AutoOffset>
  /** Lines before/after the active one that stay readable. */
  focusRadius: number
  port: number
  blur: boolean
  /** Electron display id the window lives on (null = wherever macOS puts it). */
  displayId: number | null
  /** Re-enter full screen on launch / when that display reconnects. */
  fullscreen: boolean
  /** Songs where you chose the original lyrics over your own sync. */
  userSyncOff: Record<string, true>
  /** Setup checklist finished or dismissed. */
  onboarded: boolean
  /** Second line under each lyric: off, romanization (non-Latin scripts) or translation. */
  subMode: SubMode
  /** Translation target language code ('' = the system language). */
  translateTo: string
  /** Lyrics text size multiplier. */
  textScale: number
  font: LyricsFont
  /** Floating mini-lyrics bar is open. */
  mini: boolean
  miniBounds: { x: number; y: number; width: number; height: number } | null
  /** Current lyric line as text next to the menu-bar icon. */
  menuBarLyrics: boolean
  /** Mac apps Lyrique follows directly (no extension needed). */
  players: { spotify: boolean; music: boolean }
  /** The one-time "press ? for shortcuts" tip has been shown. */
  shortcutTipShown: boolean
  /** Calm view (no drifting background, sliding or lifting lines); also on with macOS Reduce Motion. */
  reduceMotion: boolean
  /** Interface language code ('' = follow macOS). */
  language: string
  /** Lyrique version whose "What's new" was last shown ('' = from before the card existed). */
  seenVersion: string
  /** Ask GitHub now and then whether a newer release is out. */
  checkUpdates: boolean
}

export type SubMode = 'off' | 'romanize' | 'translate'
export type LyricsFont = 'default' | 'rounded' | 'serif'
export const TEXT_SCALES = [0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6]

/** Whether a song has lyrics you synced, and whether they're the ones showing. */
export type UserSyncState = 'none' | 'on' | 'off'

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: false,
  globalOffsetMs: 0,
  trackOffsets: {},
  deviceOffsets: {},
  autoOffsets: {},
  focusRadius: 3,
  port: 41337,
  blur: true,
  displayId: null,
  fullscreen: false,
  userSyncOff: {},
  onboarded: false,
  subMode: 'off',
  translateTo: '',
  textScale: 1,
  font: 'default',
  mini: false,
  miniBounds: null,
  menuBarLyrics: false,
  players: { spotify: true, music: true },
  shortcutTipShown: false,
  reduceMotion: false,
  language: '',
  seenVersion: '',
  checkUpdates: true
}

export interface AutoOffset {
  offsetMs: number
  /** Lyrics `source` the offset was measured against. */
  source: string
}

export interface ConnectionStatus {
  extensionConnected: boolean
  port: number
}
