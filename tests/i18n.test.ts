import { describe, expect, it } from 'vitest'
import en from '../src/shared/locales/en'
import { LOCALES, listJoin, pickLocale, setLocale, t } from '../src/shared/i18n'
import my from '../src/shared/locales/my'
import ja from '../src/shared/locales/ja'
import ko from '../src/shared/locales/ko'
import th from '../src/shared/locales/th'
import es from '../src/shared/locales/es'
import fr from '../src/shared/locales/fr'
import pt from '../src/shared/locales/pt'
import zhHans from '../src/shared/locales/zh-Hans'
import zhHant from '../src/shared/locales/zh-Hant'

const catalogs = { my, ja, ko, th, es, fr, pt, 'zh-Hans': zhHans, 'zh-Hant': zhHant } as Record<string, Record<string, string>>
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const tags = (s: string) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort()

describe('translations', () => {
  for (const [code, cat] of Object.entries(catalogs)) {
    describe(code, () => {
      it('covers every message and nothing extra', () => {
        expect(Object.keys(cat).filter((k) => !(k in en))).toEqual([])
        expect(Object.keys(en).filter((k) => !(k in cat))).toEqual([])
      })
      it('keeps every {placeholder} and HTML tag', () => {
        const bad: string[] = []
        for (const [k, v] of Object.entries(en)) {
          const tr = cat[k]
          if (tr === undefined) continue
          if (JSON.stringify(placeholders(tr)) !== JSON.stringify(placeholders(v))) bad.push(`${k}: placeholders`)
          if (JSON.stringify(tags(tr)) !== JSON.stringify(tags(v))) bad.push(`${k}: tags`)
          if (!tr.trim()) bad.push(`${k}: empty`)
        }
        expect(bad).toEqual([])
      })
    })
  }
})

describe('locale choice', () => {
  it('maps macOS languages to interface languages', () => {
    expect(pickLocale(['pt-BR'])).toBe('pt')
    expect(pickLocale(['zh-Hant-TW'])).toBe('zh-Hant')
    expect(pickLocale(['zh-HK'])).toBe('zh-Hant')
    expect(pickLocale(['zh-Hans-CN'])).toBe('zh-Hans')
    expect(pickLocale(['de-DE', 'fr-FR'])).toBe('fr')
    expect(pickLocale(['de-DE'])).toBe('en')
    expect(Object.keys(LOCALES)).toHaveLength(10)
  })

  it('fills placeholders and falls back to English', () => {
    setLocale('xx')
    expect(t('notice.update', { version: '1.0' })).toBe('Lyrique 1.0 is available.')
    expect(listJoin(['A', 'B', 'C'])).toBe('A, B and C')
    setLocale('en')
  })
})
