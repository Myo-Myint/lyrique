/**
 * Offline Japanese romanization. kuromoji splits a line into words and reads the kanji from
 * the IPADIC dictionary shipped with the app; wanakana turns the kana into Hepburn romaji.
 * Words are spaced the way lyric sites write them: particles stand alone, while verb endings
 * and auxiliaries stay on their verb (shite iku, aishiteru).
 */
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'
import { dirname, join } from 'node:path'
import { toRomaji } from 'wanakana'

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
  return lines.map((line) => (JAPANESE.test(line) ? romanizeTokens(tk.tokenize(line)) || null : null))
}
