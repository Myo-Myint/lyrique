import { describe, expect, it } from 'vitest'
import { enabledSources, preference, sourceIdOf, sourceOrder } from '../src/shared/sources'

describe('lyrics sources', () => {
  it('fills in missing or unknown entries in the default order', () => {
    expect(sourceOrder(undefined).map((s) => s.id)).toEqual(['youtube', 'lrclib', 'qq'])
    expect(sourceOrder([{ id: 'qq', on: false }, { id: 'bogus' as never, on: true }, { id: 'qq', on: true }])).toEqual([
      { id: 'qq', on: false },
      { id: 'youtube', on: true },
      { id: 'lrclib', on: true }
    ])
  })
  it('lists the switched-on sources in your order', () =>
    expect(enabledSources([{ id: 'lrclib', on: true }, { id: 'youtube', on: true }, { id: 'qq', on: false }])).toEqual(['lrclib', 'youtube']))
  it('reads the source from a lyrics label', () => {
    expect(sourceIdOf('LRCLIB · word-synced')).toBe('lrclib')
    expect(sourceIdOf('lrclib · chosen')).toBe('lrclib')
    expect(sourceIdOf('YouTube Music')).toBe('youtube')
    expect(sourceIdOf('QQ Music · chosen')).toBe('qq')
    expect(sourceIdOf('Synced by you')).toBeNull()
  })
  it('prefers the source higher in the list', () => {
    const order = enabledSources([{ id: 'lrclib', on: true }, { id: 'youtube', on: true }, { id: 'qq', on: true }])
    expect(preference('LRCLIB', order)).toBeGreaterThan(preference('YouTube Music', order))
    expect(preference('YouTube Music', order)).toBeGreaterThan(preference('QQ Music', order))
  })
})
