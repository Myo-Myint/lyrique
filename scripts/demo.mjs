// Records the landing-page demo: the big-screen layout playing word-synced lyrics (written
// for the demo), then cover mode. Frames are grabbed in the main process with timestamps;
// ffmpeg turns them into a video. Usage: node scripts/demo.mjs <outDir>  → frames/ + frames.txt
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'demo')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999
const size = { width: 1600, height: 1000 }

const art = readFileSync(join(here, 'smoke-art.jpg'))
const artServer = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(art))
await new Promise((r) => artServer.listen(0, '127.0.0.1', r))
const artUrl = `http://127.0.0.1:${artServer.address().port}/art=w60-h60-l90-rj`

const profile = mkdtempSync(join(tmpdir(), 'lyrique-demo-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true }))
const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js')],
  env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en' }
})
const win = await app.firstWindow()
// A real window size (not viewport emulation), so frame grabs see the whole layout.
await app.evaluate(({ BrowserWindow }, { width, height }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setContentSize(width, height)
  w.center()
}, size)
await sleep(600)

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://demo' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
const send = (o) => ws.send(JSON.stringify(o))
const base = { type: 'state', videoId: 'demo', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 190, playing: true, rate: 1, artwork: artUrl, videoType: 'ATV', isAd: false, bridge: 2 }
const t0 = Date.now()
const START = 7.2
const at = () => send({ ...base, position: START + (Date.now() - t0) / 1000, sentAt: Date.now() })
at()
const ticker = setInterval(at, 250)
// Let the app's own lyrics lookup for this made-up song finish (and miss) first.
await sleep(5200)

// Word-synced lines, words weighted by length so the wipe looks sung, not metronomic.
const mk = (startMs, text, durMs = 3300) => {
  const parts = text.split(' ')
  const weight = parts.map((p) => 1 + p.length * 0.35)
  const total = weight.reduce((a, b) => a + b, 0)
  let t = startMs
  const words = parts.map((p, i) => {
    const d = (durMs * weight[i]) / total
    const w = { text: i < parts.length - 1 ? p + ' ' : p, startMs: Math.round(t), endMs: Math.round(t + d) }
    t += d
    return w
  })
  return { text, startMs, endMs: startMs + durMs + 200, words }
}
const lines = [
  mk(10000, 'Streetlights hum a little lower tonight'),
  mk(13600, 'Glass in the orchard, light through the leaves'),
  mk(17200, 'Every apple holds a sun it never sees'),
  mk(20800, 'You said forever like you meant the word'),
  mk(24400, 'I believed you more than anything I heard'),
  mk(28000, 'Ember, ember, hold me till the morning'),
  mk(31600, 'Burn a little slower, give me warning')
]
await app.evaluate(({ BrowserWindow }, lines) => {
  BrowserWindow.getAllWindows()[0].webContents.send('track:lyrics', {
    videoId: 'demo',
    lyrics: { kind: 'synced', source: 'LRCLIB · word-synced', lines, plain: '', wordSynced: true, matched: { title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 190 } }
  })
}, lines)
await sleep(1500)
const frames = join(outDir, 'frames')
mkdirSync(frames, { recursive: true })
await app.evaluate(({ BrowserWindow }, dir) => {
  const fs = process.mainModule.require('node:fs')
  const w = BrowserWindow.getAllWindows()[0]
  const log = []
  let n = 0
  let stop = false
  globalThis.__demo = { log, stop: () => (stop = true) }
  const grab = async () => {
    if (stop) return
    const t = Date.now()
    const img = await w.webContents.capturePage()
    const name = `f${String(n++).padStart(5, '0')}.jpg`
    fs.writeFileSync(`${dir}/${name}`, img.resize({ width: 1600 }).toJPEG(88))
    log.push([name, t])
    setTimeout(grab, Math.max(0, 33 - (Date.now() - t)))
  }
  void grab()
}, frames)
await sleep(8500)
await win.keyboard.press('c')
await sleep(6000)
const log = await app.evaluate(() => {
  globalThis.__demo.stop()
  return globalThis.__demo.log
})
// ffmpeg concat list with each frame's real duration.
const list = log.map(([name, t], i) => `file 'frames/${name}'\nduration ${(((log[i + 1]?.[1] ?? t + 33) - t) / 1000).toFixed(3)}`).join('\n')
writeFileSync(join(outDir, 'frames.txt'), `${list}\nfile 'frames/${log.at(-1)[0]}'\n`)
console.log(`${log.length} frames over ${((log.at(-1)[1] - log[0][1]) / 1000).toFixed(1)} s`)
clearInterval(ticker)
ws.close()
artServer.close()
await app.close()
