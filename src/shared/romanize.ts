/**
 * Script detection and offline Korean romanization (Revised Romanization, with the sound
 * changes singers actually make inside a word: liaison, nasalization, ㄹ assimilation,
 * aspiration). Chinese and Japanese need dictionaries and are handled in the main process.
 */

/** Has letters outside the Latin script, i.e. worth romanizing. */
export function needsRomanization(text: string): boolean {
  for (const ch of text) if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true
  return false
}

export const hasHangul = (s: string) => /\p{Script=Hangul}/u.test(s)
export const hasKana = (s: string) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s)
export const hasHan = (s: string) => /\p{Script=Han}/u.test(s)

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
/** Final consonant as pronounced at the end of a syllable. */
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']

// Initial-consonant indices.
const I = { g: 0, kk: 1, n: 2, d: 3, r: 5, m: 6, b: 7, s: 9, ss: 10, none: 11, j: 12, ch: 14, k: 15, t: 16, p: 17, h: 18 }
/**
 * Before a vowel (next initial ㅇ) the final moves over: [final that stays, initial it becomes].
 * -1 = nothing moves (ㅇ, or ㅎ which goes silent).
 */
const LIAISON: Array<[number, number]> = [
  [0, -1], [0, I.g], [0, I.kk], [1, I.ss], [0, I.n], [4, I.j], [0, I.n], [0, I.d], [0, I.r], [8, I.g], [8, I.m],
  [8, I.b], [8, I.ss], [8, I.t], [8, I.p], [0, I.r], [0, I.m], [0, I.b], [17, I.ss], [0, I.s], [0, I.ss], [21, -1],
  [0, I.j], [0, I.ch], [0, I.k], [0, I.t], [0, I.p], [0, -1]
]

interface Syl {
  l: number
  v: number
  t: number
  /** Overrides after sound changes. */
  lr?: string
  tr?: string
}

function romanizeRun(run: string): string {
  const syl: Syl[] = [...run].map((ch) => {
    const c = ch.codePointAt(0)! - 0xac00
    return { l: Math.floor(c / 588), v: Math.floor((c % 588) / 28), t: c % 28 }
  })
  for (let i = 0; i < syl.length - 1; i++) {
    const a = syl[i]!
    const b = syl[i + 1]!
    if (!a.t) continue
    if (b.l === I.none) {
      const [stay, move] = LIAISON[a.t]!
      if (move >= 0) {
        a.t = stay
        b.l = move
      } else if (a.t === 27) a.t = 0 // ㅎ before a vowel is silent
      continue
    }
    const fin = FINAL[a.t]!
    // ㅎ next to ㄱ/ㄷ/ㅂ/ㅈ: the pair becomes one aspirated consonant.
    if (a.t === 27 || a.t === 6 || a.t === 15) {
      const asp: Record<number, string> = { [I.g]: 'k', [I.d]: 't', [I.j]: 'ch' }
      if (asp[b.l]) {
        a.tr = a.t === 27 ? '' : 'l'
        if (a.t === 6) a.tr = 'n'
        b.lr = asp[b.l]
        continue
      }
    }
    if (b.l === I.h && (fin === 'k' || fin === 't' || fin === 'p')) {
      a.tr = ''
      b.lr = fin
      continue
    }
    // Nasalization before ㄴ/ㅁ.
    if (b.l === I.n || b.l === I.m) {
      if (fin === 'k') a.tr = 'ng'
      else if (fin === 't') a.tr = 'n'
      else if (fin === 'p') a.tr = 'm'
      else if (fin === 'l' && b.l === I.n) b.lr = 'l'
      continue
    }
    if (b.l === I.r) {
      if (fin === 'n' || fin === 'l') {
        a.tr = 'l'
        b.lr = 'l'
      } else if (fin === 'm' || fin === 'ng') b.lr = 'n'
      else if (fin === 'k') {
        a.tr = 'ng'
        b.lr = 'n'
      } else if (fin === 'p') {
        a.tr = 'm'
        b.lr = 'n'
      }
    }
  }
  return syl
    .map((s, i) => {
      // ㄹ at the start of a word is "r"; between vowels it's "r" too.
      const l = s.lr ?? INITIAL[s.l]!
      return (i === 0 && s.l === I.r && s.lr === undefined ? 'r' : l) + VOWEL[s.v]! + (s.tr ?? FINAL[s.t]!)
    })
    .join('')
}

/** Romanize the Hangul in a line; anything else (English, punctuation) is left as is. */
export function romanizeKorean(text: string): string {
  return text.replace(/[가-힣]+/g, romanizeRun)
}
