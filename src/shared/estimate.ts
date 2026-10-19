import type { Line, Word } from './types'

/**
 * Word-timing estimation for line-synced lyrics.
 *
 * Words are weighted by syllable count (vowel groups) rather than characters, which
 * over-weight consonant clusters. The sung span is capped at ~400 ms per syllable so a
 * line that "lasts" until the next line's start doesn't stretch across an instrumental
 * gap, and the last word gets a held-note tail. Constants are starting points to tune
 * against word-synced LRCLIB tracks.
 */
export const MS_PER_SYLLABLE = 400
const WORD_ONSET_WEIGHT = 0.3
const MIN_WORD_MS = 150
const LINE_TAIL_GAP_MS = 250
const HELD_TAIL_MS = 1800

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const TOKENS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][^\S\n]*|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+[^\S\n]*/gu
const VOWEL_GROUPS = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœаеёиоуыэюяіїє]+/giu

/** Rough syllable count for one token; CJK characters count as one each. */
export function syllables(token: string): number {
  const w = token.trim().toLowerCase()
  if (!w) return 0
  if (CJK.test(w)) return 1
  const letters = w.replace(/[^\p{L}\p{N}]/gu, '')
  if (!letters) return 0.5 // punctuation-only token, e.g. a dash
  let n = (letters.match(VOWEL_GROUPS) ?? []).length
  if (n === 0) return Math.max(1, Math.round(letters.length / 3))
  // Silent trailing "e" ("time", "love"), but not "-le" ("little") or "-ee".
  if (n > 1 && /[^aeiouyl]e$/.test(letters)) n--
  return n
}

/** Split a line into display tokens: words, or single characters for CJK. Keeps trailing spaces. */
export function tokenize(text: string): string[] {
  return text.match(TOKENS) ?? []
}

export function estimateWords(line: Line): Word[] {
  const parts = tokenize(line.text)
  if (!parts.length) return []
  const syl = parts.map(syllables)
  const weights = syl.map((s) => s + WORD_ONSET_WEIGHT)
  const totalW = weights.reduce((a, b) => a + b, 0)
  const totalSyl = syl.reduce((a, b) => a + b, 0)

  const start = line.startMs
  const lineEnd = line.endMs > start ? line.endMs : start + totalSyl * MS_PER_SYLLABLE + LINE_TAIL_GAP_MS
  const room = lineEnd - start
  const span = room > LINE_TAIL_GAP_MS * 2 ? Math.min(room - LINE_TAIL_GAP_MS, totalSyl * MS_PER_SYLLABLE) : room * 0.8

  let durs = weights.map((w) => Math.max(MIN_WORD_MS, (span * w) / totalW))
  // Floors can push a fast line past its slot; squeeze everything back in proportionally.
  const sum = durs.reduce((a, b) => a + b, 0)
  if (sum > room * 0.95) durs = durs.map((d) => (d * room * 0.95) / sum)

  let t = start
  const words = parts.map((text, i) => {
    const w = { text, startMs: Math.round(t), endMs: Math.round(t + durs[i]!) }
    t += durs[i]!
    return w
  })
  const last = words[words.length - 1]!
  last.endMs = Math.max(last.endMs, Math.min(lineEnd - 100, last.startMs + HELD_TAIL_MS))
  return words
}
