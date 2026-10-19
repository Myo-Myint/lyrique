// Scripted check of duet layout, karaoke layout and reduce motion. Runs the built app on a
// throwaway profile with a duet already in the lyrics cache. Usage: node scripts/duet-karaoke.mjs <outDir>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'duet')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999

const profile = mkdtempSync(join(tmpdir(), 'lyrique-test-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, shortcutTipShown: true, players: { spotify: false, music: false } }))
mkdirSync(join(profile, 'lyrics-cache'))
// A duet written for this test: singer 1 left, singer 2 right, together in the middle.
const L = (text, s, e, singer) => ({ text, startMs: s * 1000, endMs: e * 1000, singer })
const lines = [
  L('Tell me where the river goes', 8, 11, 1),
  L('Down to where the lanterns glow', 11, 14, 2),
  L('Will you wait for me tonight', 14, 17, 1),
  L('(wait for me)', 17, 18, 2),
  L('Till the morning finds the light', 18, 21, 2),
  L('We were always meant to stay', 21, 24, 3),
  L('Hold on, hold on', 24, 27, 1)
]
writeFileSync(
  join(profile, 'lyrics-cache', 'test-duet.json'),
  JSON.stringify({ kind: 'synced', source: 'LRCLIB', lines, plain: '', wordSynced: false, matched: { title: 'River Lanterns', artist: 'Mara & Theo', album: '', duration: 200 } })
)

const app = await electron.launch({ args: [join(here, '..', 'out', 'main', 'index.js')], env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en' } })
const errors = []
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(String(e)))
await win.setViewportSize({ width: 620, height: 760 })

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://featuretest' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
const base = { type: 'state', videoId: 'test-duet', title: 'River Lanterns', artist: 'Mara & Theo', album: '', duration: 200, playing: true, rate: 1, artwork: '', videoType: 'ATV', isAd: false, bridge: 2 }
const t0 = Date.now()
const start = 12.2
const tick = () => ws.send(JSON.stringify({ ...base, position: start + (Date.now() - t0) / 1000, sentAt: Date.now() }))
tick()
const ticker = setInterval(tick, 250)
await sleep(2500)

const aligns = await win.evaluate(() =>
  [...document.querySelectorAll('#lines .line')].map((l) => `${l.className.match(/v\d/)?.[0] ?? '-'}:${getComputedStyle(l).textAlign}`)
)
console.log('duet class on list:', await win.evaluate(() => document.getElementById('lines').classList.contains('duet')))
console.log('alignment per line:', aligns.join(' '))
await win.screenshot({ path: join(outDir, '01-duet.png') })

// Karaoke layout (without taking over the real screen: the class alone, at TV-like size).
await win.setViewportSize({ width: 1280, height: 720 })
await win.evaluate(() => document.body.classList.add('karaoke'))
await sleep(1200)
const k = await win.evaluate(() => ({
  top: getComputedStyle(document.getElementById('top')).display,
  size: getComputedStyle(document.querySelector('.line.active')).fontSize,
  activeCenter: (() => {
    const r = document.querySelector('.line.active').getBoundingClientRect()
    return Math.round(r.top + r.height / 2)
  })()
}))
console.log('karaoke: header', k.top, '· active line font', k.size, '· active line centre y', k.activeCenter, 'of 720')
await win.screenshot({ path: join(outDir, '02-karaoke.png') })
await win.evaluate(() => document.body.classList.remove('karaoke'))
await win.setViewportSize({ width: 620, height: 760 })

// Reduce motion from the setting.
await win.evaluate(() => window.lyrique.patchSettings({ reduceMotion: true }))
await sleep(600)
const r = await win.evaluate(() => ({
  reduced: document.body.classList.contains('reduced'),
  lineTransform: getComputedStyle(document.querySelector('.line.future')).transform,
  blob: getComputedStyle(document.querySelector('.blob')).animationName
}))
console.log('reduce motion:', JSON.stringify(r))
await sleep(3500) // let a line change happen under the dissolve
await win.screenshot({ path: join(outDir, '03-reduced.png') })
await win.evaluate(() => window.lyrique.patchSettings({ reduceMotion: false }))
await sleep(400)
console.log('reduce motion off again:', !(await win.evaluate(() => document.body.classList.contains('reduced'))))

// The settings row and the shortcut guide entry.
await win.keyboard.press('Meta+Comma')
await sleep(500)
console.log('settings row:', await win.evaluate(() => [...document.querySelectorAll('.st-label')].some((l) => l.textContent === 'Reduce motion')))
await win.keyboard.press('Escape')
console.log('shortcut guide lists K:', await win.evaluate(() => document.getElementById('keys-list').textContent.includes('Karaoke')))

clearInterval(ticker)
ws.close()
await app.close()
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
