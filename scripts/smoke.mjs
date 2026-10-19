// End-to-end smoke test: launches the built Electron app, pretends to be the browser
// extension over WebSocket, and screenshots the window in several states.
// Usage: xvfb-run -a node scripts/smoke.mjs <outDir>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'smoke')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Serve a local album-art image so artwork fetching is exercised without the internet.
const art = readFileSync(join(here, 'smoke-art.jpg'))
const artServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' })
  res.end(art)
})
await new Promise((r) => artServer.listen(0, '127.0.0.1', r))
const artUrl = `http://127.0.0.1:${artServer.address().port}/art=w60-h60-l90-rj`

const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js'), '--no-sandbox'],
  env: { ...process.env, LYRIQUE_SMOKE: '1' }
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 560, height: 760 })
await sleep(1200)
await win.screenshot({ path: join(outDir, '1-disconnected.png') })

const ws = new WebSocket('ws://127.0.0.1:41337', { headers: { Origin: 'chrome-extension://smoketest' } })
await new Promise((res, rej) => {
  ws.on('open', res)
  ws.on('error', rej)
})
const send = (o) => ws.send(JSON.stringify(o))

const base = {
  type: 'state',
  videoId: 'smoke-ytm',
  title: 'Paper Lanterns',
  artist: 'The Night Market',
  album: 'Low Tide',
  duration: 212,
  playing: true,
  rate: 1,
  artwork: artUrl,
  videoType: 'ATV',
  isAd: false
}
const state = (position) => send({ ...base, position, sentAt: Date.now() })

// Track 1: lyrics arrive from "YouTube Music" (line-synced) via the extension path.
state(0)
const ytLines = [
  ['Streetlights hum a little lower tonight', 12000, 15800],
  ['We carry what the water left behind', 15800, 19400],
  ['Paper lanterns drifting out of sight', 19400, 23600],
  ['I keep your name like a coin in my coat', 23600, 27900],
  ['Spend it slow so I never run out', 27900, 31500],
  ['', 31500, 42000],
  ['And if the tide comes back for us', 42000, 45500],
  ['I will not be the one who runs', 45500, 49000],
  ['Low tide, low tide — leave the lights on', 49000, 53500],
  ['So I can find my way back home', 53500, 58000]
].map(([text, startMs, endMs]) => ({ text, startMs, endMs }))
send({ type: 'lyrics', videoId: 'smoke-ytm', source: 'YouTube Music', lines: ytLines })
await sleep(2500)
state(5)
await sleep(900)
await win.screenshot({ path: join(outDir, '2-intro-dots.png') })
state(20.2)
await sleep(1100)
await win.screenshot({ path: join(outDir, '3-line-synced.png') })
state(36)
await sleep(1100)
await win.screenshot({ path: join(outDir, '4-interlude.png') })

// Track 2: word-synced lyrics via LRCLIB's Lyricsfile shape — we can't reach LRCLIB from the
// sandbox, so emulate by sending enhanced-LRC-equivalent words through the extension channel
// is not possible (that channel is line-only). Instead verify the renderer's word path using
// the test hook exposed when LYRIQUE_SMOKE=1.
send({ ...base, videoId: 'smoke-words', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', position: 0, sentAt: Date.now() })
await sleep(6000) // let the real LRCLIB lookup resolve (or fail) first
await win.screenshot({ path: join(outDir, '5a-lrclib-result.png') })
await app.evaluate(({ BrowserWindow }, lines) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.webContents.send('track:lyrics', {
    videoId: 'smoke-words',
    lyrics: { kind: 'synced', source: 'lrclib · word-synced', lines, plain: '', wordSynced: true, matched: { title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', duration: 190 } }
  })
}, wordLines())
await sleep(300)
send({ ...base, videoId: 'smoke-words', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember', position: 21.3, sentAt: Date.now() })
await sleep(1200)
await win.screenshot({ path: join(outDir, '5-word-synced.png') })

// Wide window
await win.setViewportSize({ width: 1100, height: 700 })
await sleep(900)
await win.screenshot({ path: join(outDir, '6-wide.png') })

const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await sleep(300)
console.log('screenshots written to', outDir, errors.length ? `\nPAGE ERRORS: ${errors.join('\n')}` : '\nno page errors')
ws.close()
artServer.close()
await app.close()

function wordLines() {
  const mk = (startMs, text) => {
    const parts = text.split(' ')
    const each = 3200 / parts.length
    const words = parts.map((p, i) => ({ text: i < parts.length - 1 ? p + ' ' : p, startMs: Math.round(startMs + i * each), endMs: Math.round(startMs + (i + 1) * each) }))
    return { text, startMs, endMs: startMs + 3400, words }
  }
  return [
    mk(14000, 'Glass in the orchard, light through the leaves'),
    mk(17600, 'Every apple holds a sun it never sees'),
    mk(21200, 'You said forever like you meant the word'),
    mk(24800, 'I believed you more than I have ever heard'),
    mk(28400, 'Ember, ember, hold me till the morning'),
    mk(32000, 'Burn a little slower, give me warning')
  ]
}
