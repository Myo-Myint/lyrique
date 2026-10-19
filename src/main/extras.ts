/**
 * The optional second line under each lyric: romanization or translation.
 *
 * Romanization: Korean and Chinese are done offline (rules / pinyin dictionary). Japanese
 * kanji readings and other scripts (Cyrillic, Thai, …) need a dictionary we don't ship, so
 * those lines go to Google Translate's public endpoint, which returns a transliteration.
 * Translation also uses that endpoint. Either way only lyric text is sent, and only while the
 * user has the feature switched on.
 */
import { app, net } from 'electron'
import { pinyin } from 'pinyin-pro'
import { hasHan, hasHangul, hasKana, needsRomanization, romanizeKorean } from '../shared/romanize'
import type { SubMode } from '../shared/types'
import { logProblem } from './log'
import { getLocale, t } from '../shared/i18n'

export type SubResult = { lines: Array<string | null>; note?: string }

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
/** Survives transliteration intact, so one request can carry many lines. */
const SEP = ' ◆ '
const MAX_CHARS = 3500

const cache = new Map<string, Promise<SubResult>>()

export function systemLanguage(): string {
  const tag = app.getPreferredSystemLanguages()[0] ?? app.getLocale() ?? 'en'
  const [lang, region] = tag.split('-')
  // Google wants zh-CN / zh-TW; everything else by base language.
  if (lang === 'zh') return region === 'TW' || region === 'HK' || region === 'Hant' ? 'zh-TW' : 'zh-CN'
  return lang || 'en'
}

export function subtitles(lines: string[], mode: SubMode, target: string): Promise<SubResult> {
  if (mode === 'off') return Promise.resolve({ lines: lines.map(() => null) })
  const key = `${mode}\u0000${target}\u0000${lines.join('\n')}`
  let hit = cache.get(key)
  if (!hit) {
    hit = (mode === 'romanize' ? romanize(lines) : translate(lines, target)).catch((err) => {
      cache.delete(key) // let a later attempt retry
      logProblem('translation', `${mode}: ${String(err?.message ?? err)}`)
      return { lines: lines.map(() => null), note: t('subs.unreachable', { error: String(err?.message ?? err) }) }
    })
    cache.set(key, hit)
    if (cache.size > 40) cache.delete(cache.keys().next().value!)
  }
  return hit
}

async function post(params: string, q: string): Promise<unknown> {
  const res = await net.fetch(`${ENDPOINT}?client=gtx&${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `q=${encodeURIComponent(q)}`
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Split lines into request-sized groups of indices. */
function chunks(idx: number[], lines: string[], sepLen: number): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  let len = 0
  for (const i of idx) {
    const l = lines[i]!.length + sepLen
    if (cur.length && len + l > MAX_CHARS) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(i)
    len += l
  }
  if (cur.length) out.push(cur)
  return out
}

async function romanize(lines: string[]): Promise<SubResult> {
  const out: Array<string | null> = lines.map(() => null)
  const all = lines.join('\n')
  // Kana anywhere means the Han characters are Japanese kanji, not Chinese.
  const japanese = hasKana(all)
  const remote: number[] = []
  lines.forEach((text, i) => {
    if (!needsRomanization(text)) return
    if (hasHangul(text) && !hasKana(text) && !hasHan(text)) out[i] = romanizeKorean(text)
    else if (!japanese && hasHan(text) && !hasHangul(text)) {
      out[i] = text.replace(/\p{Script=Han}+/gu, (run) => ` ${pinyin(run, { type: 'string', toneType: 'symbol', nonZh: 'consecutive' })} `)
        .replace(/\s+/g, ' ')
        .trim()
    } else remote.push(i)
  })
  for (const group of chunks(remote, lines, SEP.length)) {
    const data = (await post(`sl=${japanese ? 'ja' : 'auto'}&tl=en&dt=rm`, group.map((i) => lines[i]).join(SEP))) as unknown[][]
    const rm = (data?.[0] as unknown[] | undefined)?.at(-1) as unknown[] | undefined
    const parts = typeof rm?.[3] === 'string' ? rm[3].split(/\s*◆\s*/) : []
    if (parts.length !== group.length) continue // misaligned: show nothing rather than wrong lines
    group.forEach((i, k) => (out[i] = parts[k]!.trim() || null))
  }
  if (out.every((x) => x === null)) return { lines: out, note: t('subs.alreadyLatin') }
  return { lines: out }
}

async function translate(lines: string[], target: string): Promise<SubResult> {
  const out: Array<string | null> = lines.map(() => null)
  const idx = lines.map((_, i) => i).filter((i) => /\p{L}/u.test(lines[i]!))
  const langs: string[] = []
  for (const group of chunks(idx, lines, 1)) {
    const data = (await post(`sl=auto&tl=${encodeURIComponent(target)}&dt=t`, group.map((i) => lines[i]).join('\n'))) as unknown[]
    const segs = (data?.[0] as Array<[string, string]> | null) ?? []
    if (typeof data?.[2] === 'string') langs.push(data[2])
    // Each segment pairs translated and original text; rebuild line by line.
    const trans = segs.map((s) => (typeof s?.[0] === 'string' ? s[0] : '')).join('').split('\n')
    if (trans.length !== group.length) continue
    group.forEach((i, k) => {
      const t = trans[k]!.trim()
      // Lines already in the target language (English hooks in K-pop) need no second line.
      out[i] = t && t.toLowerCase() !== lines[i]!.trim().toLowerCase() ? t : null
    })
  }
  const base = (l: string) => l.split('-')[0]
  if (langs.length && langs.every((l) => base(l) === base(target))) {
    return { lines: lines.map(() => null), note: t('subs.alreadyIn', { language: languageName(target) }) }
  }
  return { lines: out }
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale(), 'en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Offered in the menu bar's "Translate To" list. */
export const TRANSLATE_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh-CN', 'zh-TW', 'th', 'vi', 'id', 'my', 'hi', 'ru', 'ar', 'tr']
