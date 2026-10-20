/**
 * Mini lyrics bar: one line at a time, word by word, in a slim window that floats above
 * everything. Same clock, offsets and word timings as the main window.
 */
import './locale'
import { t } from '../shared/i18n'
import type { Line, Lyrics, Settings, TrackInfo, Word } from '../shared/types'
import { PlaybackClock } from './clock'
import { estimateWords } from '../shared/estimate'
import { extractPalette } from './palette'

window.addEventListener('error', (e) => void window.lyrique.logProblem('mini', `${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`))
window.addEventListener('unhandledrejection', (e) => void window.lyrique.logProblem('mini', String(e.reason?.message ?? e.reason)))

const $ = (id: string) => document.getElementById(id)!
const curEl = $('cur')
const subEl = $('sub')
const artEl = $('art') as HTMLImageElement
const playBtn = $('play')
const progressEl = $('progress')

/** Same lead as the main window: a hair early reads as on time. */
const LEAD_MS = 40
/** After the last word, this long with nothing sung (and the next line further off) shows dots. */
const GAP_MS = 2500

const clock = new PlaybackClock()
let track: TrackInfo | null = null
let lyrics: Lyrics | null = null
let settings: Settings | null = null
let connected = false
let subs: Array<string | null> = []
let deviceOffsetMs = 0
let outputDevice = 'default'

interface Row {
  key: string
  el: HTMLElement
  words: Array<{ el: HTMLElement; w: Word; wipeMs: number; lastP: number }>
}
let row: Row | null = null
/** Word timings per line, real or estimated, computed once per lyrics. */
let lineWords: Word[][] = []

function offsetMs(): number {
  if (!settings || !track) return 0
  const manual = settings.trackOffsets[track.videoId] ?? 0
  const auto = settings.autoOffsets[track.videoId]
  const song = manual !== 0 ? manual : auto && lyrics && auto.source === lyrics.source ? auto.offsetMs : 0
  return song + settings.globalOffsetMs + deviceOffsetMs
}

function setLyrics(l: Lyrics | null): void {
  lyrics = l
  subs = []
  lineWords = l?.kind === 'synced' ? l.lines.map((line) => (line.words?.length ? line.words : estimateWords(line))) : []
  row = null
  void loadSubs()
}

async function loadSubs(): Promise<void> {
  const l = lyrics
  if (!settings || settings.subMode === 'off' || l?.kind !== 'synced') {
    subs = []
    return
  }
  const r = await window.lyrique.subtitles(
    l.lines.map((x) => x.text),
    settings.subMode
  )
  if (l === lyrics) {
    subs = r.lines
    row = null // rebuild with the second line
  }
}

/* -------------------------------- render -------------------------------- */

function show(key: string, build: (el: HTMLElement) => Row['words'], sub: string, dim = false): void {
  if (row?.key === key) {
    if (subEl.textContent !== sub) subEl.textContent = sub
    return
  }
  const old = curEl.querySelector('.row:not(.out)')
  if (old) {
    old.classList.add('out')
    window.setTimeout(() => old.remove(), 450)
  }
  const el = document.createElement('div')
  el.className = 'row in' + (dim ? ' dim' : '')
  const words = build(el)
  curEl.appendChild(el)
  fit(el)
  requestAnimationFrame(() => el.classList.remove('in'))
  row = { key, el, words }
  subEl.textContent = sub
}

/** Shrink a long line to fit (down to 62%), then let it wrap to two lines. */
function fit(el: HTMLElement): void {
  el.style.setProperty('--fit', '1')
  el.classList.remove('wrap')
  curEl.style.setProperty('--rows', '1')
  const ratio = el.clientWidth / el.scrollWidth
  if (ratio >= 1) return
  if (ratio >= 0.62) {
    el.style.setProperty('--fit', ratio.toFixed(3))
    return
  }
  el.style.setProperty('--fit', '0.72')
  el.classList.add('wrap')
  curEl.style.setProperty('--rows', '1.45')
}

function textRow(text: string) {
  return (el: HTMLElement) => {
    el.textContent = text
    return []
  }
}

function dotsRow(el: HTMLElement): Row['words'] {
  const d = document.createElement('span')
  d.className = 'dots'
  for (let i = 0; i < 3; i++) d.appendChild(document.createElement('i'))
  el.appendChild(d)
  return []
}

function lineRow(words: Word[]) {
  return (el: HTMLElement) =>
    words.map((w) => {
      const span = document.createElement('span')
      span.className = 'w'
      span.textContent = w.text
      el.appendChild(span)
      return { el: span, w, wipeMs: Math.max(100, w.endMs - w.startMs), lastP: -1 }
    })
}

const nameLine = () => (track ? `${track.title} — ${track.artist}` : '')

function frame(): void {
  requestAnimationFrame(frame)
  update()
}

let lastUpdate = 0
let lastProgress = 0

function update(): void {
  lastUpdate = performance.now()
  playBtn.classList.toggle('paused', !clock.isPlaying)
  if (track?.duration && lastUpdate - lastProgress > 250) {
    lastProgress = lastUpdate
    progressEl.style.transform = `scaleX(${Math.min(1, clock.now() / track.duration).toFixed(4)})`
  }
  if (!connected) return show('conn', textRow(t('mini.waiting')), t('mini.players'), true)
  if (!track) return show('idle', textRow(t('mini.playSomething')), '', true)
  if (!lyrics) return show(`find:${track.videoId}`, textRow(track.title), t('mini.finding'), true)
  if (lyrics.kind === 'instrumental') return show(`inst:${track.videoId}`, textRow(track.title), t('mini.instrumental'), true)
  if (lyrics.kind !== 'synced') {
    const why = lyrics.kind === 'plain' ? t('mini.unsynced') : t('mini.none')
    return show(`none:${track.videoId}`, textRow(track.title), why, true)
  }
  const ms = clock.now() * 1000 + LEAD_MS - offsetMs()
  const lines = lyrics.lines
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startMs > ms) break
    if (lines[i]!.text.trim()) idx = i
  }
  const next = nextSung(lines, idx + 1)
  const nextText = next >= 0 ? lines[next]!.text : ''
  if (idx < 0) {
    // Intro: the song's name, and the first line coming up.
    return show(`intro:${track.videoId}`, textRow(nameLine()), nextText, true)
  }
  const words = lineWords[idx] ?? []
  const sungUntil = words.length ? words[words.length - 1]!.endMs : lines[idx]!.endMs
  const nextStart = next >= 0 ? lines[next]!.startMs : Infinity
  if (ms > sungUntil + 800 && nextStart - ms > GAP_MS) {
    return show(`gap:${idx}`, dotsRow, nextText ? t('mini.next', { line: nextText }) : '')
  }
  const fileSub = lines[idx]!.sub
  const sub = settings?.subMode === 'translate' ? (subs[idx] ?? fileSub) : (fileSub ?? subs[idx])
  show(`line:${track.videoId}:${idx}:${subs.length}`, lineRow(words), sub ?? nextText)
  for (const we of row?.words ?? []) {
    const p = Math.min(1, Math.max(0, (ms - we.w.startMs) / we.wipeMs))
    if (Math.abs(p - we.lastP) >= 0.002 || (p === 1 && we.lastP !== 1)) {
      we.lastP = p
      we.el.style.setProperty('--p', p.toFixed(3))
    }
  }
}

function nextSung(lines: Line[], from: number): number {
  for (let i = Math.max(0, from); i < lines.length; i++) if (lines[i]!.text.trim()) return i
  return -1
}

requestAnimationFrame(frame)
// rAF pauses while macOS considers the window occluded; keep time with a timer too.
window.setInterval(() => {
  if (performance.now() - lastUpdate > 150) update()
}, 100)

/* ------------------------------ look & offsets ------------------------------ */

function applySettings(s: Settings): void {
  document.body.classList.toggle('reduced', s.reduceMotion)
  const modeChanged = !settings || settings.subMode !== s.subMode || settings.translateTo !== s.translateTo
  settings = s
  document.documentElement.style.setProperty('--text-scale', String(s.textScale || 1))
  document.body.dataset.font = s.font
  deviceOffsetMs = s.deviceOffsets[outputDevice] ?? 0
  row = null
  if (modeChanged) void loadSubs()
}

async function refreshOutputDevice(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const def = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')
    outputDevice = def?.label.replace(/^Default\s*-\s*/i, '').trim() || 'default'
  } catch {
    outputDevice = 'default'
  }
  deviceOffsetMs = settings?.deviceOffsets[outputDevice] ?? 0
}
navigator.mediaDevices?.addEventListener('devicechange', () => void refreshOutputDevice())

async function applyArtwork(url: string): Promise<void> {
  artEl.src = url
  artEl.hidden = !url
  const pal = url ? await extractPalette(url) : null
  if (!pal) return
  document.documentElement.style.setProperty('--c1', pal.c1)
  document.documentElement.style.setProperty('--c2', pal.c2)
}

/* ---------------------------------- wiring --------------------------------- */

for (const b of document.querySelectorAll('#ctrl button')) b.addEventListener('mousedown', (e) => e.preventDefault())
playBtn.addEventListener('click', () => {
  clock.expect(!clock.isPlaying)
  playBtn.classList.toggle('paused', !clock.isPlaying)
  void window.lyrique.command('playPause')
})
$('open').addEventListener('click', () => void window.lyrique.showMain())
$('close').addEventListener('click', () => void window.lyrique.setMini(false))
window.addEventListener('resize', () => row && fit(row.el))

window.lyrique.onPlayerState((s) => {
  connected = true
  clock.sample(s)
})
window.lyrique.onBridgeStatus((s) => (connected = s.extensionConnected))
window.lyrique.onTrackChanged(({ track: t }) => {
  track = t
  setLyrics(null)
  // The new cover arrives separately (or never); don't leave the last song's cover up meanwhile.
  void applyArtwork('')
})
window.lyrique.onTrackArtwork(({ videoId, artwork }) => {
  if (track?.videoId === videoId) void applyArtwork(artwork)
})
window.lyrique.onTrackLyrics(({ videoId, lyrics: l }) => {
  if (track?.videoId === videoId) setLyrics(l)
})
window.lyrique.onSettingsChanged(applySettings)

void (async () => {
  const init = await window.lyrique.miniInit()
  applySettings(init.settings)
  connected = init.connected
  if (init.state) clock.sample(init.state)
  track = init.track
  setLyrics(init.lyrics)
  if (init.artwork) void applyArtwork(init.artwork)
  void refreshOutputDevice()
})()
