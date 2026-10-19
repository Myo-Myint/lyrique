// Records the clips for the "how to use" video from the real app, with lyrics written for it:
// playing, karaoke, romanization, timing, the mini bar and Settings. Each clip is a folder of
// timestamped frames plus an ffmpeg concat list. Usage: node scripts/howto-clips.mjs <outDir>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'howto')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999

const art = readFileSync(join(here, 'smoke-art.jpg'))
const artServer = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(art))
await new Promise((r) => artServer.listen(0, '127.0.0.1', r))
const artUrl = `http://127.0.0.1:${artServer.address().port}/art=w60-h60-l90-rj`

const profile = mkdtempSync(join(tmpdir(), 'lyrique-howto-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, shortcutTipShown: true, seenVersion: '9.9.9', players: { spotify: false, music: false } }))
const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js')],
  env: { ...process.env, LYRIQUE_PORT: String(PORT), LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en' }
})
const win = await app.firstWindow()
await win.waitForLoadState()
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setAlwaysOnTop(true, 'floating')
  w.setContentSize(1280, 800)
  w.center()
  w.moveTop()
})
await sleep(600)

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://howto' } })
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
  await win
    .waitForFunction((title) => document.getElementById('title')?.textContent === title && document.getElementById('empty-title')?.textContent?.includes('No lyrics'), meta.title, { timeout: 15000 })
    .catch(() => {})
  lastLyrics = { videoId: meta.videoId, lines, meta }
  await pushLyrics()
}
let lastLyrics = null
// To every window, so the mini bar gets them too.
const pushLyrics = () =>
  app.evaluate(({ BrowserWindow }, { videoId, lines, meta }) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send('track:lyrics', {
        videoId,
        lyrics: { kind: 'synced', source: 'LRCLIB · word-synced', lines, plain: '', wordSynced: true, matched: { title: meta.title, artist: meta.artist, album: '', duration: 200 } }
      })
  }, lastLyrics)

// Word timings weighted by length, so the wipe looks sung.
const mk = (startMs, text, durMs = 3300, sep = ' ') => {
  const parts = sep ? text.split(sep) : [...text]
  const weight = parts.map((p) => 1 + p.length * 0.35)
  const total = weight.reduce((a, b) => a + b, 0)
  let t = startMs
  const words = parts.map((p, i) => {
    const d = (durMs * weight[i]) / total
    const w = { text: sep && i < parts.length - 1 ? p + sep : p, startMs: Math.round(t), endMs: Math.round(t + d) }
    t += d
    return w
  })
  return { text, startMs, endMs: startMs + durMs + 200, words }
}

/** Records window `index` (0 = main, 1 = mini) for `ms`, running `during` meanwhile. */
async function record(name, ms, during = async () => {}, index = 0, png = false) {
  const dir = join(outDir, name)
  mkdirSync(dir, { recursive: true })
  await app.evaluate(({ BrowserWindow }, { dir, index, png }) => {
    const fs = process.mainModule.require('node:fs')
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(index ? 'mini.html' : 'index.html'))
    const log = []
    let n = 0
    let stop = false
    globalThis.__rec = { log, stop: () => (stop = true) }
    const grab = async () => {
      if (stop) return
      const t = Date.now()
      const img = await w.webContents.capturePage()
      const file = `f${String(n++).padStart(5, '0')}.${png ? 'png' : 'jpg'}`
      fs.writeFileSync(`${dir}/${file}`, png ? img.toPNG() : img.toJPEG(90))
      log.push([file, t])
      setTimeout(grab, Math.max(0, 33 - (Date.now() - t)))
    }
    void grab()
  }, { dir, index, png })
  await Promise.all([sleep(ms), during()])
  const log = await app.evaluate(() => {
    globalThis.__rec.stop()
    return globalThis.__rec.log
  })
  const list = log.map(([f, t], i) => `file '${f}'\nduration ${(((log[i + 1]?.[1] ?? t + 33) - t) / 1000).toFixed(3)}`).join('\n')
  writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${log.at(-1)[0]}'\n`)
  console.log(name, log.length, 'frames')
}

const english = [
  mk(10000, 'Streetlights hum a little lower tonight'),
  mk(13600, 'Glass in the orchard, light through the leaves'),
  mk(17200, 'Every apple holds a sun it never sees'),
  mk(20800, 'You said forever like you meant the word'),
  mk(24400, 'I believed you more than anything I heard'),
  mk(28000, 'Ember, ember, hold me till the morning'),
  mk(31600, 'Burn a little slower, give me warning'),
  mk(35200, 'Streetlights hum a little lower tonight'),
  mk(38800, 'Glass in the orchard, light through the leaves')
]

// 1. Playing, then the mouse wakes the playback buttons.
await play({ videoId: 'h-1', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember' }, 11.5, english)
await sleep(1200)
await win.mouse.move(1200, 780)
await sleep(3400)
await record('play', 9000, async () => {
  await sleep(5000)
  for (let i = 0; i <= 10; i++) await win.mouse.move(900 - i * 26, 640 + i * 10), await sleep(30)
})

// 2. Karaoke.
await win.keyboard.press('k')
await sleep(900)
await record('karaoke', 6500)
await win.keyboard.press('Escape')
await sleep(800)

// 3. Timing: the toolbar, then ] twice (lyrics later).
await record('timing', 5500, async () => {
  await win.mouse.move(640, 30)
  await sleep(1400)
  await win.keyboard.press('BracketRight')
  await sleep(900)
  await win.keyboard.press('BracketRight')
})

// 4. Second line: romanization on a Japanese song.
await win.mouse.move(1200, 780)
await play({ videoId: 'h-2', title: '光の朝', artist: 'Mara Vale', album: 'Ember' }, 11.5, [
  mk(10000, '静かな朝に光が差す', 3300, ''),
  mk(13600, '遠い街の歌を聴いて', 3300, ''),
  mk(17200, '君の声が風になる', 3300, ''),
  mk(20800, 'また明日ね', 2600, ''),
  mk(24000, '静かな朝に光が差す', 3300, ''),
  mk(27600, '遠い街の歌を聴いて', 3300, '')
])
await sleep(1500)
await win.keyboard.press('t')
await sleep(1500)
await record('romanize', 6500)
await win.keyboard.press('t')
await win.keyboard.press('t')

// 5. Mini bar (transparent, so PNG).
await play({ videoId: 'h-3', title: 'Glass Orchard', artist: 'Mara Vale', album: 'Ember' }, 15.5, english)
await sleep(1500)
await win.keyboard.press('m')
await sleep(1200)
await pushLyrics()
await sleep(1500)
await record('mini', 6500, async () => {}, 1, true)
await win.evaluate(() => window.lyrique.setMini(false))
await sleep(1200)

// 6. Settings.
await win.keyboard.press('Meta+Comma')
await sleep(900)
await record('settings', 3500, async () => {
  await sleep(1200)
  await win.mouse.wheel(0, 300)
})

clearInterval(ticker)
ws.close()
artServer.close()
await app.close()
console.log('saved to', outDir)
