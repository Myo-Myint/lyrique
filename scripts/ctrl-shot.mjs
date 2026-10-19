// Screenshot of the window layout with a song playing (checks the playback pill).
// Usage: node scripts/ctrl-shot.mjs <out.png>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999
const profile = mkdtempSync(join(tmpdir(), 'lyrique-ctrl-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true }))
const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js')],
  env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en' }
})
const win = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 640))
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://shot' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
const t0 = Date.now()
const state = () => ws.send(JSON.stringify({ type: 'state', videoId: 'shot', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 190, playing: true, rate: 1, artwork: '', videoType: 'ATV', isAd: false, bridge: 2, position: 20 + (Date.now() - t0) / 1000, sentAt: Date.now() }))
state()
const tick = setInterval(state, 250)
await sleep(5000)
const lines = ['Streetlights hum a little lower tonight', 'Glass in the orchard, light through the leaves', 'Every apple holds a sun it never sees', 'You said forever like you meant the word'].map((text, i) => ({ text, startMs: 16000 + i * 3500, endMs: 19400 + i * 3500 }))
await app.evaluate(({ BrowserWindow }, lines) => BrowserWindow.getAllWindows()[0].webContents.send('track:lyrics', { videoId: 'shot', lyrics: { kind: 'synced', source: 'LRCLIB', lines, plain: '', matched: { title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 190 } } }), lines)
await win.mouse.move(400, 300)
await sleep(1200)
await win.screenshot({ path: process.argv[2] ?? 'ctrl.png' })
clearInterval(tick)
ws.close()
await app.close()
