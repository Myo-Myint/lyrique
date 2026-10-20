// Renders every icon from build/icon.svg (the master artwork) with Chrome:
// the macOS app icon (standard 824 px body with shadow), the Windows icon (full square),
// the browser extension icons, the website icon and the menu bar template icons.
// Usage: node scripts/make-icons.mjs   (needs Google Chrome installed)
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const master = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const art = `data:image/svg+xml;base64,${Buffer.from(master).toString('base64')}`

// macOS: content on the 1024 grid is an 824 px rounded square, inset 100 px, with a soft shadow.
const mac = `<div style="width:1024px;height:1024px;display:grid;place-items:center">
  <img src="${art}" style="width:824px;height:824px;border-radius:185px;box-shadow:0 12px 24px rgba(0,0,0,.28)"></div>`
// Windows, extension, website: the artwork filling the square, with gently rounded corners.
const square = (size) => `<img src="${art}" style="display:block;width:${size}px;height:${size}px;border-radius:${size * 0.225}px">`
// Menu bar template (macOS tints it): the same two lines in black with alpha.
const tray = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">
  <rect x="1" y="3.6" width="14" height="3.4" rx="1.7" fill="#000" fill-opacity="0.42" />
  <rect x="1" y="3.6" width="9.4" height="3.4" rx="1.7" fill="#000" />
  <rect x="1" y="9.2" width="10" height="2.9" rx="1.45" fill="#000" fill-opacity="0.42" />
</svg>`

const outputs = [
  [mac, 1024, 'build/icon.png'],
  [square(1024), 1024, 'build/icon-win.png'],
  [square(512), 512, 'site/icon.png'],
  [square(128), 128, 'extension/icons/icon128.png'],
  [square(48), 48, 'extension/icons/icon48.png'],
  [square(16), 16, 'extension/icons/icon16.png'],
  [tray(16), 16, 'build/trayTemplate.png'],
  [tray(32), 32, 'build/trayTemplate@2x.png']
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const [html, size, out] of outputs) {
  // A fresh page per size: resizing one page can leave stale tiles in the capture.
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: size, height: size } })
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`)
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
  mkdirSync(dirname(join(root, out)), { recursive: true })
  await page.screenshot({ path: join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  console.log(out)
}
await browser.close()
