/**
 * Interface language. English is the base; each other language translates what it can and
 * falls back to English for anything missing. Main and every window call setLocale() once
 * at start, with the same code (main decides it from Settings → Language or macOS).
 */
import en, { type MessageId, type MessageKey } from './locales/en'
import my from './locales/my'
import ja from './locales/ja'
import ko from './locales/ko'
import th from './locales/th'
import es from './locales/es'
import fr from './locales/fr'
import pt from './locales/pt'
import zhHans from './locales/zh-Hans'
import zhHant from './locales/zh-Hant'

export type { MessageKey }
export type Catalog = Partial<Record<MessageId, string>>

/** Each language's name in that language, for the Language menu. */
export const LOCALES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  my: 'မြန်မာ',
  th: 'ไทย',
  ja: '日本語',
  ko: '한국어',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文'
} as const
export type Locale = keyof typeof LOCALES

const CATALOGS: Record<Locale, Catalog> = { en, my, ja, ko, th, es, fr, pt, 'zh-Hans': zhHans, 'zh-Hant': zhHant }

let locale: Locale = 'en'
let catalog: Catalog = en
let windows = false

/** Windows: its own wording where the Mac's differs, and Ctrl/Alt/Shift for ⌘/⌥/⇧. */
export function setPlatform(platform: string): void {
  windows = platform === 'win32'
}

/** Key names as this computer's keyboard prints them: "⌥⌘L" → "Ctrl+Alt+L" on Windows. */
export function keyLabel(s: string): string {
  if (!windows) return s
  return s.replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
}

/** Best interface language for macOS's preferred languages (e.g. "pt-BR", "zh-Hant-TW"). */
export function pickLocale(preferred: string[]): Locale {
  for (const tag of preferred) {
    const [lang, ...rest] = tag.split(/[-_]/)
    if (lang === 'zh') return rest.some((r) => /^(Hant|TW|HK|MO)$/i.test(r)) ? 'zh-Hant' : 'zh-Hans'
    if (lang && lang in LOCALES) return lang as Locale
  }
  return 'en'
}

export function setLocale(code: string): void {
  locale = code in CATALOGS ? (code as Locale) : 'en'
  catalog = CATALOGS[locale]
}

export function getLocale(): Locale {
  return locale
}

/** Translated text for `key`, with {name} placeholders filled from `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const win = windows ? catalog[`${key}@win` as MessageId] : undefined
  const s = keyLabel(win ?? catalog[key] ?? en[key])
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** "A, B and C" in the interface language. */
export function listJoin(xs: string[]): string {
  if (xs.length < 2) return xs.join('')
  return t('list.and', { list: xs.slice(0, -1).join(t('list.comma')), last: xs[xs.length - 1]! })
}

/** Fill elements marked data-i18n (text), data-i18n-html, data-i18n-title and data-i18n-placeholder. */
export function translateDom(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey)
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as MessageKey)
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as MessageKey)
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel as MessageKey))
}
