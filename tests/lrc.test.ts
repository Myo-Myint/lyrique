import { describe, expect, it } from 'vitest'
import { activeLineIndex, cleanArtist, cleanTitle, fromLyricsfile, parseLrc, similarity, mergeSameTime } from '../src/shared/lrc'

describe('parseLrc', () => {
  it('parses standard LRC, pads fractions and infers end times', () => {
    const lines = parseLrc(`[ti:Song]\n[00:01.5]First\n[00:03.05]Second\n[00:10.123]Third`, 20_000)
    expect(lines.map((l) => l.startMs)).toEqual([1500, 3050, 10123])
    expect(lines.map((l) => l.endMs)).toEqual([3050, 10123, 20000])
    expect(lines[0]!.text).toBe('First')
  })

  it('expands multiple timestamps on one line and sorts', () => {
    const lines = parseLrc(`[00:20.00][00:05.00]Chorus\n[00:10.00]Verse`)
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [5000, 'Chorus'],
      [10000, 'Verse'],
      [20000, 'Chorus']
    ])
  })

  it('applies [offset:] (positive = earlier)', () => {
    const lines = parseLrc(`[offset:+500]\n[00:02.00]A`)
    expect(lines[0]!.startMs).toBe(1500)
  })

  it('keeps empty timestamped lines as instrumental markers', () => {
    const lines = parseLrc(`[00:01.00]A\n[00:05.00]\n[00:30.00]B`)
    expect(lines).toHaveLength(3)
    expect(lines[1]!.text).toBe('')
  })

  it('treats a lone ♪ (LRCLIB style) as an instrumental marker', () => {
    const lines = parseLrc(`[00:13.13] A line\n[00:16.56] ♪\n[00:20.00] B`)
    expect(lines.map((l) => l.text)).toEqual(['A line', '', 'B'])
  })

  it('parses enhanced LRC word timings', () => {
    const lines = parseLrc(`[00:10.00]<00:10.00>Hello <00:10.50>wide <00:11.00>world`)
    const l = lines[0]!
    expect(l.text).toBe('Hello wide world')
    expect(l.words?.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ['Hello ', 10000, 10500],
      ['wide ', 10500, 11000],
      ['world', 11000, 11500]
    ])
  })

  it('handles CJK text without spaces', () => {
    const lines = parseLrc(`[00:01.00]夜に駆ける`)
    expect(lines[0]!.text).toBe('夜に駆ける')
  })
})

describe('fromLyricsfile', () => {
  it('maps lines and words with offset_ms', () => {
    const doc = {
      version: '1.0',
      metadata: { title: 'T', artist: 'A', offset_ms: 100 },
      lines: [
        { text: 'Hello world', start_ms: 1000, end_ms: 2000, words: [{ text: 'Hello ', start_ms: 1000, end_ms: 1400 }, { text: 'world', start_ms: 1400 }] },
        { text: 'Bye', start_ms: 3000 }
      ],
      plain: 'Hello world\nBye'
    }
    const r = fromLyricsfile(doc, 10_000)
    expect(r.lines[0]!.startMs).toBe(1100)
    expect(r.lines[0]!.words![1]!.endMs).toBe(2100) // inherits line end
    expect(r.lines[1]!.endMs).toBe(10_000)
    expect(r.plain).toContain('Bye')
  })
})

describe('activeLineIndex', () => {
  const lines = parseLrc(`[00:01.00]A\n[00:05.00]B\n[00:09.00]C`)
  it('finds the current line', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex(lines, 1000)).toBe(0)
    expect(activeLineIndex(lines, 6500)).toBe(1)
    expect(activeLineIndex(lines, 99_000)).toBe(2)
  })
})

describe('metadata cleaning', () => {
  it('strips video noise and features from titles', () => {
    expect(cleanTitle('Blinding Lights (Official Video)')).toBe('Blinding Lights')
    expect(cleanTitle('Levitating (feat. DaBaby)')).toBe('Levitating')
    expect(cleanTitle('Song Name - Official Music Video')).toBe('Song Name')
    expect(cleanTitle('Intro (Live at Wembley)')).toBe('Intro')
  })
  it('keeps the primary artist', () => {
    expect(cleanArtist('Dua Lipa - Topic')).toBe('Dua Lipa')
    expect(cleanArtist('Calvin Harris, Dua Lipa')).toBe('Calvin Harris')
    expect(cleanArtist('Silk Sonic & Bruno Mars')).toBe('Silk Sonic')
  })
  it('scores token similarity', () => {
    expect(similarity('Blinding Lights', 'blinding lights')).toBe(1)
    expect(similarity('Blinding Lights', 'Save Your Tears')).toBe(0)
    expect(similarity('Blinding Lights (Remix)', 'Blinding Lights')).toBeCloseTo(2 / 3)
  })
})

describe('same-timestamp pairs', () => {
  const lrc = [
    '[00:00.87]静かな朝に光が差す',
    '[00:00.87]Shizukana asa ni hikari ga sasu',
    '[00:03.78]遠い街の歌を聴いて',
    '[00:03.78]Tooi machi no uta wo kiite',
    "[00:14.76](Hold the light, carry it home)",
    "[00:14.76](Hold the light, carry it home)",
    '[00:17.52]また明日ね'
  ].join('\n')

  it('folds the second line into sub and drops exact duplicates', () => {
    const lines = parseLrc(lrc, 200_000)
    expect(lines.map((l) => [l.text, l.sub])).toEqual([
      ['静かな朝に光が差す', 'Shizukana asa ni hikari ga sasu'],
      ['遠い街の歌を聴いて', 'Tooi machi no uta wo kiite'],
      ["(Hold the light, carry it home)", undefined],
      ['また明日ね', undefined]
    ])
    // Each line now runs until the next one instead of lasting zero seconds.
    expect(lines[0]!.endMs).toBe(3780)
  })

  it('folds pairs in lyrics that were cached before this existed', () => {
    const cached = [
      { text: 'A', startMs: 870, endMs: 870 },
      { text: 'a', startMs: 870, endMs: 3780 },
      { text: 'B', startMs: 3780, endMs: 6000 }
    ]
    expect(mergeSameTime(cached)).toEqual([
      { text: 'A', startMs: 870, endMs: 3780 },
      { text: 'B', startMs: 3780, endMs: 6000 }
    ])
  })
})

describe('Spotify / Apple Music style titles', () => {
  it.each([
    ['Here Comes The Sun - Remastered 2009', 'Here Comes The Sun'],
    ['Song Name - 2015 Remaster', 'Song Name'],
    ['Levitating (feat. DaBaby)', 'Levitating'],
    ['Song - Radio Edit', 'Song'],
    ['Mr. Brightside', 'Mr. Brightside']
  ])('%s → %s', (raw, clean) => expect(cleanTitle(raw)).toBe(clean))
})

describe('titles with a dash that are part of the name', () => {
  it('keeps them', () => {
    expect(cleanTitle('Love - Hate')).toBe('Love - Hate')
    expect(cleanTitle('Song - Live at Wembley')).toBe('Song')
  })
})

describe('duet singer marks', () => {
  it('reads v1:/v2: marks, strips them and carries them over', () => {
    const lines = parseLrc('[00:01.00]v1: I sing first\n[00:03.00]still me\n[00:05.00]v2: Then me\n[00:07.00]v1:<00:07.00>Word <00:07.50>synced')
    expect(lines.map((l) => [l.text, l.singer])).toEqual([
      ['I sing first', 1],
      ['still me', 1],
      ['Then me', 2],
      ['Word synced', 1]
    ])
    expect(lines[3]!.words?.[0]!.text).toBe('Word ')
  })

  it('maps karaoke M:/F:/D: by who sings first', () => {
    const lines = parseLrc('[00:01.00]F: Hello\n[00:02.00]M: Hi\n[00:03.00]F: Again\n[00:04.00]D: Together')
    expect(lines.map((l) => [l.text, l.singer])).toEqual([
      ['Hello', 1],
      ['Hi', 2],
      ['Again', 1],
      ['Together', 3]
    ])
  })

  it('ignores marks that are not a duet', () => {
    const one = parseLrc('[00:01.00]v1: Solo\n[00:02.00]v1: Still solo')
    expect(one.map((l) => [l.text, l.singer])).toEqual([
      ['Solo', undefined],
      ['Still solo', undefined]
    ])
    // A lone "M: " is lyric text, not a mark.
    const text = parseLrc('[00:01.00]M: is for music\n[00:02.00]F: is for fun')
    expect(text.map((l) => l.text)).toEqual(['M: is for music', 'F: is for fun'])
  })

  it('treats two singers on one timestamp as together', () => {
    const lines = parseLrc('[00:01.00]v1: Mine\n[00:01.00]v2: Yours\n[00:03.00]v2: Solo')
    expect(lines.map((l) => [l.text, l.sub, l.singer])).toEqual([
      ['Mine', 'Yours', 3],
      ['Solo', undefined, 2]
    ])
  })
})
