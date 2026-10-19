// Screenshots for the landing page: karaoke mode, a duet and Settings, from the real app
// with lyrics written for the page. Usage: node scripts/site-shots.mjs <outDir>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'site-shots')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999

const art = readFileSync(join(here, 'smoke-art.jpg'))
const artServer = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(art))
await new Promise((r) => artServer.listen(0, '127.0.0.1', r))
const artUrl = `http://127.0.0.1:${artServer.address().port}/art=w60-h60-l90-rj`

const profile = mkdtempSync(join(tmpdir(), 'lyrique-shots-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, shortcutTipShown: true, seenVersion: '9.9.9', players: { spotify: false, music: false } }))
const app = await electron.launch({ args: [join(here, '..', 'out', 'main', 'index.js')], env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en', LYRIQUE_WHATSNEW: process.env.SHOW_WHATSNEW ?? '' } })
const win = await app.firstWindow()
// On top, so macOS never treats it as covered and stops drawing (captures would be stale).
const resize = (width, height) =>
  app.evaluate(({ BrowserWindow }, { width, height }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'floating')
    w.setContentSize(width, height)
    w.center()
    w.moveTop()
  }, { width, height })
const grab = (name) =>
  app.evaluate(async ({ BrowserWindow }, path) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    process.mainModule.require('node:fs').writeFileSync(path, img.toJPEG(90))
  }, join(outDir, name))

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://shots' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
let ticker = null
async function play(meta, startSec, lines) {
  clearInterval(ticker)
  await win.evaluate(() => (document.getElementById('empty-title').textContent = ''))
  const base = { type: 'state', duration: 200, playing: true, rate: 1, artwork: artUrl, videoType: 'ATV', isAd: false, bridge: 2, ...meta }
  const t0 = Date.now()
  const tick = () => ws.send(JSON.stringify({ ...base, position: startSec + (Date.now() - t0) / 1000, sentAt: Date.now() }))
  tick()
  ticker = setInterval(tick, 250)
  // Let the app's own lookup for this made-up song finish (and miss) before showing ours.
  await win
    .waitForFunction((title) => document.getElementById('title')?.textContent === title && document.getElementById('empty-title')?.textContent?.includes('No lyrics'), meta.title, { timeout: 15000 })
    .catch(() => {})
  await app.evaluate(({ BrowserWindow }, { videoId, lines, meta }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('track:lyrics', {
      videoId,
      lyrics: { kind: 'synced', source: 'LRCLIB · word-synced', lines, plain: '', wordSynced: true, matched: { title: meta.title, artist: meta.artist, album: '', duration: 200 } }
    })
  }, { videoId: meta.videoId, lines, meta })
}

// Word timings weighted by length, so the wipe looks sung.
const mk = (startMs, text, durMs = 3300, singer) => {
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
  return { text, startMs, endMs: startMs + durMs + 200, words, ...(singer ? { singer } : {}) }
}

// 1. Karaoke mode on a TV-sized window.
await resize(1600, 900)
await play({ videoId: 'shot-k', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember' }, 15.4, [
  mk(10000, 'Streetlights hum a little lower tonight'),
  mk(13600, 'Glass in the orchard, light through the leaves'),
  mk(17200, 'Every apple holds a sun it never sees'),
  mk(20800, 'You said forever like you meant the word'),
  mk(24400, 'I believed you more than anything I heard')
])
await win.evaluate(() => document.body.classList.add('karaoke'))
await sleep(3000)
await grab('karaoke.jpg')
await win.evaluate(() => document.body.classList.remove('karaoke'))

// 2. A duet in a regular window.
await resize(760, 860)
await play({ videoId: 'shot-d', title: 'River Lanterns', artist: 'Mara Vale & Theo Lind', album: 'Two Shores' }, 15.6, [
  mk(8000, 'Tell me where the river goes', 3000, 1),
  mk(11300, 'Down to where the lanterns glow', 3000, 2),
  mk(14600, 'Will you wait for me tonight', 3000, 1),
  mk(17900, 'Till the morning finds the light', 3000, 2),
  mk(21200, 'We were always meant to stay', 3000, 3),
  mk(24500, 'Hold on, hold on', 2400, 1)
])
await sleep(3500)
await win.mouse.move(380, 400)
await grab('duet.jpg')

// 3. Settings.
await win.keyboard.press('Meta+Comma')
await sleep(900)
await grab('settings.jpg')

clearInterval(ticker)
ws.close()
artServer.close()
await app.close()
console.log('saved to', outDir)
