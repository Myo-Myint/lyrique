// Measures Lyrique's CPU use while lyrics play: window visible, minimized, and hidden behind
// the mini bar. Uses Electron's own per-process metrics. Usage: node scripts/energy.mjs
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999
const SECONDS = Number(process.env.SECONDS ?? 12)

const profile = mkdtempSync(join(tmpdir(), 'lyrique-energy-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, shortcutTipShown: true, players: { spotify: false, music: false } }))
const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js')],
  env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en' }
})
const win = await app.firstWindow()
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://energy' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
const send = (o) => ws.send(JSON.stringify(o))
const base = { type: 'state', videoId: 'energy', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 400, playing: true, rate: 1, artwork: '', videoType: 'ATV', isAd: false, bridge: 2 }
const t0 = Date.now()
const tick = setInterval(() => send({ ...base, position: 5 + (Date.now() - t0) / 1000, sentAt: Date.now() }), 250)
// Let the app's own lookup for this made-up song finish (and miss), so ours stays on screen.
await win.waitForFunction(() => document.getElementById('empty-title')?.textContent?.startsWith('No lyrics'), null, { timeout: 30000 })
const lines = Array.from({ length: 100 }, (_, i) => {
  const startMs = 4000 + i * 3600
  const words = 'Every apple holds a sun it never sees'.split(' ').map((w, k, a) => ({ text: k < a.length - 1 ? w + ' ' : w, startMs: startMs + k * 400, endMs: startMs + (k + 1) * 400 }))
  return { text: words.map((w) => w.text).join(''), startMs, endMs: startMs + 3400, words }
})
await app.evaluate(({ BrowserWindow }, lines) => {
  BrowserWindow.getAllWindows()[0].webContents.send('track:lyrics', {
    videoId: 'energy',
    lyrics: { kind: 'synced', source: 'test', lines, plain: '', wordSynced: true, matched: { title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 400 } }
  })
}, lines)
await sleep(1500)

/** Average CPU % of all Lyrique processes over `SECONDS`. */
async function measure() {
  await app.evaluate(({ app }) => app.getAppMetrics()) // reset the per-process counters
  await sleep(SECONDS * 1000)
  const m = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage })))
  const total = m.reduce((a, p) => a + p.cpu, 0)
  const by = m.map((p) => `${p.type} ${p.cpu.toFixed(1)}`).join(', ')
  return `${total.toFixed(1)}% (${by})`
}
const resize = (fn) => app.evaluate(({ BrowserWindow }, fn) => BrowserWindow.getAllWindows()[0][fn](), fn)

console.log('visible   :', await measure())
await resize('minimize')
await sleep(1000)
console.log('minimized :', await measure())
await resize('restore')
await sleep(1000)
await resize('hide')
await sleep(1000)
console.log('hidden    :', await measure())
// Back on screen: the highlighted line must be the one being sung now, straight away.
await resize('show')
await sleep(300)
const pos = 5 + (Date.now() - t0) / 1000
const expected = lines.findLast((l) => l.startMs <= pos * 1000 + 40)
const shown = await win.evaluate(() => document.querySelector('.line.active')?.dataset.i)
console.log(`after showing again: line ${shown} highlighted, line ${lines.indexOf(expected)} being sung →`, Number(shown) === lines.indexOf(expected) ? 'OK' : 'WRONG')
clearInterval(tick)
ws.close()
await app.close()
