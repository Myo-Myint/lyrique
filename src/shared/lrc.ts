import type { Line, Word } from './types'

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g
const META_TAG = /^\[([a-zA-Z_]+):([^\]]*)\]$/

function toMs(min: string, sec: string, frac: string | undefined): number {
  // Real-world LRC mixes 2- and 3-digit fractions; pad to milliseconds.
  const f = (frac ?? '0').padEnd(3, '0').slice(0, 3)
  return Number(min) * 60_000 + Number(sec) * 1_000 + Number(f)
}

/**
 * Parse standard or enhanced (word-level) LRC into timed lines.
 * - Multiple time tags on one line repeat that line at each time.
 * - [offset:ms] is applied (positive offset = lyrics play earlier, per the de-facto LRC convention).
 * - End times are inferred from the next line; the last line gets `durationMs` or +5s.
 */
export function parseLrc(text: string, durationMs = 0): Line[] {
  let offset = 0
  const raw: Array<{ startMs: number; text: string; words?: Word[]; voice?: string }> = []
  // Karaoke files mark singers with "M:" / "F:" / "D:"; only trust that when it's used throughout.
  const karaokeVoices = (text.match(/^\s*(?:\[[^\]]*\])+\s*[MFD]:\s/gm) ?? []).length >= 3
  const VOICE = karaokeVoices ? /^\s*(v[1-9]|[MFD]):\s*/ : /^\s*(v[1-9]):\s*/
  /** A singer mark carries over to the following lines until the next mark. */
  let voice: string | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const meta = META_TAG.exec(line)
    if (meta && !/^\d/.test(meta[1]!)) {
      if (meta[1]!.toLowerCase() === 'offset') {
        const n = Number(meta[2]!.replace('+', ''))
        if (Number.isFinite(n)) offset = n
      }
      continue
    }
    const times: number[] = []
    let lastIndex = 0
    TIME_TAG.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TIME_TAG.exec(line)) !== null) {
      if (m.index !== lastIndex) break // tags must be a prefix run
      times.push(toMs(m[1]!, m[2]!, m[3]))
      lastIndex = TIME_TAG.lastIndex
    }
    if (times.length === 0) continue
    let body = line.slice(lastIndex)
    const vm = VOICE.exec(body)
    if (vm) {
      voice = vm[1]
      body = body.slice(vm[0].length)
    }
    const { text: clean, words } = parseEnhancedBody(body)
    for (const t of times) raw.push({ startMs: t, text: clean, words, voice })
  }
  const singers = singerMap(raw.map((l) => l.voice))

  raw.sort((a, b) => a.startMs - b.startMs)
  const lines: Line[] = raw.map((l) => ({
    text: l.text,
    startMs: Math.max(0, l.startMs - offset),
    endMs: 0,
    words: l.words?.map((w) => ({ ...w, startMs: Math.max(0, w.startMs - offset), endMs: Math.max(0, w.endMs - offset) })),
    ...(singers && l.voice ? { singer: singers.get(l.voice) } : {})
  }))
  const merged = mergeSameTime(lines)
  inferEndTimes(merged, durationMs)
  return merged
}

/**
 * Singer marks → 1 / 2 / 3 (together). "v1"/"v2" keep their numbers; "M"/"F" go by who sings
 * first; "D" is both. null unless at least two different singers appear.
 */
function singerMap(voices: Array<string | undefined>): Map<string, 1 | 2 | 3> | null {
  const solo = [...new Set(voices.filter((v): v is string => !!v && v !== 'D'))]
  if (solo.length < 2) return null
  const map = new Map<string, 1 | 2 | 3>([['D', 3]])
  const numbered = solo.every((v) => v.startsWith('v'))
  const order = numbered ? [...solo].sort() : solo
  order.forEach((v, i) => map.set(v, i === 0 ? 1 : 2))
  return map
}

/** Lines this close together are printed at "the same time" in the file. */
const SAME_TIME_MS = 30

/**
 * Many files pair each line with its romanization or translation under the same timestamp
 * ("[00:11.88]静かな朝に光が差す" then "[00:11.88]Shizukana asa ni hikari ga sasu"). Shown as two
 * lines, the first would never be highlighted. Fold the extra text into `sub` instead, and
 * drop exact duplicates. Lines must be sorted by start time.
 */
export function mergeSameTime(lines: Line[]): Line[] {
  const out: Line[] = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (!prev || Math.abs(l.startMs - prev.startMs) > SAME_TIME_MS) {
      out.push({ ...l })
      continue
    }
    const text = l.text.trim()
    if (!text) continue
    if (!prev.text.trim()) {
      // An empty marker followed by real text at the same moment: the text wins.
      out[out.length - 1] = { ...l, sub: prev.sub }
      continue
    }
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    if (same(text, prev.text) || (prev.sub && same(text, prev.sub))) {
      if (!prev.words?.length && l.words?.length) prev.words = l.words
      if (l.endMs > prev.endMs) prev.endMs = l.endMs
      continue
    }
    prev.sub = prev.sub ? `${prev.sub} / ${text}` : text
    // Two singers at once, each with their own words: show it as sung together.
    if (prev.singer && l.singer && l.singer !== prev.singer) prev.singer = 3
    if (l.endMs > prev.endMs) prev.endMs = l.endMs
  }
  return out
}

/** `♪` (and similar) on its own marks an instrumental passage → empty line. */
function stripMarker(t: string): string {
  const s = t.trim()
  return /^[♪♫…\-–—.·]*$/.test(s) ? '' : s
}

/** Split an enhanced-LRC body like `<00:12.00>Hello <00:12.50>world` into words. */
function parseEnhancedBody(body: string): { text: string; words?: Word[] } {
  WORD_TAG.lastIndex = 0
  if (!WORD_TAG.test(body)) return { text: stripMarker(body) }
  WORD_TAG.lastIndex = 0
  const parts: Array<{ t: number; s: string }> = []
  let m: RegExpExecArray | null
  let lastEnd = 0
  let pendingTime: number | null = null
  while ((m = WORD_TAG.exec(body)) !== null) {
    const seg = body.slice(lastEnd, m.index)
    if (pendingTime !== null) parts.push({ t: pendingTime, s: seg })
    else if (seg.trim()) parts.push({ t: -1, s: seg }) // text before the first tag
    pendingTime = toMs(m[1]!, m[2]!, m[3])
    lastEnd = WORD_TAG.lastIndex
  }
  if (pendingTime !== null) parts.push({ t: pendingTime, s: body.slice(lastEnd) })
  const words: Word[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (!p.s.trim()) continue
    const next = parts.slice(i + 1).find((q) => q.t >= 0)
    words.push({ text: p.s, startMs: p.t < 0 ? (next?.t ?? 0) : p.t, endMs: next?.t ?? p.t + 500 })
  }
  // Keep trailing spaces so words can be concatenated for display.
  return { text: words.map((w) => w.text).join('').trim(), words }
}

export function inferEndTimes(lines: Line[], durationMs = 0): void {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (!(l.endMs && l.endMs > l.startMs)) {
      const next = lines[i + 1]
      l.endMs = next ? next.startMs : durationMs > l.startMs ? durationMs : l.startMs + 5_000
    }
    if (l.words?.length) {
      const lastWord = l.words[l.words.length - 1]!
      if (!lastWord.endMs || lastWord.endMs <= lastWord.startMs) lastWord.endMs = l.endMs
    }
  }
}

/** Lyricsfile 1.0 (YAML already parsed into a plain object) → lines. */
export function fromLyricsfile(doc: unknown, durationMs = 0): { lines: Line[]; plain: string; instrumental: boolean } {
  const d = (doc ?? {}) as Record<string, unknown>
  const meta = (d.metadata ?? {}) as Record<string, unknown>
  const offset = Number(meta.offset_ms ?? 0) || 0
  const rawLines = Array.isArray(d.lines) ? (d.lines as Array<Record<string, unknown>>) : []
  const lines: Line[] = []
  for (const rl of rawLines) {
    const startMs = Number(rl.start_ms)
    if (!Number.isFinite(startMs)) continue
    const words = Array.isArray(rl.words)
      ? (rl.words as Array<Record<string, unknown>>)
          .filter((w) => Number.isFinite(Number(w.start_ms)))
          .map((w) => ({
            text: String(w.text ?? ''),
            startMs: Number(w.start_ms) + offset,
            endMs: Number.isFinite(Number(w.end_ms)) ? Number(w.end_ms) + offset : 0
          }))
      : undefined
    if (words) {
      for (let i = 0; i < words.length; i++) {
        const w = words[i]!
        if (!w.endMs) w.endMs = words[i + 1]?.startMs ?? 0
      }
    }
    const text = words?.length ? words.map((w) => w.text).join('').trim() : stripMarker(String(rl.text ?? ''))
    lines.push({
      text,
      startMs: startMs + offset,
      endMs: Number.isFinite(Number(rl.end_ms)) ? Number(rl.end_ms) + offset : 0,
      words: words?.length ? words : undefined
    })
  }
  lines.sort((a, b) => a.startMs - b.startMs)
  inferEndTimes(lines, durationMs)
  return { lines, plain: String(d.plain ?? ''), instrumental: Boolean(meta.instrumental) }
}

/** Index of the line active at `ms`, or -1 before the first line. */
export function activeLineIndex(lines: Line[], ms: number): number {
  // binary search for the last line with startMs <= ms
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid]!.startMs <= ms) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/* ---------- Title / artist normalisation for lyric lookups ---------- */

const NOISE = [
  /\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|visuali[sz]er|remaster(ed)?|live|version|edit|mix|hd|4k|mv|m\/v)[^\)\]]*[\)\]]/gi,
  /\s*[\(\[]\s*(feat|ft)\.?[^\)\]]*[\)\]]/gi,
  /\s+(feat|ft)\.?\s+.*$/i,
  /\s*[-–—|]\s*(official\s+)?(music\s+)?(video|audio|lyrics?|visuali[sz]er).*$/i,
  // Spotify / Apple Music version suffixes: "- Remastered 2009", "- 2015 Remaster", "- Radio Edit".
  /\s+[-–—]\s+(?=[^-–—]*\b(remaster(ed)?|edit|version|mix|live|mono|stereo|demo|acoustic|from|bonus\s+track)\b)[^-–—]*$/i
]

export function cleanTitle(title: string): string {
  let t = title
  for (const re of NOISE) t = t.replace(re, '')
  return t.replace(/\s{2,}/g, ' ').trim()
}

export function cleanArtist(artist: string): string {
  return artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .split(/\s*(?:,|&|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b)\s*/i)[0]!
    .trim()
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token-set similarity in [0,1] — order-insensitive, tolerant to extra words. */
export function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean))
  const tb = new Set(normalize(b).split(' ').filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.max(ta.size, tb.size)
}

/** QQ prefixes lyrics with "Title - Artist" and credit lines ("Composed by：…"); drop them. */
const CREDIT = /^(.+\s-\s.+|.*(词|曲|编曲|制作|监制|混音|母带|作词|作曲|\b(?:composer|composed|lyricist|lyrics|written|writer|producer|produced|arranged|arranger|mix(?:ed)?|master(?:ed)?|engineer|publisher|vocals?|guitar|bass|drums|keyboards?|op|sp|isrc)\b).*[:：].*)$/i

export function stripCredits(lines: Line[]): Line[] {
  let i = 0
  while (i < lines.length && i < 12 && (CREDIT.test(lines[i]!.text) || !lines[i]!.text.trim())) i++
  return lines.slice(i)
}


/**
 * Some uploads take plain lyrics and stamp them at a fixed interval (0:00, 0:05.2, 0:10.4…).
 * Real singing never has near-identical gaps across a whole song, so treat that as untimed.
 */
export function looksFakeSynced(lines: Line[]): boolean {
  const starts = lines.filter((l) => l.text.trim()).map((l) => l.startMs)
  if (starts.length < 8) return false
  const gaps = starts.slice(1).map((t, i) => t - starts[i]!)
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  if (median <= 0) return true
  const same = gaps.filter((g) => Math.abs(g - median) <= 60).length
  if (same / gaps.length >= 0.75) return true
  // Guessed timings snapped to a coarse grid: real syncs carry centisecond-level variation,
  // so ~1 in 20 real stamps lands on a 200 ms step by chance, never 90% of them.
  const onGrid = starts.filter((t) => t % 200 === 0).length
  return onGrid / starts.length >= 0.9
}
