import './locale'
import { listJoin, t } from '../shared/i18n'
import { initWhatsNew } from './whatsnew'
import type { AutoOffset, Line, Lyrics, PlayerState, Settings, SubMode, TrackInfo, UserSyncState, Word } from '../shared/types'
import { extractPalette } from './palette'
import { PlaybackClock } from './clock'
import { estimateWords } from '../shared/estimate'
import { initEditor } from './editor'
import { initSetup } from './setup'
import { renderShareCard } from './share'
import { initPicker } from './picker'
import { initSettings, initShortcuts } from './settings'
import { needsRomanization } from '../shared/romanize'

// Window errors go to the local problem log, for Copy Diagnostics.
window.addEventListener('error', (e) => void window.lyrique.logProblem('main', `${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`))
window.addEventListener('unhandledrejection', (e) => void window.lyrique.logProblem('main', String(e.reason?.message ?? e.reason)))

/* ------------------------------- DOM refs ------------------------------- */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const stage = $('stage')
const linesEl = $('lines')
const titleEl = $('title')
const artistEl = $('artist')
const artEl = $<HTMLImageElement>('art')
let bgArtEl = $<HTMLImageElement>('bg-art')
const plainEl = $('plain')
const plainText = $('plain-text')
const emptyEl = $('empty')
const emptyIcon = $('empty-icon')
const emptyTitle = $('empty-title')
const emptyBody = $('empty-body')
const emptyActions = $('empty-actions')
const sourceEl = $('source')
const connEl = $('conn')
const offsetEl = $('offset')
const npArt = $<HTMLImageElement>('np-art')
const npTitle = $('np-title')
const npArtist = $('np-artist')
const npFill = $('np-fill')
const npPos = $('np-pos')
const npDur = $('np-dur')
const playBtns = document.querySelectorAll<HTMLElement>('.play-btn')

/* --------------------------------- state -------------------------------- */

interface LineEntry {
  kind: 'line'
  startMs: number
  endMs: number
  line: Line
  el: HTMLElement
  words?: WordEntry[]
  /** Word timings were estimated from the line, not supplied by the source. */
  estimated?: boolean
  /** Second lines that fill in along with the singing (romanization). */
  wipes: HTMLElement[]
}
interface WordEntry {
  el: HTMLElement
  w: Word
  /** Wipe length: the word's own duration (floored). */
  wipeMs: number
  /** Held long enough to earn the glow. */
  emphasis: boolean
  lastP: number
}
interface DotsEntry {
  kind: 'dots'
  startMs: number
  endMs: number
  el: HTMLElement
  dots: HTMLElement[]
}
type Entry = LineEntry | DotsEntry

let track: TrackInfo | null = null
let lyrics: Lyrics | null = null
let entries: Entry[] = []
let activeIdx = -2
let connected = false
let settings: Settings | null = null
/** Manual per-song offset (0 = none set). */
let trackOffsetMs = 0
/** Offset measured by audio auto-sync, for the lyrics source it was measured on. */
let autoOffset: AutoOffset | null = null
let globalOffsetMs = 0
let deviceOffsetMs = 0
let outputDevice = 'default'
let lyricsPending = false

const clock = new PlaybackClock()

/* ------------------------------ time source ----------------------------- */

/**
 * A highlight that lands a hair before the sound reads as "on time"; one that lands after
 * reads as lag (ITU-R BT.1359 tolerates ~45 ms of audio-early vs ~125 ms audio-late).
 * Kept small because Bluetooth output latency is handled by the per-device offset.
 */
const LEAD_MS = 40
/** Scroll toward the next line slightly before it becomes active (BetterLyrics uses 120 ms). */
const SCROLL_LEAD_MS = 120
/** Instrumental gaps at least this long get the breathing dots (AMLL: 7 s). */
const INTERLUDE_MS = 7000
const INTRO_MS = 4000

/** Total offset; positive = lyrics later. Sign is the same for every layer. */
function offsetMs(): number {
  return songOffsetMs() + globalOffsetMs + deviceOffsetMs
}

/** The song's lyrics-file correction: your manual offset if set, otherwise auto-sync's. */
function songOffsetMs(): number {
  return trackOffsetMs !== 0 ? trackOffsetMs : autoSongOffsetMs()
}

function autoSongOffsetMs(): number {
  return autoOffset && lyrics && autoOffset.source === lyrics.source ? autoOffset.offsetMs : 0
}

/** Lyrics time in ms: displayed position, plus the lead, minus offsets. */
function currentMs(): number {
  return clock.now() * 1000 + LEAD_MS - offsetMs()
}

/* ---------------------------- lyrics → entries --------------------------- */

const ICONS = {
  note: `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`,
  plug: `<svg viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>`
}

/** Between songs, keep the old lines fading out this long before showing "Finding lyrics…". */
const SWITCH_GRACE_MS = 1500
let switchingAt = 0

function buildEntries(ly: Lyrics): void {
  linesEl.textContent = ''
  stage.classList.remove('switching')
  linesEl.classList.remove('entering')
  void linesEl.offsetWidth // restart the entrance animation
  linesEl.classList.add('entering')
  entries = []
  activeIdx = -2
  scrollIdx = -2
  userScroll = 0
  document.body.classList.remove('scrolling')
  const lines = ly.lines
  linesEl.classList.toggle('duet', lines.some((l) => l.singer))
  const push = (e: Entry) => {
    entries.push(e)
    linesEl.appendChild(e.el)
  }
  const addDots = (startMs: number, endMs: number, min = INTERLUDE_MS) => {
    if (endMs - startMs < min) return
    const el = document.createElement('div')
    el.className = 'dots'
    const dots = [0, 1, 2].map(() => el.appendChild(document.createElement('i')))
    push({ kind: 'dots', startMs, endMs, el, dots })
  }

  const first = lines[0]
  if (first) addDots(0, first.startMs, INTRO_MS)
  // Running max of where singing ends, so overlapping lines never fake an interlude.
  let sungUntil = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const next = lines[i + 1]
    if (!line.text.trim()) {
      // An empty timestamped line is an instrumental marker.
      addDots(line.startMs, next?.startMs ?? line.endMs, INTRO_MS)
      continue
    }
    const el = document.createElement('div')
    el.className = 'line future'
    el.dataset.i = String(i)
    let words: LineEntry['words']
    const estimated = !line.words?.length
    const lineWords = estimated ? estimateWords(line) : line.words!
    if (estimated) el.classList.add('estimated')
    // Backing vocals are written in parentheses: render them smaller and softer.
    if (/^\(.*\)$/.test(line.text.trim())) el.classList.add('bgline')
    // Duets: the second singer's lines sit on the right, lines sung together in the middle.
    if (line.singer) el.classList.add(`v${line.singer}`)
    let paren = 0
    if (lineWords.length) {
      words = lineWords.map((w, wi) => {
        const span = document.createElement('span')
        span.className = 'w'
        const opens = (w.text.match(/\(/g) ?? []).length
        if (paren > 0 || opens > 0) span.classList.add('bgv')
        paren = Math.max(0, paren + opens - (w.text.match(/\)/g) ?? []).length)
        span.textContent = w.text
        const dur = Math.max(0, w.endMs - w.startMs)
        span.style.setProperty('--lift-ms', `${Math.max(1000, dur)}ms`)
        el.appendChild(span)
        const chars = w.text.trim().length
        // Real timings: any held word ≥1 s of 2–7 characters (AMLL/YouLy+ rule).
        // Estimated timings: only the line's last word, whose tail is the held note.
        const emphasis = dur >= 1000 && (estimated ? wi === lineWords.length - 1 : chars >= 2 && chars <= 7)
        return { el: span, w, wipeMs: Math.max(estimated ? 120 : 80, dur), emphasis, lastP: -1 }
      })
    } else {
      el.textContent = line.text
    }
    const wipes: HTMLElement[] = []
    if (line.sub) wipes.push(addSub(el, line.sub, 'file', wipeable(line.text, line.sub)))
    el.addEventListener('click', () => void window.lyrique.seek((line.startMs + trackOffsetMs + globalOffsetMs) / 1000))
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      void shareLine(i)
    })
    push({ kind: 'line', startMs: line.startMs, endMs: line.endMs, line, el, words, estimated, wipes })
    // Where singing actually stops: the last word's end (real or estimated tail), not the
    // line's slot, which for LRC simply runs until the next line starts.
    sungUntil = Math.max(sungUntil, words?.length ? words[words.length - 1]!.w.endMs : line.endMs)
    if (next?.text.trim()) addDots(sungUntil, next.startMs)
  }
  entries.sort((a, b) => a.startMs - b.startMs)
  for (const e of entries) linesEl.appendChild(e.el) // re-append in sorted order
  layout(true)
}

function findActive(ms: number): number {
  let lo = 0
  let hi = entries.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid]!.startMs <= ms) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/* --------------------------------- render -------------------------------- */

let relayoutTimer = 0
/** Manual scroll (wheel/trackpad) offset in px; auto-follow resumes after SCROLL_HOLD_MS. */
let userScroll = 0
let userScrollUntil = 0
const SCROLL_HOLD_MS = 3000

let scrollIdx = -2

function followY(): number {
  const target = entries[Math.max(activeIdx, scrollIdx)] ?? entries[0]
  if (!target) return 0
  const anchor = Number(getComputedStyle(document.documentElement).getPropertyValue('--anchor')) || 0.38
  return target.el.offsetTop + target.el.offsetHeight / 2 - stage.clientHeight * anchor
}

function layout(immediate = false): void {
  if (!entries.length) return
  let y = followY() + userScroll
  if (userScroll) {
    // Keep at least one line on screen at either end.
    const first = entries[0]!.el
    const last = entries[entries.length - 1]!.el
    const min = first.offsetTop - stage.clientHeight * 0.6
    const max = last.offsetTop + last.offsetHeight - stage.clientHeight * 0.4
    const clamped = Math.min(max, Math.max(min, y))
    userScroll += clamped - y
    y = clamped
  }
  if (immediate) linesEl.style.transition = 'none'
  const to = `translate3d(0, ${-Math.round(y)}px, 0)`
  // Reduce motion: the lines step into place under a soft dissolve instead of sliding.
  if (!immediate && !userScroll && linesEl.style.transform !== to && document.body.classList.contains('reduced')) {
    linesEl.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' })
  }
  linesEl.style.transform = to
  if (immediate) {
    void linesEl.offsetHeight
    linesEl.style.transition = ''
  }
}

function setActive(idx: number): void {
  activeIdx = idx
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    const d = Math.abs(i - idx)
    e.el.style.setProperty('--d', String(Math.max(1, d)))
    e.el.classList.toggle('active', i === idx)
    if (e.kind === 'line') {
      e.el.classList.toggle('past', i < idx)
      e.el.classList.toggle('future', i > idx)
      if (e.words && i !== idx) {
        for (const we of e.words) {
          we.el.classList.remove('sung', 'glow')
          we.lastP = -1
          we.el.style.setProperty('--p', i < idx ? '1' : '0')
        }
      }
    } else if (i !== idx) {
      for (const dot of e.dots) dot.style.setProperty('--f', '0')
    }
  }
  layout()
  window.clearTimeout(relayoutTimer)
  // Dots expand/collapse shifts the layout; settle once the height transition is done.
  relayoutTimer = window.setTimeout(() => layout(), 640)
}

let lastUpdate = 0

let lastProgressAt = 0

/** Now-playing card progress (big-screen layout only), a few times a second. */
function updateProgress(): void {
  if (!document.body.classList.contains('big') || !track) return
  const now = performance.now()
  if (now - lastProgressAt < 250) return
  lastProgressAt = now
  const pos = clock.now()
  const dur = track.duration || 0
  npFill.style.transform = `scaleX(${dur ? Math.min(1, pos / dur).toFixed(4) : 0})`
  npPos.textContent = fmtTime(pos)
  npDur.textContent = fmtTime(dur)
  for (const b of playBtns) b.classList.toggle('paused', !clock.isPlaying)
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function update(): void {
  lastUpdate = performance.now()
  updateProgress()
  if (!lyrics || lyrics.kind !== 'synced' || !entries.length) return
  if (userScroll && Date.now() >= userScrollUntil) {
    userScroll = 0
    document.body.classList.remove('scrolling')
    layout()
  }
  const ms = currentMs()
  const idx = findActive(ms)
  if (idx !== activeIdx) setActive(idx)
  const ahead = findActive(ms + SCROLL_LEAD_MS)
  if (ahead !== scrollIdx) {
    scrollIdx = ahead
    if (!userScroll) layout()
  }
  const e = entries[idx]
  if (!e) return
  if (e.kind === 'line' && e.words) {
    // A romanization line fills in at the pace of the words above it, weighted by length.
    let sungChars = 0
    let allChars = 0
    for (const we of e.words) {
      // Linear wipe across the word's own duration (AMLL / beautiful-lyrics / BetterLyrics).
      const p = Math.min(1, Math.max(0, (ms - we.w.startMs) / we.wipeMs))
      if (Math.abs(p - we.lastP) >= 0.002 || (p === 1 && we.lastP !== 1)) {
        we.lastP = p
        we.el.style.setProperty('--p', p.toFixed(3))
      }
      const chars = we.w.text.trim().length
      sungChars += chars * p
      allChars += chars
      const sung = p > 0
      if (sung !== we.el.classList.contains('sung')) we.el.classList.toggle('sung', sung)
      if (we.emphasis) {
        const glow = sung && ms < we.w.endMs + 250
        if (glow !== we.el.classList.contains('glow')) we.el.classList.toggle('glow', glow)
      }
    }
    if (e.wipes.length) {
      const p = (allChars ? sungChars / allChars : 0).toFixed(3)
      for (const w of e.wipes) if (w.style.getPropertyValue('--p') !== p) w.style.setProperty('--p', p)
    }
  } else if (e.kind === 'dots') {
    const total = e.endMs - e.startMs
    const p = Math.min(1, Math.max(0, (ms - e.startMs) / total))
    e.dots.forEach((dot, i) => {
      const f = Math.min(1, Math.max(0, p * 3 - i))
      dot.style.setProperty('--f', f.toFixed(2))
    })
  }
}

/** Minimized or hidden: nothing is drawn, so nothing is animated (saves battery). */
let asleep = false
let frameQueued = false

function frame(): void {
  frameQueued = false
  if (asleep) return
  frameQueued = true
  requestAnimationFrame(frame)
  update()
}
frameQueued = true
requestAnimationFrame(frame)
// macOS can report a floating/unfocused window as occluded, which pauses rAF entirely.
// Keep the lyrics clock ticking from a plain timer whenever rAF stalls.
window.setInterval(() => {
  if (!asleep && performance.now() - lastUpdate > 150) update()
}, 100)

window.lyrique.onWindowVisible((visible) => {
  asleep = !visible
  document.body.classList.toggle('asleep', asleep)
  if (asleep) return
  // Back on screen: jump straight to where the song is.
  update()
  layout(true)
  if (!frameQueued) {
    frameQueued = true
    requestAnimationFrame(frame)
  }
})

stage.addEventListener(
  'wheel',
  (e) => {
    if (!entries.length) return
    e.preventDefault()
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
    userScroll += dy
    userScrollUntil = Date.now() + SCROLL_HOLD_MS
    document.body.classList.add('scrolling')
    layout(true)
  },
  { passive: false }
)

/* ------------------------------ view states ------------------------------ */

type View = 'empty' | 'synced' | 'plain'

function showView(v: View): void {
  stage.style.visibility = v === 'synced' ? 'visible' : 'hidden'
  plainEl.hidden = v !== 'plain'
  emptyEl.hidden = v !== 'empty'
  document.body.classList.toggle('can-idle', v === 'synced')
}

function showEmpty(title: string, body: string, icon: keyof typeof ICONS, pulse = false, actions: Array<{ label: string; primary?: boolean; onClick: () => void }> = []): void {
  emptyTitle.textContent = title
  emptyBody.innerHTML = body
  emptyIcon.innerHTML = ICONS[icon]
  emptyIcon.classList.toggle('pulse', pulse)
  emptyActions.textContent = ''
  for (const a of actions) {
    const b = document.createElement('button')
    b.textContent = a.label
    if (a.primary) b.className = 'primary'
    b.addEventListener('click', a.onClick)
    emptyActions.appendChild(b)
  }
  showView('empty')
}

function refreshView(): void {
  document.body.classList.remove('ambient')
  document.body.classList.toggle('has-track', connected && !!track)
  connEl.classList.toggle('on', connected)
  if (!connected) {
    showEmpty(t('empty.playMusic'), t('empty.playMusicBody'), 'plug', true, [
      { label: t('empty.setupYouTube'), primary: true, onClick: () => void window.lyrique.showSetup() }
    ])
    sourceEl.textContent = ''
    return
  }
  if (!track) {
    showEmpty(t('empty.playSomething'), t('empty.playSomethingBody'), 'note', true)
    sourceEl.textContent = ''
    return
  }
  // Most lookups (cache, prefetch) land within a moment: don't flash a card between songs.
  if (lyricsPending && !lyrics && performance.now() - switchingAt < SWITCH_GRACE_MS) return
  if (lyricsPending && !lyrics) {
    showEmpty(t('empty.finding'), `${esc(track.title)} · ${esc(track.artist)}`, 'search', true)
    sourceEl.textContent = ''
    return
  }
  if (!lyrics || lyrics.kind === 'none') {
    const fromYouTube = !['spotify', 'music'].includes(track.videoType)
    const tried = [...(fromYouTube ? ['YouTube Music'] : []), ...(lyrics?.tried ?? ['LRCLIB'])]
    showEmpty(
      t('empty.none'),
      t('empty.noneBody', { sources: esc(listJoin(tried)), title: esc(track.title), artist: esc(track.artist) }),
      'search',
      false,
      [
        { label: t('empty.syncYourself'), primary: true, onClick: () => openEditor('') },
        { label: t('empty.chooseLyrics'), onClick: () => void picker.open() }
      ]
    )
    // Big screen: artwork and title take the stage instead of an error card.
    document.body.classList.add('ambient', 'can-idle')
    sourceEl.textContent = ''
    return
  }
  if (lyrics.kind === 'instrumental') {
    showEmpty(t('empty.instrumental'), t('empty.instrumentalBody'), 'note', true)
    sourceEl.textContent = sourceLabel(lyrics.source)
    return
  }
  if (lyrics.kind === 'plain') {
    renderPlain()
    sourceEl.textContent = t('source.unsynced', { source: sourceLabel(lyrics.source) })
    showView('plain')
    return
  }
  sourceEl.textContent = sourceLabel(lyrics.source)
  showView('synced')
}

/** Source names stay as they are; the words added to them are translated. */
function sourceLabel(source: string): string {
  return source.replace(/\bchosen\b/, t('source.chosen')).replace(/\bword-synced\b/, t('source.wordSynced'))
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/* ------------------------------- artwork -------------------------------- */

let artToken = 0
async function applyArtwork(dataUrl: string): Promise<void> {
  const token = ++artToken
  window.clearTimeout(artHideTimer)
  // Decode first so the swap is a clean crossfade, never a blank frame.
  const img = new Image()
  img.src = dataUrl
  try {
    await img.decode()
  } catch {
    /* show it anyway */
  }
  if (token !== artToken) return
  for (const el of [artEl, npArt]) {
    el.src = dataUrl
    el.hidden = false
    el.classList.remove('swapping')
  }
  // Background: fade a new layer in over the old one, then drop the old one.
  const layer = bgArtEl.cloneNode() as HTMLImageElement
  layer.removeAttribute('id')
  layer.classList.remove('ready')
  layer.src = dataUrl
  bgArtEl.parentElement!.insertBefore(layer, bgArtEl.nextSibling)
  requestAnimationFrame(() => layer.classList.add('ready'))
  const old = bgArtEl
  bgArtEl = layer
  window.setTimeout(() => old.remove(), 1600)
  const pal = await extractPalette(dataUrl)
  if (!pal || token !== artToken) return
  const root = document.documentElement.style
  root.setProperty('--c1', pal.c1)
  root.setProperty('--c2', pal.c2)
  root.setProperty('--c3', pal.c3)
}

let artHideTimer = 0

/** New song: dim the old artwork; it's replaced by a crossfade when the new art arrives. */
function clearArtwork(): void {
  artToken++
  artEl.classList.add('swapping')
  npArt.classList.add('swapping')
  window.clearTimeout(artHideTimer)
  // No artwork for this song after a while: let the old one go.
  artHideTimer = window.setTimeout(() => {
    artEl.hidden = true
    npArt.hidden = true
    bgArtEl.classList.remove('ready')
  }, 4000)
}

/* -------------------------------- offsets ------------------------------- */

const fmtS = (ms: number) => `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s`

function renderOffset(): void {
  const total = offsetMs()
  const isAuto = trackOffsetMs === 0 && autoSongOffsetMs() !== 0
  offsetEl.textContent = (isAuto ? `${t('offset.auto')} ` : '') + fmtS(total)
  offsetEl.classList.toggle('auto', isAuto)
  offsetEl.style.opacity = total === 0 ? '0.6' : '1'
  const song = isAuto ? t('offset.autoSong', { offset: fmtS(songOffsetMs()) }) : fmtS(trackOffsetMs)
  offsetEl.title = t('offset.tooltip', { song, device: deviceName(), deviceOffset: fmtS(deviceOffsetMs), global: fmtS(globalOffsetMs) })
}

function deviceName(): string {
  return outputDevice === 'default' ? t('offset.audioOutput') : outputDevice
}

async function nudgeOffset(deltaMs: number): Promise<void> {
  if (!track) return
  // Start from what's applied now, so nudging an auto-synced song refines it.
  trackOffsetMs = songOffsetMs() + deltaMs
  renderOffset()
  await window.lyrique.setTrackOffset(track.videoId, trackOffsetMs)
}

/** Drop the manual song offset; auto-sync's (if any) applies again. */
async function resetSongOffset(): Promise<void> {
  if (!track) return
  trackOffsetMs = 0
  renderOffset()
  await window.lyrique.setTrackOffset(track.videoId, 0)
}

/** Per-output offset: Bluetooth headphones play ~150–220 ms after the browser's currentTime. */
async function nudgeDeviceOffset(deltaMs: number): Promise<void> {
  deviceOffsetMs += deltaMs
  renderOffset()
  const deviceOffsets = { ...(settings?.deviceOffsets ?? {}) }
  if (deviceOffsetMs === 0) delete deviceOffsets[outputDevice]
  else deviceOffsets[outputDevice] = deviceOffsetMs
  settings = await window.lyrique.patchSettings({ deviceOffsets })
}

/** Name of the system's current default audio output, used to key the device offset. */
async function refreshOutputDevice(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const def = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')
    const label = def?.label.replace(/^Default\s*-\s*/i, '').trim()
    outputDevice = label || 'default'
  } catch {
    outputDevice = 'default'
  }
  deviceOffsetMs = settings?.deviceOffsets?.[outputDevice] ?? 0
  renderOffset()
  void window.lyrique.reportAudioDevice(outputDevice)
}
navigator.mediaDevices?.addEventListener('devicechange', () => void refreshOutputDevice())

const nudge = (e: MouseEvent | KeyboardEvent, ms: number) =>
  void (e.altKey ? nudgeDeviceOffset(e.shiftKey ? ms * 5 : ms) : nudgeOffset(e.shiftKey ? ms * 5 : ms))
$('offset-minus').addEventListener('click', (e) => nudge(e, -100))
$('offset-plus').addEventListener('click', (e) => nudge(e, 100))
offsetEl.addEventListener('click', (e) => void (e.altKey ? nudgeDeviceOffset(-deviceOffsetMs) : resetSongOffset()))
$('refetch').addEventListener('click', () => void picker.open())
sourceEl.addEventListener('click', () => void picker.open())
$('plain-sync').addEventListener('click', () => openEditor(lyrics?.kind === 'plain' ? lyrics.plain : ''))

/* ------------------------- tap-along lyric editor ------------------------- */

const editor = initEditor({
  // What you hear: playback position minus your audio output's delay.
  nowMs: () => clock.now() * 1000 - deviceOffsetMs,
  track: () => track,
  seek: (sec) => void window.lyrique.seek(sec),
  onSaved: () => {
    trackOffsetMs = 0
    renderOffset()
  }
})
const openEditor = (prefill: string) => void editor.open(prefill)
const picker = initPicker({ track: () => track, openEditor: () => openEditor(lyrics?.kind === 'plain' ? lyrics.plain : '') })

/* -------------------------- your sync vs original ------------------------- */

const userSyncEl = $('user-sync')
let userSync: UserSyncState = 'none'

function renderUserSync(): void {
  userSyncEl.textContent = ''
  if (!track || userSync === 'none') return
  const id = track.videoId
  const link = (label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.className = 'link'
    b.textContent = label
    b.addEventListener('click', onClick)
    userSyncEl.appendChild(b)
  }
  if (userSync === 'on') {
    link(t('userSync.edit'), () => openEditor(''))
    link(t('userSync.original'), () => void window.lyrique.setUserSync(id, 'original'))
  } else {
    link(t('userSync.use'), () => void window.lyrique.setUserSync(id, 'use'))
    link(t('userSync.delete'), () => void window.lyrique.setUserSync(id, 'delete'))
  }
}

window.lyrique.onUserSync(({ videoId, state }) => {
  if (track?.videoId !== videoId) return
  userSync = state
  renderUserSync()
})

$('fullscreen').addEventListener('click', () => void window.lyrique.toggleFullscreen())
stage.addEventListener('dblclick', () => void window.lyrique.toggleFullscreen())

/* --------------------------- outdated extension --------------------------- */

const noticeEl = $('notice')
let noticeDismissed = false
/** What the notice's button does right now. */
let noticeAction: () => void = () => {}

function showOutdated(outdated: boolean): void {
  noticeEl.hidden = !outdated || noticeDismissed
  if (!outdated) return
  $('notice-copy').textContent = t('notice.copyExtensions')
  noticeAction = () => {
    void window.lyrique.copyText('chrome://extensions')
    $('notice-copy').textContent = t('notice.copiedExtensions')
  }
  $('notice-text').textContent = t('notice.outdated')
}
$('notice-copy').addEventListener('click', () => noticeAction())
$('notice-close').addEventListener('click', () => {
  noticeDismissed = true
  noticeEl.hidden = true
})
window.lyrique.onBridgeOutdated(showOutdated)

// A newer Lyrique on the releases page: offer it once, in the same quiet notice bar.
function showUpdate(u: { version: string; url: string } | null): void {
  if (!u || !noticeEl.hidden || noticeDismissed) return
  $('notice-text').textContent = t('notice.update', { version: u.version })
  $('notice-copy').textContent = t('notice.download')
  noticeAction = () => void window.lyrique.openExternal(u.url)
  noticeEl.hidden = false
}
window.lyrique.onUpdate(showUpdate)
void window.lyrique.getUpdate().then(showUpdate)
void window.lyrique.isBridgeOutdated().then(showOutdated)

/* ------------------------------- transport ------------------------------- */
// Lightweight controls: a small pill at the bottom of the window, or the now-playing card on
// big screens. Both fade with the rest of the chrome, so the lyrics stay the show.

type Transport = 'playPause' | 'next' | 'previous' | 'back10' | 'fwd10'

function transport(cmd: Transport): void {
  if (cmd === 'back10' || cmd === 'fwd10') {
    const to = clock.now() + (cmd === 'fwd10' ? 10 : -10)
    void window.lyrique.seek(Math.max(0, track?.duration ? Math.min(to, track.duration - 1) : to))
    return
  }
  if (cmd === 'playPause') {
    // Freeze or resume the lyrics now; the player's confirmation follows a moment later.
    clock.expect(!clock.isPlaying)
    for (const b of playBtns) b.classList.toggle('paused', !clock.isPlaying)
  }
  void window.lyrique.command(cmd)
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#np-ctrl button, #ctrl button')) {
  b.addEventListener('mousedown', (e) => e.preventDefault()) // keep Space for play/pause
  b.addEventListener('click', () => transport(b.dataset.cmd as Transport))
}

// Click (or drag) the progress bar to seek.
$('np-bar').addEventListener('click', (e) => {
  if (!track?.duration) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  void window.lyrique.seek(f * track.duration)
})

/* ------------------------------ cover mode ------------------------------- */
// Click the artwork: it becomes the hero on the left and the lyrics keep going on the right.

function toggleCover(): void {
  if (!document.body.classList.contains('big')) return
  document.body.classList.toggle('cover')
  try {
    localStorage.setItem('lyrica.cover', document.body.classList.contains('cover') ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
  // The lyric column changes width and size: re-centre now and once the transition settles.
  requestAnimationFrame(() => layout(true))
  window.setTimeout(() => layout(true), 700)
}
npArt.addEventListener('click', toggleCover)
try {
  if (localStorage.getItem('lyrica.cover') === '1') document.body.classList.add('cover')
} catch {
  /* storage unavailable */
}

/* ------------------------------ big screen ------------------------------- */

// Full screen, or simply a very large window, switches to the big-screen layout.
const wide = matchMedia('(min-width: 1400px) and (min-height: 800px)')
function setFullscreen(on: boolean): void {
  document.body.classList.toggle('fullscreen', on)
  if (!on && karaoke) setKaraoke(false)
  applyBig()
}

/* -------------------------------- karaoke -------------------------------- */
// K: full screen with nothing but the lyrics, very large and centred, for a room or a TV.

let karaoke = false
/** Karaoke switched full screen on, so leaving karaoke switches it off again. */
let karaokeOwnsFullscreen = false
const karaokeTitle = $('karaoke-title')
let karaokeTitleTimer = 0

function setKaraoke(on: boolean): void {
  if (on === karaoke) return
  karaoke = on
  document.body.classList.toggle('karaoke', on)
  const full = document.body.classList.contains('fullscreen')
  if (on && !full) {
    karaokeOwnsFullscreen = true
    void window.lyrique.toggleFullscreen()
  } else if (!on && full && karaokeOwnsFullscreen) {
    void window.lyrique.toggleFullscreen()
  }
  if (!on) karaokeOwnsFullscreen = false
  if (on) {
    toast(t('karaoke.toast'))
    showKaraokeTitle()
  }
  // Text size and column change: re-centre now and once full screen has settled.
  requestAnimationFrame(() => layout(true))
  window.setTimeout(() => layout(true), 800)
}

/** The song's name for a few seconds, so the room knows what's on. */
function showKaraokeTitle(): void {
  if (!karaoke || !track) return
  karaokeTitle.textContent = `${track.title} · ${track.artist}`
  karaokeTitle.classList.add('show')
  window.clearTimeout(karaokeTitleTimer)
  karaokeTitleTimer = window.setTimeout(() => karaokeTitle.classList.remove('show'), 5000)
}
window.lyrique.onKaraoke(() => setKaraoke(!karaoke))
function applyBig(): void {
  const big = wide.matches || document.body.classList.contains('fullscreen')
  if (big === document.body.classList.contains('big')) return
  document.body.classList.toggle('big', big)
  lastProgressAt = 0
  // Font size changes with the layout: re-centre the active line without animating.
  requestAnimationFrame(() => layout(true))
}
wide.addEventListener('change', applyBig)
// Room the now-playing card takes at the bottom, so unsynced lyrics stop above it.
function measureNp(): void {
  const r = $('np').getBoundingClientRect()
  if (r.height) document.documentElement.style.setProperty('--np-space', `${Math.ceil(window.innerHeight - r.top + 16)}px`)
}
new ResizeObserver(measureNp).observe($('np'))
window.addEventListener('resize', measureNp)
window.lyrique.onFullscreen(setFullscreen)
void window.lyrique.isFullscreen().then(setFullscreen)

const shortcuts = initShortcuts()
const whatsNew = initWhatsNew({
  showShortcuts: () => shortcuts.open(),
  run: (a) => {
    if (a === 'karaoke') setKaraoke(true)
    else if (a === 'mini') void window.lyrique.setMini(true)
    else if (a === 'menubar') void window.lyrique.patchSettings({ menuBarLyrics: true })
    else if (a === 'second') void window.lyrique.patchSettings({ subMode: 'translate' })
    else if (a === 'share') shareActive()
    else void settingsUi.open()
  }
})
const settingsUi = initSettings({ outputDevice: () => outputDevice, showShortcuts: () => shortcuts.open(), showWhatsNew: () => void whatsNew.show() })
$('settings-btn').addEventListener('click', () => void settingsUi.open())
$('keys-btn').addEventListener('click', () => shortcuts.open())
// Header and footer buttons never keep keyboard focus: Space stays play/pause.
for (const b of document.querySelectorAll<HTMLButtonElement>('#top button, #foot button')) {
  b.addEventListener('mousedown', (e) => e.preventDefault())
}
window.lyrique.onShowShortcuts(() => shortcuts.open())

/** Once, the first time lyrics play: point out the shortcut guide. */
function maybeShortcutTip(): void {
  if (!settings || settings.shortcutTipShown || !$('setup').hidden) return
  settings = { ...settings, shortcutTipShown: true }
  void window.lyrique.patchSettings({ shortcutTipShown: true })
  window.setTimeout(() => toast(t('tip.shortcuts'), { label: t('tip.show'), run: () => shortcuts.open() }), 2500)
}

/**
 * The key pressed: by character on Latin layouts (an AZERTY "M" is M), by position when the
 * keyboard types another script (Thai, Korean, Burmese…), so shortcuts work either way.
 */
function keyOf(e: KeyboardEvent): string {
  if (/^[\x21-\x7e]$/.test(e.key)) return e.key.toLowerCase()
  const letter = /^Key([A-Z])$/.exec(e.code)
  if (letter) return letter[1]!.toLowerCase()
  const keys: Record<string, [string, string]> = { Equal: ['=', '+'], Minus: ['-', '_'], Digit0: ['0', ')'], Slash: ['/', '?'] }
  return keys[e.code]?.[e.shiftKey ? 1 : 0] ?? e.key
}

window.addEventListener('keydown', (e) => {
  const k = keyOf(e)
  // ⌘ on the Mac, Ctrl elsewhere.
  if ((window.lyrique.platform === 'darwin' ? e.metaKey : e.ctrlKey) && e.key === ',') {
    e.preventDefault()
    void settingsUi.open()
    return
  }
  if (e.metaKey || e.ctrlKey) return
  if (k === '?') return shortcuts.open()
  if (k === 'f') void window.lyrique.toggleFullscreen()
  if (k === 'k') setKaraoke(!karaoke)
  if (e.key === 'Escape' && karaoke) setKaraoke(false)
  else if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) void window.lyrique.toggleFullscreen()
  if (e.code === 'Space') {
    e.preventDefault()
    transport('playPause')
  }
  if (e.key === 'ArrowRight') transport(e.shiftKey ? 'next' : 'fwd10')
  if (e.key === 'ArrowLeft') transport(e.shiftKey ? 'previous' : 'back10')
  if (k === 'l') transport('fwd10')
  if (k === 'j') transport('back10')
  if (k === 'c') toggleCover()
  if (k === 't') cycleSubMode()
  if (k === 'm') void window.lyrique.setMini(!miniOn)
  if (k === 's') shareActive()
  if (k === '=' || k === '+') void window.lyrique.stepTextScale(1)
  if (k === '-' || k === '_') void window.lyrique.stepTextScale(-1)
  if (e.code === 'BracketLeft') nudge(e, -100)
  if (e.code === 'BracketRight') nudge(e, 100)
  if (k === '0') void resetSongOffset()
  if (k === 'b') {
    const on = document.documentElement.style.getPropertyValue('--blur-on') === '0'
    document.documentElement.style.setProperty('--blur-on', on ? '1' : '0')
    void window.lyrique.patchSettings({ blur: on })
  }
})

/* --------------------------------- idle --------------------------------- */

let idleTimer = 0
function pokeIdle(): void {
  document.body.classList.remove('idle')
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    if (document.body.classList.contains('can-idle') && !document.querySelector('#top:hover')) {
      document.body.classList.add('idle')
    }
  }, 3200)
}
window.addEventListener('mousemove', pokeIdle)
window.addEventListener('mousedown', pokeIdle)
pokeIdle()

window.addEventListener('resize', () => layout(true))

/* ------------------------------ reduce motion ----------------------------- */
// macOS Reduce Motion, or the setting: no drifting background, no sliding or lifting lines.
const systemReduced = matchMedia('(prefers-reduced-motion: reduce)')
function applyMotion(): void {
  const on = systemReduced.matches || !!settings?.reduceMotion
  if (on === document.body.classList.contains('reduced')) return
  document.body.classList.toggle('reduced', on)
  layout(true)
}
systemReduced.addEventListener('change', applyMotion)
applyMotion()

/* ------------------------ second line: romanize / translate ------------------------ */

let subMode: SubMode = 'off'
let subTarget = ''
let subToken = 0
/** Second lines for plain (unsynced) lyrics, one per text line. */
let plainSubs: Array<string | null> = []
const SUB_LABEL: Record<SubMode, string> = { off: t('sub.off'), romanize: t('sub.romanize'), translate: t('sub.translate') }

function lyricTexts(): string[] {
  if (lyrics?.kind === 'synced') return lyrics.lines.map((l) => l.text)
  if (lyrics?.kind === 'plain') return lyrics.plain.split('\n')
  return []
}

/** Fetch and show the second lines for the current lyrics; `announce` reports problems. */
async function loadSubs(announce = false): Promise<void> {
  const token = ++subToken
  for (const el of linesEl.querySelectorAll('.sub.gen')) el.remove()
  for (const e of entries) if (e.kind === 'line') e.wipes = e.wipes.filter((w) => w.isConnected)
  plainSubs = []
  if (lyrics?.kind === 'plain') renderPlain()
  const texts = lyricTexts()
  if (subMode === 'off' || !texts.length) return relayoutSoon()
  const r = await window.lyrique.subtitles(texts, subMode)
  if (token !== subToken) return
  if (r.note && announce) toast(r.note)
  if (lyrics?.kind === 'plain') {
    plainSubs = r.lines
    renderPlain()
    return
  }
  for (const e of entries) {
    if (e.kind !== 'line') continue
    const sub = r.lines[Number(e.el.dataset.i)]
    // The file already pairs this line with its romanization.
    if (!sub || (subMode === 'romanize' && e.line.sub)) continue
    const wipe = subMode === 'romanize'
    const d = addSub(e.el, sub, 'gen', wipe)
    if (wipe) e.wipes.push(d)
  }
  relayoutSoon()
}

function addSub(lineEl: HTMLElement, text: string, kind: 'file' | 'gen', wipe: boolean): HTMLElement {
  const d = document.createElement('div')
  d.className = `sub ${kind}${wipe ? ' wipe' : ''}`
  d.textContent = text
  lineEl.appendChild(d)
  return d
}

/** Romanization (Latin under a non-Latin line) follows the singing; a translation doesn't. */
function wipeable(line: string, sub: string): boolean {
  return needsRomanization(line) && !needsRomanization(sub)
}

function relayoutSoon(): void {
  requestAnimationFrame(() => layout(true))
}

function renderPlain(): void {
  if (lyrics?.kind !== 'plain') return
  plainText.textContent = ''
  if (!plainSubs.some(Boolean)) {
    plainText.textContent = lyrics.plain
    return
  }
  lyrics.plain.split('\n').forEach((text, i) => {
    const l = document.createElement('div')
    l.textContent = text || ' '
    plainText.appendChild(l)
    const sub = plainSubs[i]
    if (sub) {
      const d = document.createElement('div')
      d.className = 'sub'
      d.textContent = sub
      plainText.appendChild(d)
    }
  })
}

function cycleSubMode(): void {
  const order: SubMode[] = ['off', 'romanize', 'translate']
  const next = order[(order.indexOf(subMode) + 1) % order.length]!
  toast(next === 'translate' ? t('sub.translateHint') : SUB_LABEL[next])
  pendingAnnounce = true
  void window.lyrique.patchSettings({ subMode: next })
}
let pendingAnnounce = false

/** Text size, font, second line, blur and offsets, from settings (Settings, menu bar or keys). */
function applyLook(s: Settings): void {
  applyMotion()
  const root = document.documentElement.style
  root.setProperty('--blur-on', s.blur ? '1' : '0')
  if (s.globalOffsetMs !== globalOffsetMs || (s.deviceOffsets[outputDevice] ?? 0) !== deviceOffsetMs) {
    globalOffsetMs = s.globalOffsetMs
    deviceOffsetMs = s.deviceOffsets[outputDevice] ?? 0
    renderOffset()
  }
  const scale = String(s.textScale || 1)
  if (root.getPropertyValue('--text-scale') !== scale) {
    root.setProperty('--text-scale', scale)
    relayoutSoon()
    window.setTimeout(() => layout(true), 300)
  }
  if (document.body.dataset.font !== s.font) {
    document.body.dataset.font = s.font
    relayoutSoon()
  }
  if (s.subMode !== subMode || s.translateTo !== subTarget) {
    subMode = s.subMode
    subTarget = s.translateTo
    void loadSubs(pendingAnnounce)
    pendingAnnounce = false
  }
}

/* --------------------------------- toast --------------------------------- */

const toastEl = $('toast')
let toastTimer = 0
let toastAction: (() => void) | null = null

function toast(text: string, action?: { label: string; run: () => void }): void {
  $('toast-text').textContent = text
  const btn = $('toast-action')
  btn.hidden = !action
  if (action) btn.textContent = action.label
  toastAction = action?.run ?? null
  toastEl.hidden = false
  toastEl.classList.remove('show')
  void toastEl.offsetWidth
  toastEl.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), action ? 6000 : 2600)
}
$('toast-action').addEventListener('click', () => {
  toastAction?.()
  toastEl.classList.remove('show')
})

/* ------------------------------ share a line ------------------------------ */

async function shareLine(lineIdx: number): Promise<void> {
  const line = lyrics?.lines[lineIdx]
  if (!line?.text.trim() || !track) return
  const entry = entries.find((e) => e.kind === 'line' && Number(e.el.dataset.i) === lineIdx)
  const sub = entry?.el.querySelector('.sub')?.textContent ?? null
  const url = await renderShareCard({
    text: line.text.trim(),
    sub,
    title: track.title,
    artist: track.artist,
    art: artEl.hidden ? null : artEl,
    font: getComputedStyle(linesEl).fontFamily
  })
  await window.lyrique.copyImage(url)
  const name = `${track.title} — ${track.artist}`
  toast(t('share.copied'), { label: t('share.save'), run: () => void window.lyrique.saveImage(url, name) })
}

function shareActive(): void {
  const e = entries[activeIdx]
  if (e?.kind === 'line') void shareLine(Number(e.el.dataset.i))
  else toast(t('share.needLine'))
}

/* ------------------------------- mini bar -------------------------------- */

let miniOn = false
window.lyrique.onMini((on) => (miniOn = on))

/* ---------------------------------- IPC --------------------------------- */

window.lyrique.onBridgeStatus((s) => {
  connected = s.extensionConnected
  refreshView()
})

window.lyrique.onPlayerState((s: PlayerState) => {
  connected = true
  clock.sample(s)
  if (!track && !s.isAd && s.title) {
    track = { videoId: s.videoId, title: s.title, artist: s.artist, album: s.album, duration: s.duration, videoType: s.videoType, artwork: '' }
    titleEl.textContent = s.title
    artistEl.textContent = s.artist
    refreshView()
  }
})

window.lyrique.onTrackChanged(({ track: t, offsetMs, globalOffsetMs: g, autoOffset: auto }) => {
  if (editor.isOpen()) editor.close()
  if (picker.isOpen()) picker.close()
  userSync = 'none'
  renderUserSync()
  track = t
  lyrics = null
  entries = [] // stops the old lines updating; their DOM stays to fade out
  stage.classList.add('switching')
  switchingAt = performance.now()
  window.setTimeout(refreshView, SWITCH_GRACE_MS + 20)
  lyricsPending = true
  trackOffsetMs = offsetMs
  autoOffset = auto
  globalOffsetMs = g
  titleEl.textContent = t.title
  artistEl.textContent = t.album ? `${t.artist} · ${t.album}` : t.artist
  document.title = `${t.title} — ${t.artist}`
  npTitle.textContent = t.title
  npArtist.textContent = t.album ? `${t.artist} · ${t.album}` : t.artist
  clearArtwork()
  renderOffset()
  refreshView()
  showKaraokeTitle()
})

window.lyrique.onTrackArtwork(({ videoId, artwork }) => {
  if (track?.videoId === videoId && artwork) void applyArtwork(artwork)
})

window.lyrique.onTrackLyrics(({ videoId, lyrics: ly }) => {
  if (track?.videoId !== videoId) return
  lyrics = ly
  lyricsPending = false
  if (ly.kind === 'synced') buildEntries(ly)
  renderOffset() // auto-sync only applies to the lyrics source it measured
  plainSubs = []
  refreshView()
  void loadSubs()
  if (ly.kind === 'synced') maybeShortcutTip()
})

window.lyrique.onAutoOffset(({ videoId, auto }) => {
  if (track?.videoId !== videoId) return
  autoOffset = auto
  renderOffset()
})

window.lyrique.onSettingsChanged((s) => {
  settings = s
  applyLook(s)
})

async function boot(): Promise<void> {
  settings = await window.lyrique.getSettings()
  applyLook(settings)
  miniOn = await window.lyrique.isMini()
  globalOffsetMs = settings.globalOffsetMs
  void refreshOutputDevice()
  document.documentElement.style.setProperty('--blur-on', settings.blur ? '1' : '0')
  const status = await window.lyrique.getStatus()
  connected = status.extensionConnected
  refreshView()
  // If a song is already playing (e.g. the window was reopened), ask main to replay it.
  const last = await window.lyrique.getLastState()
  if (last && !last.isAd) void window.lyrique.replayTrack()
  void whatsNew.maybeShow()
}
void boot()
initSetup()
