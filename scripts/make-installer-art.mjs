// Renders the Windows installer's sidebar (shown on the Finish page and in the uninstaller)
// from the brand artwork: build/installerSidebar.bmp, 164 × 314, 24-bit as NSIS requires.
// Usage: node scripts/make-installer-art.mjs   (needs Google Chrome installed)
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = 164
const H = 314

// The icon's gradient across the whole panel, with the "Now and next" lines and the name in white.
const html = `<div style="width:${W}px;height:${H}px;position:relative;overflow:hidden;
  background:linear-gradient(160deg,#ff7a3d 0%,#e5466b 50%,#3b5bdb 100%);
  font-family:-apple-system,'SF Pro Display',sans-serif;color:#fff">
  <svg width="84" height="40" viewBox="0 0 640 296" style="position:absolute;left:28px;top:44px">
    <rect x="0" y="0" width="640" height="128" rx="64" fill="#fff" fill-opacity="0.32" />
    <rect x="0" y="0" width="430" height="128" rx="64" fill="#fff" />
    <rect x="0" y="192" width="460" height="104" rx="52" fill="#fff" fill-opacity="0.32" />
  </svg>
  <div style="position:absolute;left:28px;top:98px;font-size:24px;font-weight:600;letter-spacing:-0.02em">Lyrique</div>
  <div style="position:absolute;left:28px;top:130px;width:112px;font-size:12px;line-height:1.4;opacity:.82">Lyrics that move with your music.</div>
</div>`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: W, height: H } })
await page.setContent(`<html><body style="margin:0">${html}</body></html>`)
const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } })
// Read the pixels back through a canvas, then write them as a bottom-up 24-bit BMP.
const rgba = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = `data:image/png;base64,${b64}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return Array.from(ctx.getImageData(0, 0, c.width, c.height).data)
}, png.toString('base64'))
await browser.close()

const row = Math.ceil((W * 3) / 4) * 4
const bmp = Buffer.alloc(54 + row * H)
bmp.write('BM', 0)
bmp.writeUInt32LE(bmp.length, 2)
bmp.writeUInt32LE(54, 10)
bmp.writeUInt32LE(40, 14)
bmp.writeInt32LE(W, 18)
bmp.writeInt32LE(H, 22)
bmp.writeUInt16LE(1, 26)
bmp.writeUInt16LE(24, 28)
bmp.writeUInt32LE(row * H, 34)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = ((H - 1 - y) * W + x) * 4
    const o = 54 + y * row + x * 3
    bmp[o] = rgba[i + 2]
    bmp[o + 1] = rgba[i + 1]
    bmp[o + 2] = rgba[i]
  }
}
writeFileSync(join(root, 'build', 'installerSidebar.bmp'), bmp)
console.log('build/installerSidebar.bmp')
