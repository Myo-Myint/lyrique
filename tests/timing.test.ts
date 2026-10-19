import { describe, expect, it } from 'vitest'
import { estimateWords, syllables, tokenize } from '../src/shared/estimate'
import { PlaybackClock } from '../src/renderer/clock'
import { estimateOffset, sungSpans } from '../src/shared/autosync'
import { looksFakeSynced, stripCredits } from '../src/shared/lrc'

describe('syllables', () => {
  it('counts vowel groups with silent trailing e', () => {
    expect(syllables('time')).toBe(1)
    expect(syllables('little')).toBe(2)
    expect(syllables('beautiful ')).toBe(3)
    expect(syllables('I')).toBe(1)
    expect(syllables('rhythm')).toBe(1)
  })
  it('treats CJK characters as one syllable each', () => {
    expect(tokenize('君の名は')).toHaveLength(4)
    expect(syllables('君')).toBe(1)
  })
})

describe('estimateWords', () => {
  it('stays inside the line, in order, with a floor per word', () => {
    const words = estimateWords({ text: 'I know you were the one for me', startMs: 10_000, endMs: 14_000 })
    expect(words.map((w) => w.text).join('')).toBe('I know you were the one for me')
    for (let i = 0; i < words.length; i++) {
      expect(words[i]!.endMs - words[i]!.startMs).toBeGreaterThanOrEqual(140)
      if (i) expect(words[i]!.startMs).toBeGreaterThanOrEqual(words[i - 1]!.endMs - 1)
    }
    expect(words.at(-1)!.endMs).toBeLessThanOrEqual(14_000)
  })
  it('does not stretch a short line across a long gap', () => {
    const words = estimateWords({ text: 'Oh no', startMs: 0, endMs: 20_000 })
    // ~2 syllables × 400 ms sung, last word holds ≤1.8 s
    expect(words[1]!.startMs).toBeLessThan(1_000)
    expect(words[1]!.endMs).toBeLessThanOrEqual(words[1]!.startMs + 1_800)
  })
  it('weights longer words more', () => {
    const [a, b] = estimateWords({ text: 'go everywhere', startMs: 0, endMs: 3_000 })
    expect(b!.endMs - b!.startMs).toBeGreaterThan(a!.endMs - a!.startMs)
  })
})

describe('PlaybackClock', () => {
  const s = (position: number, playing = true, sentAt = 0) => ({ position, playing, rate: 1, duration: 300, sentAt })

  it('extrapolates between samples', () => {
    const c = new PlaybackClock()
    c.sample(s(10), 1000, 0)
    expect(c.now(1500)).toBeCloseTo(10.5, 3)
  })
  it('blends small drift instead of jumping, and never goes backwards', () => {
    const c = new PlaybackClock()
    c.sample(s(10), 1000, 0)
    const before = c.now(1250) // 10.25
    expect(c.sample(s(10.21), 1250, 0)).toBe(false) // 40 ms behind → slew, not snap
    expect(c.now(1251)).toBeGreaterThanOrEqual(before)
    expect(c.now(1600)).toBeCloseTo(10.21 + 0.35, 2)
  })
  it('snaps on seeks', () => {
    const c = new PlaybackClock()
    c.sample(s(10), 1000, 0)
    expect(c.sample(s(60), 1250, 0)).toBe(true)
    expect(c.now(1250)).toBeCloseTo(60, 3)
    expect(c.sample(s(30), 1500, 0)).toBe(true)
    expect(c.now(1500)).toBeCloseTo(30, 3)
  })
  it('holds while paused and compensates transit while playing', () => {
    const c = new PlaybackClock()
    c.sample(s(10, false), 1000, 0)
    expect(c.now(5000)).toBe(10)
    c.sample(s(10, true, 0), 6000, 100) // arrived 100 ms after it was sampled
    expect(c.now(6000)).toBeCloseTo(10.1, 3)
  })
})

describe('estimateOffset', () => {
  // Deterministic pseudo-random noise.
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

  const lines = Array.from({ length: 14 }, (_, i) => ({
    text: 'some words to sing along here',
    startMs: 12_000 + i * 4_000,
    endMs: 12_000 + (i + 1) * 4_000
  }))

  function synth(trueOffsetMs: number, vocals = true) {
    const spans = sungSpans(lines).map(([a, b]) => [a + trueOffsetMs, b + trueOffsetMs] as const)
    const frames = []
    for (let ms = 0; ms < 70_000; ms += 20) {
      const singing = vocals && spans.some(([a, b]) => ms >= a && ms <= b)
      const beat = ms % 500 < 60 ? 1 : 0 // drums: centre, noisy, every beat
      frames.push({
        t: ms / 1000,
        mid: -4 + (singing ? 0.8 : 0) + beat * 0.6 + (rnd() - 0.5) * 0.6,
        side: -4.3 + (rnd() - 0.5) * 0.6,
        flat: 0.3 + beat * 0.4 - (singing ? 0.15 : 0) + (rnd() - 0.5) * 0.1
      })
    }
    return frames
  }

  it('recovers a known offset', () => {
    for (const off of [-1100, 0, 700]) {
      const r = estimateOffset(synth(off), lines)!
      expect(r.confident).toBe(true)
      expect(Math.abs(r.offsetMs - off)).toBeLessThanOrEqual(80)
    }
  })
  it('declines when there is no singing to match', () => {
    const r = estimateOffset(synth(0, false), lines)
    expect(r?.confident ?? false).toBe(false)
  })
})

describe('stripCredits', () => {
  it('drops leading title and credit lines only', () => {
    const mk = (text: string, startMs: number) => ({ text, startMs, endMs: startMs + 1000 })
    const out = stripCredits([
      mk('Song Name - Some Artist', 500),
      mk('Composed by：Someone', 1800),
      mk('Produced by：Someone/Else', 2600),
      mk('first sung line', 26000),
      mk('Stop: a line that happens to have a colon', 30000)
    ])
    expect(out.map((l) => l.text)).toEqual(['first sung line', 'Stop: a line that happens to have a colon'])
  })
})

describe('looksFakeSynced', () => {
  const lines = (starts: number[]) => starts.map((t) => ({ text: 'words here', startMs: t, endMs: t + 1000 }))
  it('flags evenly spaced uploads', () => {
    expect(looksFakeSynced(lines(Array.from({ length: 30 }, (_, i) => i * 5200)))).toBe(true)
  })
  it('accepts real singing rhythm', () => {
    expect(looksFakeSynced(lines([17140, 21340, 25640, 29810, 34100, 37890, 42180, 46520, 50940, 55020, 58300]))).toBe(false)
  })
})

describe('looksFakeSynced (grid)', () => {
  it('flags timings snapped to a 200 ms grid', () => {
    const gaps = [5200, 5200, 5400, 6800, 5800, 5600, 3400, 3600, 7200, 4200, 4800, 6800]
    const starts = gaps.reduce((acc, g) => [...acc, acc[acc.length - 1]! + g], [0])
    expect(looksFakeSynced(starts.map((t) => ({ text: 'words', startMs: t, endMs: t + 1000 })))).toBe(true)
  })
})

describe('lineAt / clip (menu bar)', async () => {
  const { lineAt, clip } = await import('../src/shared/nowline')
  const lines = [
    { text: 'First line here', startMs: 1000, endMs: 4000 },
    { text: '', startMs: 4000, endMs: 20000 },
    { text: 'After the break', startMs: 20000, endMs: 24000 }
  ]
  it('follows the singing and blanks intros and long gaps', () => {
    expect(lineAt(lines, 500)).toBeNull()
    expect(lineAt(lines, 1500)?.text).toBe('First line here')
    expect(lineAt(lines, 12000)).toBeNull()
    expect(lineAt(lines, 20500)?.text).toBe('After the break')
  })
  it('clips on a word boundary', () => {
    expect(clip('Short', 40)).toBe('Short')
    expect(clip('I believed you more than anything I have ever heard', 30)).toBe('I believed you more than…')
  })
})

describe('PlaybackClock.expect (pressing play/pause)', () => {
  it('freezes at once and ignores stale "still playing" samples until the player agrees', () => {
    const c = new PlaybackClock()
    const wall = 1_000_000
    c.sample({ position: 10, playing: true, rate: 1, duration: 200, sentAt: wall }, 0, wall)
    c.expect(false, 500)
    expect(c.isPlaying).toBe(false)
    const frozen = c.now(500)
    expect(frozen).toBeCloseTo(10.5, 2)
    // A sample taken before the pause landed: ignored, lyrics stay put.
    c.sample({ position: 10.7, playing: true, rate: 1, duration: 200, sentAt: wall + 700 }, 700, wall + 700)
    expect(c.isPlaying).toBe(false)
    expect(c.now(900)).toBeCloseTo(frozen, 3)
    // The player confirms the pause: its position is taken as the truth.
    c.sample({ position: 10.6, playing: false, rate: 1, duration: 200, sentAt: wall + 900 }, 900, wall + 900)
    expect(c.now(1000)).toBeCloseTo(10.6, 3)
  })
})
