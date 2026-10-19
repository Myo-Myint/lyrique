// Screens in each interface language, to catch overflow and missing text.
// Usage: node scripts/i18n-shots.mjs <outDir> <lang> [<lang>…]
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [outDir, ...langs] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const lang of langs) {
  const profile = mkdtempSync(join(tmpdir(), 'lyrique-i18n-'))
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, shortcutTipShown: true, seenVersion: '0.4.4', players: { spotify: false, music: false } }))
  const app = await electron.launch({
    args: [join(here, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, LYRIQUE_PORT: '41999', LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: lang, LYRIQUE_WHATSNEW: '1' }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'floating')
    w.setContentSize(560, 760)
    w.moveTop()
  })
  const grab = (name) =>
    app.evaluate(async ({ BrowserWindow }, path) => {
      const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
      process.mainModule.require('node:fs').writeFileSync(path, img.toJPEG(85))
    }, join(outDir, `${lang}-${name}.jpg`))
  await sleep(2500)
  await grab('whatsnew')
  await win.keyboard.press('Escape')
  await sleep(300)
  await grab('empty')
  await win.keyboard.press('Meta+Comma')
  await sleep(600)
  await grab('settings')
  await win.evaluate(() => (document.getElementById('st-body').scrollTop = 99999))
  await sleep(200)
  await grab('settings-end')
  await win.keyboard.press('Escape')
  await win.keyboard.press('Shift+Slash')
  await sleep(400)
  await grab('keys')
  await win.keyboard.press('Escape')
  await win.evaluate(() => window.lyrique.showSetup())
  await sleep(600)
  await grab('setup')
  // Text wider than its box anywhere on the page (buttons and labels that don't wrap).
  const over = await win.evaluate(() =>
    [...document.querySelectorAll('button, .st-label, .chip')]
      .filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 2)
      .map((e) => e.textContent.trim().slice(0, 40))
  )
  const menu = await app.evaluate(() => 0)
  console.log(lang, 'html lang:', await win.evaluate(() => document.documentElement.lang), '· overflowing:', over.length ? over.join(' | ') : 'none')
  await app.close()
}
