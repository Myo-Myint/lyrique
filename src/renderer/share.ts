/**
 * A lyric card to share: the line set large over the song's blurred artwork, with the
 * title and artist. 1080×1350 (4:5) fits Instagram, iMessage and most feeds uncropped.
 */
export interface ShareInput {
  text: string
  sub: string | null
  title: string
  artist: string
  art: HTMLImageElement | null
  font: string
}

const W = 1080
const H = 1350
const PAD = 96

export async function renderShareCard(o: ShareInput): Promise<string> {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const css = getComputedStyle(document.documentElement)
  const color = (v: string, d: string) => css.getPropertyValue(v).trim() || d

  const grad = g.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, color('--c1', '#5a4a8a'))
  grad.addColorStop(0.55, color('--c2', '#2a6a7a'))
  grad.addColorStop(1, color('--c3', '#8a3a5a'))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  const art = o.art?.complete && o.art.naturalWidth ? o.art : null
  if (art) {
    g.save()
    g.filter = 'blur(80px) saturate(1.7) brightness(0.6)'
    const s = Math.max(W / art.naturalWidth, H / art.naturalHeight) * 1.35
    const w = art.naturalWidth * s
    const h = art.naturalHeight * s
    g.drawImage(art, (W - w) / 2, (H - h) / 2, w, h)
    g.restore()
  }
  const shade = g.createLinearGradient(0, 0, 0, H)
  shade.addColorStop(0, 'rgba(0,0,0,0.12)')
  shade.addColorStop(1, 'rgba(0,0,0,0.42)')
  g.fillStyle = shade
  g.fillRect(0, 0, W, H)

  // Header: artwork thumbnail, title, artist.
  const thumb = 132
  let textX = PAD
  if (art) {
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.35)'
    g.shadowBlur = 30
    g.shadowOffsetY = 10
    roundRect(g, PAD, PAD, thumb, thumb, 18)
    g.fillStyle = '#000'
    g.fill()
    g.restore()
    g.save()
    roundRect(g, PAD, PAD, thumb, thumb, 18)
    g.clip()
    const s = Math.max(thumb / art.naturalWidth, thumb / art.naturalHeight)
    g.drawImage(art, PAD + (thumb - art.naturalWidth * s) / 2, PAD + (thumb - art.naturalHeight * s) / 2, art.naturalWidth * s, art.naturalHeight * s)
    g.restore()
    textX = PAD + thumb + 32
  }
  const headW = W - textX - PAD
  g.textBaseline = 'alphabetic'
  g.fillStyle = '#fff'
  g.font = `700 40px ${o.font}`
  g.fillText(ellipsize(g, o.title, headW), textX, PAD + 58)
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.font = `500 32px ${o.font}`
  g.fillText(ellipsize(g, o.artist, headW), textX, PAD + 106)

  // The lyric: as large as fits in up to six lines.
  const maxW = W - PAD * 2
  let size = 96
  let lines: string[] = []
  for (; size >= 48; size -= 4) {
    g.font = `800 ${size}px ${o.font}`
    lines = wrap(g, o.text, maxW)
    if (lines.length <= 6) break
  }
  const lh = size * 1.16
  let subLines: string[] = []
  const subSize = Math.round(Math.max(30, size * 0.42))
  if (o.sub) {
    g.font = `500 ${subSize}px ${o.font}`
    subLines = wrap(g, o.sub, maxW).slice(0, 4)
  }
  const subLh = subSize * 1.3
  const blockH = lines.length * lh + (subLines.length ? 28 + subLines.length * subLh : 0)
  const top = PAD + thumb + Math.max(60, (H - PAD * 2 - thumb - 80 - blockH) / 2)
  g.fillStyle = '#fff'
  g.font = `800 ${size}px ${o.font}`
  lines.forEach((l, i) => g.fillText(l, PAD, top + size + i * lh))
  if (subLines.length) {
    g.fillStyle = 'rgba(255,255,255,0.72)'
    g.font = `500 ${subSize}px ${o.font}`
    const y0 = top + lines.length * lh + 28
    subLines.forEach((l, i) => g.fillText(l, PAD, y0 + subSize + i * subLh))
  }

  // Footer mark.
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.font = `600 28px ${o.font}`
  g.fillText('Lyrique', PAD, H - PAD + 10)
  return c.toDataURL('image/png')
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

function ellipsize(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s
  let t = s
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Word wrap; scripts without spaces (CJK) break between characters. */
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const tokens = text.match(/\S+\s*|\s+/g) ?? []
  const out: string[] = []
  let cur = ''
  const push = () => {
    if (cur.trim()) out.push(cur.trimEnd())
    cur = ''
  }
  for (const tok of tokens) {
    if (g.measureText(cur + tok).width <= max) {
      cur += tok
      continue
    }
    if (g.measureText(tok).width <= max) {
      push()
      cur = tok.trimStart()
      continue
    }
    for (const ch of tok) {
      if (g.measureText(cur + ch).width > max) push()
      cur += ch
    }
  }
  push()
  return out
}
