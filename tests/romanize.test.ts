import { describe, expect, it } from 'vitest'
import { needsRomanization, romanizeKorean } from '../src/shared/romanize'

describe('romanizeKorean', () => {
  it.each([
    ['사랑해', 'saranghae'],
    ['너를', 'neoreul'],
    ['좋아해', 'joahae'],
    ['한국어', 'hangugeo'],
    ['감사합니다', 'gamsahamnida'],
    ['신라', 'silla'],
    ['국물', 'gungmul'],
    ['축하해', 'chukahae'],
    ['괜찮아', 'gwaenchana']
  ])('%s → %s', (ko, rom) => expect(romanizeKorean(ko)).toBe(rom))

  it('keeps English and spacing in mixed lines', () => {
    expect(romanizeKorean('Baby 나만 바라봐')).toBe('Baby naman barabwa')
  })
})

describe('needsRomanization', () => {
  it('flags non-Latin letters only', () => {
    expect(needsRomanization('Hola, mi amor — ¿qué tal?')).toBe(false)
    expect(needsRomanization('Café déjà vu')).toBe(false)
    expect(needsRomanization('夜空に光る')).toBe(true)
    expect(needsRomanization('Я тебя люблю')).toBe(true)
    expect(needsRomanization('(oh-oh) 123!')).toBe(false)
  })
})
