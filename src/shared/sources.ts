/**
 * Where lyrics come from, in the order you prefer. Lyrique still shows the best-timed lyrics
 * it finds (word-synced beats line-synced beats plain); between equally good ones, the source
 * higher in your list wins. A source switched off is never asked.
 */
import type { LyricSourceId, Settings } from './types'

export const LYRIC_SOURCES: LyricSourceId[] = ['youtube', 'lrclib', 'qq']
export const SOURCE_NAME: Record<LyricSourceId, string> = { youtube: 'YouTube Music', lrclib: 'LRCLIB', qq: 'QQ Music' }

/** Every source once, in your order; sources added in a later version go last, switched on. */
export function sourceOrder(list: Settings['lyricSources'] | undefined): Settings['lyricSources'] {
  const out: Settings['lyricSources'] = []
  for (const s of Array.isArray(list) ? list : []) {
    if (LYRIC_SOURCES.includes(s?.id) && !out.some((o) => o.id === s.id)) out.push({ id: s.id, on: s.on !== false })
  }
  for (const id of LYRIC_SOURCES) if (!out.some((o) => o.id === id)) out.push({ id, on: true })
  return out
}

/** The switched-on sources, most preferred first. */
export const enabledSources = (list: Settings['lyricSources'] | undefined): LyricSourceId[] =>
  sourceOrder(list)
    .filter((s) => s.on)
    .map((s) => s.id)

/** Which source a lyrics `source` label ('LRCLIB · word-synced', 'lrclib · chosen', …) came from. */
export function sourceIdOf(label: string): LyricSourceId | null {
  if (/^youtube/i.test(label)) return 'youtube'
  if (/^lrclib/i.test(label)) return 'lrclib'
  if (/^qq/i.test(label)) return 'qq'
  return null
}

/** Small tie-break for equally good lyrics: 0 for the last source, more the higher it is. */
export function preference(label: string, enabled: LyricSourceId[]): number {
  const i = enabled.indexOf(sourceIdOf(label)!)
  return i < 0 ? 0 : (enabled.length - i) * 0.05
}
