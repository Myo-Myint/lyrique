/**
 * Offline Japanese romanization. kuromoji splits a line into words and reads the kanji from
 * the IPADIC dictionary shipped with the app; wanakana turns the kana into Hepburn romaji.
 * Words are spaced the way lyric sites write them: particles stand alone, while verb endings
 * and auxiliaries stay on their verb (shite iku, aishiteru).
 */
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'
import { dirname, join } from 'node:path'
import { toRomaji } from 'wanakana'
import type { Line } from '../shared/types'

let tokenizer: Promise<Tokenizer<IpadicFeatures>> | null = null

function load(): Promise<Tokenizer<IpadicFeatures>> {
  tokenizer ??= new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
    const dicPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict')
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)))
  }).catch((err) => {
    tokenizer = null // try again next time
    throw err
  })
  return tokenizer
}

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/u
const PUNCT: Record<string, string> = { '、': ',', '。': '.', '！': '!', '？': '?', '「': '"', '」': '"', '『': '"', '』': '"', '・': ' ', '…': '…', '～': '~', '〜': '~', '（': '(', '）': ')' }
/** Loanword sounds wanakana spells out kana by kana (medeia, fuo): spell them as said. */
const LOAN: Record<string, string> = { ディ: 'di', ティ: 'ti', デュ: 'dyu', ドゥ: 'du', トゥ: 'tu', ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ヴ: 'vu', チェ: 'che', シェ: 'she', ジェ: 'je' }
const LOAN_RE = new RegExp(`(${Object.keys(LOAN).join('|')})(ー?)`, 'g')
const romaji = (kana: string) => toRomaji(kana.replace(LOAN_RE, (_, k: string, long: string) => LOAN[k]! + (long ? LOAN[k]!.slice(-1) : '')))
const PARTICLE: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' }
/** Readings the dictionary gets wrong in lyrics: 愛して is aishite, not the itoshi- of 愛しい. */
const READING: Record<string, string> = { 愛し: 'アイシ' }
/** Counted people the dictionary splits into number + suffix (ichi-nin): read as one word. */
const PEOPLE: Record<string, string> = { 一: 'ヒトリ', 二: 'フタリ' }

function joinPeople(tokens: IpadicFeatures[]): IpadicFeatures[] {
  const out: IpadicFeatures[] = []
  for (const t of tokens) {
    const prev = out[out.length - 1]
    if (prev && t.surface_form === '人' && PEOPLE[prev.surface_form]) {
      out[out.length - 1] = { ...prev, surface_form: prev.surface_form + '人', pos: '名詞', pos_detail_1: '一般', reading: PEOPLE[prev.surface_form]! }
    } else out.push(t)
  }
  return out
}

/** Stays on the word before it: verb endings, auxiliaries, conjunctive て/で/ば, suffixes. */
function glues(t: IpadicFeatures, prev: IpadicFeatures): boolean {
  // After a noun the copula stands alone (suki datta, kanzen na); after a verb it's an ending.
  if (t.pos === '助動詞') return prev.pos !== '名詞'
  if (t.pos_detail_1 === '接尾') return true
  if (t.pos === '動詞' && t.pos_detail_1 === '非自立' && /^[てでちじと]/.test(t.surface_form)) return true
  if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && /^(て|で|ば|ちゃ|じゃ)$/.test(t.surface_form)) return true
  return false
}

function romanizeTokens(tokens: IpadicFeatures[]): string {
  let out = ''
  let space = false // whitespace seen in the original since the last word
  let prevJapanese = false
  let prev: IpadicFeatures | null = null
  let sokuon = false // a small っ ends the last word: it doubles the next consonant (ma|tte)
  for (const t of tokens) {
    const s = t.surface_form
    if (!s.trim()) {
      space = true
      continue
    }
    if (s in PUNCT || /^\p{P}+$/u.test(s)) {
      out += PUNCT[s] ?? s
      space = /[,.!?)]$/.test(PUNCT[s] ?? s) || space
      prevJapanese = false
      continue
    }
    const japanese = JAPANESE.test(s)
    let word: string
    if (!japanese) word = s
    else if (t.pos === '助詞' && PARTICLE[s]) word = PARTICLE[s]!
    else {
      let kana = READING[s] ?? (t.reading && t.reading !== '*' ? t.reading : s)
      if (sokuon) kana = 'ッ' + kana
      sokuon = /[ッっ]$/.test(kana)
      word = romaji(sokuon ? kana.slice(0, -1) : kana)
    }
    if (!japanese) sokuon = false
    if (japanese && t.pos_detail_1 === '接尾' && t.pos_detail_2 === '人名' && prevJapanese) word = '-' + word
    const glue = out === '' || (japanese ? prevJapanese && !!prev && glues(t, prev) : !space && !prevJapanese && !/[,.!?]$/.test(out))
    out += (glue ? '' : ' ') + word
    space = false
    prevJapanese = japanese
    prev = t
  }
  out = out.replace(/\s+/g, ' ').replace(/ ([,.!?)])/g, '$1').trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** Romaji for each line, or null where a line has no Japanese. Throws if the dictionary won't load. */
export async function romanizeJapanese(lines: string[]): Promise<Array<string | null>> {
  const tk = await load()
  return lines.map((line) => (JAPANESE.test(line) ? romanizeTokens(joinPeople(tk.tokenize(line))) || null : null))
}

/** Letters only, with the spelling choices romaji writers differ on folded together (kyō/kyou/kyoo, wo/o). */
function foldRomaji(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ') // ad-libs some files add: (Hey! Hey!)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/wo/g, 'o')
    .replace(/ou|oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/ee|ei/g, 'e')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/n(?=[bmp])/g, 'm')
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
  return m
}

/** Share of a's letter pairs that b also has. */
function covered(a: string, b: string): number {
  const bg = bigrams(b)
  let hit = 0
  let n = 0
  for (const [g, c] of bigrams(a)) {
    n += c
    hit += Math.min(c, bg.get(g) ?? 0)
  }
  return n ? hit / n : 1
}

/** 0–1: how well two romanizations of the same line agree, whichever way they spell things. */
export function romajiAgreement(a: string, b: string): number {
  const x = foldRomaji(a)
  const y = foldRomaji(b)
  if (!x || !y) return x === y ? 1 : 0
  return Math.min(covered(x, y), covered(y, x))
}

/** Below this, the file's romaji belongs to another line (or half of one). */
const AGREE = 0.8

/**
 * Some lyrics files pair each Japanese line with romaji that slipped a line or two out of step,
 * so a line shows the romaji of its neighbour. When most of a file's romaji agrees with ours
 * (so it is romaji, not a translation), lines whose romaji clearly doesn't get ours instead.
 */
export async function checkPairedRomaji(lines: Line[]): Promise<Line[]> {
  const idx = lines.map((_, i) => i).filter((i) => {
    const sub = lines[i]!.sub
    return !!sub && !sub.includes(' / ') && JAPANESE.test(lines[i]!.text) && !JAPANESE.test(sub) && /[a-z]/i.test(sub)
  })
  if (idx.length < 3) return lines
  const ours = await romanizeJapanese(idx.map((i) => lines[i]!.text))
  const scores = idx.map((i, k) => (ours[k] ? romajiAgreement(lines[i]!.sub!, ours[k]!) : 1))
  const bad = scores.flatMap((s, k) => (s < AGREE ? [k] : []))
  if (!bad.length || bad.length * 2 > idx.length) return lines
  const out = lines.slice()
  for (const k of bad) out[idx[k]!] = { ...out[idx[k]!]!, sub: ours[k]! }
  return out
}
