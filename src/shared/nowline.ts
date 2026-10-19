/**
 * Which lyric line is being sung at a moment, for places that show one line at a time
 * without the full renderer (the menu bar). Blank during intros and long instrumental gaps.
 */
import { estimateWords } from './estimate'
import type { Line } from './types'

/** Singing is over this long after a line's last word: show nothing until the next line. */
const GAP_AFTER_MS = 1200

const sungEnds = new WeakMap<Line[], number[]>()

function endsOf(lines: Line[]): number[] {
  let ends = sungEnds.get(lines)
  if (!ends) {
    ends = lines.map((l) => {
      const w = l.words?.length ? l.words : estimateWords(l)
      return w.length ? w[w.length - 1]!.endMs : l.endMs
    })
    sungEnds.set(lines, ends)
  }
  return ends
}

export function lineAt(lines: Line[], ms: number): Line | null {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startMs > ms) break
    if (lines[i]!.text.trim()) idx = i
  }
  if (idx < 0) return null
  return ms <= endsOf(lines)[idx]! + GAP_AFTER_MS ? lines[idx]! : null
}

/** Shorten for a status-bar title, on a word boundary where possible. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?—-]+$/, '')}…`
}
