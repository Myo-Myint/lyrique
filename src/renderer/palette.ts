/**
 * Tiny album-art palette extractor: downsample to a 24×24 canvas, bucket the pixels,
 * and pick three colours — one vivid, one deep, one contrasting — for the background.
 * Works on data: URLs so the canvas is never tainted.
 */
export interface Palette {
  c1: string
  c2: string
  c3: string
}

interface Bucket {
  r: number
  g: number
  b: number
  n: number
  sat: number
  lum: number
  hue: number
}

export async function extractPalette(src: string): Promise<Palette | null> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  const buckets = new Map<number, Bucket>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5) // 3 bits per channel
    const [h, s, l] = rgbToHsl(r, g, b)
    const bk = buckets.get(key)
    if (bk) {
      bk.r += r
      bk.g += g
      bk.b += b
      bk.n++
      bk.sat += s
      bk.lum += l
      bk.hue += h
    } else buckets.set(key, { r, g, b, n: 1, sat: s, lum: l, hue: h })
  }
  const list = [...buckets.values()].map((b) => ({
    r: b.r / b.n,
    g: b.g / b.n,
    b: b.b / b.n,
    n: b.n,
    sat: b.sat / b.n,
    lum: b.lum / b.n,
    hue: b.hue / b.n
  }))
  if (!list.length) return null

  // Vivid: saturated, mid-lightness, reasonably common.
  const vivid = best(list, (c) => c.sat * 2 + (1 - Math.abs(c.lum - 0.5)) + Math.log1p(c.n) * 0.15)
  // Deep: dominant & darker — the "floor" of the gradient.
  const deep = best(
    list.filter((c) => c !== vivid),
    (c) => Math.log1p(c.n) * 0.5 + (1 - c.lum) * 0.8 + c.sat * 0.4
  )
  // Contrast: far in hue from vivid, still saturated.
  const contrast = best(
    list.filter((c) => c !== vivid && c !== deep),
    (c) => hueDistance(c.hue, vivid.hue) * 1.2 + c.sat + (1 - Math.abs(c.lum - 0.45)) * 0.5
  )

  return {
    c1: tune(vivid, 0.55, 0.42),
    c2: tune(deep ?? vivid, 0.5, 0.3),
    c3: tune(contrast ?? vivid, 0.6, 0.4)
  }
}

function best<T extends object>(arr: T[], score: (t: T) => number): T {
  let b = arr[0] as T
  let bs = -Infinity
  for (const x of arr) {
    const s = score(x)
    if (s > bs) {
      bs = s
      b = x
    }
  }
  return b
}

/** Nudge a colour toward a target saturation/lightness so backgrounds stay rich but dark. */
function tune(c: { hue: number; sat: number; lum: number }, minSat: number, targetLum: number): string {
  const s = Math.max(c.sat, minSat)
  const l = Math.min(Math.max(c.lum, targetLum - 0.1), targetLum + 0.08)
  return `hsl(${Math.round(c.hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d) * 2 // 0..1
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}
