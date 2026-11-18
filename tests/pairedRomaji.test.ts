import { describe, expect, it } from 'vitest'
import { checkPairedRomaji, romajiAgreement } from '../src/main/japanese'
import type { Line } from '../src/shared/types'

const line = (text: string, sub?: string, i = 0): Line => ({ text, sub, startMs: i * 1000, endMs: i * 1000 + 900 })

describe('romajiAgreement', () => {
  it('ignores spelling choices and ad-libs', () => {
    expect(romajiAgreement('Kyō mo uso wo tsuku no', 'Kyou mo uso o tsuku no')).toBe(1)
    expect(romajiAgreement('Ashita mo aou yo (Hey! Hey!)', 'Ashita mo aou yo')).toBe(1)
  })
  it('scores a neighbour line low', () => expect(romajiAgreement('kore wa yume janai', 'Kaze ga fuiteru')).toBeLessThan(0.5))
})

describe('checkPairedRomaji', () => {
  const good = [
    line('静かな朝に光が差す', 'Shizuka na asa ni hikari ga sasu', 0),
    line('君の名前を呼んだ', 'Kimi no namae wo yonda', 1),
    line('夢を見てた', 'Yume wo miteta', 2),
    line('風が吹いてる', 'Kaze ga fuiteru', 3)
  ]

  it('keeps romaji that matches', async () => expect(await checkPairedRomaji(good)).toBe(good))

  it('replaces romaji that slipped onto the wrong line', async () => {
    const lines = [...good, line('明日も会おうよ', 'Kaze ga fuiteru', 4)]
    const out = await checkPairedRomaji(lines)
    expect(out.slice(0, 4).map((l) => l.sub)).toEqual(good.map((l) => l.sub))
    expect(out[4]!.sub).toBe('Ashita mo aou yo')
  })

  it('leaves translations alone', async () => {
    const lines = [line('静かな朝に光が差す', 'Light falls on a quiet morning', 0), line('君の名前を呼んだ', 'I called your name', 1), line('夢を見てた', 'I was dreaming', 2)]
    expect(await checkPairedRomaji(lines)).toBe(lines)
  })
})
