import type { Line } from './types'
import { estimateWords } from './estimate'

/**
 * Automatic lyric offset from audio features.
 *
 * The extension samples the playing audio every ~20 ms: band energy (250–4000 Hz) of the
 * stereo mid and side signals and the mid's spectral flatness. Lead vocals sit in the
 * centre and are harmonic, so "mid minus side, minus flatness" rises while someone sings.
 * We correlate that vocal-activity curve (and its onsets) against where the lyrics say
 * singing happens, over a range of candidate offsets, and accept the best one only if it
 * clearly beats every alternative.
 *
 * Offset convention matches the app: positive = lyrics shown later.
 */
export interface AudioFrame {
  /** media time, seconds */
  t: number
  /** log10 band power, mid channel */
  mid: number
  /** log10 band power, side channel */
  side: number
  /** spectral flatness of mid band, 0 (tonal) … 1 (noise) */
  flat: number
}

export interface SyncResult {
  offsetMs: number
  score: number
  /** best score minus the best score ≥ MARGIN_WINDOW_MS away */
  margin: number
  /** lyric lines inside the analysed audio */
  lines: number
  /** seconds of usable audio */
  seconds: number
  confident: boolean
}

const STEP_MS = 20
const SEARCH_MS = 3000
const MARGIN_WINDOW_MS = 400
const MIN_SECONDS = 25
const MIN_LINES = 6
export const MIN_SCORE = 0.12
export const MIN_MARGIN = 0.03

/** Sung spans (ms) per line: from line start to where its last (estimated) word ends. */
export function sungSpans(lines: Line[]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const l of lines) {
    if (!l.text.trim()) continue
    const words = l.words?.length ? l.words : estimateWords(l)
    const end = words.length ? words[words.length - 1]!.endMs : l.endMs
    if (end > l.startMs) spans.push([l.startMs, end])
  }
  return spans
}

function movingAverage(x: Float64Array, valid: Uint8Array, radius: number): Float64Array {
  const out = new Float64Array(x.length)
  let sum = 0
  let n = 0
  // Sliding window over valid samples only.
  for (let i = 0; i < Math.min(radius, x.length); i++) if (valid[i]) (sum += x[i]!), n++
  for (let i = 0; i < x.length; i++) {
    const add = i + radius
    const drop = i - radius - 1
    if (add < x.length && valid[add]) (sum += x[add]!), n++
    if (drop >= 0 && valid[drop]) (sum -= x[drop]!), n--
    out[i] = n ? sum / n : 0
  }
  return out
}

function corr(a: Float64Array, b: Float64Array, valid: Uint8Array): number {
  let n = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < a.length; i++) if (valid[i]) (n++, (sa += a[i]!), (sb += b[i]!))
  if (n < 2) return 0
  const ma = sa / n
  const mb = sb / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    if (!valid[i]) continue
    const x = a[i]! - ma
    const y = b[i]! - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export function estimateOffset(frames: AudioFrame[], lines: Line[]): SyncResult | null {
  if (frames.length < 50) return null
  const sorted = [...frames].sort((a, b) => a.t - b.t)
  const t0 = Math.floor((sorted[0]!.t * 1000) / STEP_MS)
  const t1 = Math.ceil((sorted[sorted.length - 1]!.t * 1000) / STEP_MS)
  const len = t1 - t0 + 1
  if (len <= 0 || len > 30_000) return null

  // Bin frames onto a 20 ms grid.
  const raw = new Float64Array(len)
  const cnt = new Uint16Array(len)
  for (const f of sorted) {
    if (!Number.isFinite(f.mid) || f.mid < -11) continue // silence
    const i = Math.round((f.t * 1000) / STEP_MS) - t0
    if (i < 0 || i >= len) continue
    raw[i] = raw[i]! + f.mid + (f.mid - f.side) - 2 * f.flat
    cnt[i]!++
  }
  const valid = new Uint8Array(len)
  for (let i = 0; i < len; i++) if (cnt[i]) ((raw[i] = raw[i]! / cnt[i]!), (valid[i] = 1))
  // Bridge single-frame holes (timer jitter) by copying the neighbour.
  for (let i = 1; i < len - 1; i++) {
    if (!valid[i] && valid[i - 1] && valid[i + 1]) {
      raw[i] = (raw[i - 1]! + raw[i + 1]!) / 2
      valid[i] = 1
    }
  }
  let seconds = 0
  for (let i = 0; i < len; i++) seconds += valid[i]! * (STEP_MS / 1000)
  if (seconds < MIN_SECONDS) return null

  // Vocal activity: detrend with a 3 s window, lightly smooth (≈100 ms).
  const trend = movingAverage(raw, valid, Math.round(1500 / STEP_MS))
  const detr = new Float64Array(len)
  for (let i = 0; i < len; i++) detr[i] = raw[i]! - trend[i]!
  const act = movingAverage(detr, valid, 2)
  // Onsets: positive slope of activity over ~60 ms.
  const ons = new Float64Array(len)
  for (let i = 3; i < len; i++) ons[i] = valid[i] && valid[i - 3] ? Math.max(0, act[i]! - act[i - 3]!) : 0
  const onsS = movingAverage(ons, valid, 3)

  const spans = sungSpans(lines)
  const startMs = (t0 * STEP_MS)
  const endMs = (t1 * STEP_MS)
  const linesIn = spans.filter(([a, b]) => b > startMs - SEARCH_MS && a < endMs + SEARCH_MS).length
  if (linesIn < MIN_LINES) return null

  // Templates as functions of lyric-file time; evaluated at (media time − offset).
  const tplAct = new Float64Array(len)
  const tplOns = new Float64Array(len)
  const scores: Array<[number, number]> = []
  for (let off = -SEARCH_MS; off <= SEARCH_MS; off += STEP_MS) {
    tplAct.fill(0)
    tplOns.fill(0)
    for (const [a, b] of spans) {
      const ia = Math.round((a + off) / STEP_MS) - t0
      const ib = Math.round((b + off) / STEP_MS) - t0
      for (let i = Math.max(0, ia); i <= Math.min(len - 1, ib); i++) tplAct[i] = 1
      for (let i = Math.max(0, ia - 4); i <= Math.min(len - 1, ia + 4); i++) tplOns[i] = 1 - Math.abs(i - ia) / 5
    }
    scores.push([off, corr(act, tplAct, valid) + corr(onsS, tplOns, valid)])
  }

  let best = scores[0]!
  for (const s of scores) if (s[1] > best[1]) best = s
  let rival = -Infinity
  for (const s of scores) if (Math.abs(s[0] - best[0]) >= MARGIN_WINDOW_MS && s[1] > rival) rival = s[1]
  const margin = best[1] - rival
  return {
    offsetMs: best[0],
    score: best[1],
    margin,
    lines: linesIn,
    seconds,
    confident: best[1] >= MIN_SCORE && margin >= MIN_MARGIN
  }
}
