// Scripted check of the mini bar, second line (romanize / translate / both), text size, fonts,
// share card and diagnostics. Runs the built app on a throwaway profile and port, playing
// the part of the browser extension. Usage: node scripts/features.mjs <outDir>
import { _electron as electron } from 'playwright'
import { WebSocket } from 'ws'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, '..', 'dist', 'features')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 41999

const art = readFileSync(join(here, 'smoke-art.jpg'))
const artServer = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(art))
await new Promise((r) => artServer.listen(0, '127.0.0.1', r))
const artUrl = `http://127.0.0.1:${artServer.address().port}/art=w60-h60-l90-rj`

const profile = mkdtempSync(join(tmpdir(), 'lyrique-test-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true }))
const osaLog = join(profile, 'osa.log')
const osaState = join(profile, 'osa.json')
// Spotify stays "stopped" until the native-player section turns it on.
writeFileSync(osaState, JSON.stringify({ off: true }))
const app = await electron.launch({
  args: [join(here, '..', 'out', 'main', 'index.js')],
  env: {
    ...process.env,
    LYRIQUE_PORT: String(PORT),
    LYRIQUE_USER_DATA: profile, LYRIQUE_LANG: 'en',
    LYRIQUE_OSASCRIPT: join(here, 'fake-osascript.mjs'),
    FAKE_OSA_LOG: osaLog,
    FAKE_OSA_STATE: osaState
  }
})
const errors = []
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`main: ${e}`))
await win.setViewportSize({ width: 560, height: 760 })

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'chrome-extension://featuretest' } })
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)))
const send = (o) => ws.send(JSON.stringify(o))
let base
const play = (b) => (base = { type: 'state', duration: 200, playing: true, rate: 1, artwork: artUrl, videoType: 'ATV', isAd: false, bridge: 2, album: '', ...b })
const at = (position) => send({ ...base, position, sentAt: Date.now() })
let ticker = null
const hold = (position) => {
  clearInterval(ticker)
  const t0 = Date.now()
  at(position)
  ticker = setInterval(() => at(position + (Date.now() - t0) / 1000), 250)
}
const lyr = (videoId, lines) =>
  send({ type: 'lyrics', videoId, source: 'YouTube Music', lines: lines.map(([text, s, e]) => ({ text, startMs: s * 1000, endMs: e * 1000 })) })
const shot = (name, page = win) => page.screenshot({ path: join(outDir, `${name}.png`) })

// Song 1: Korean with an English hook (written for this test).
play({ videoId: 'test-ko', title: '별빛 정원', artist: 'Haneul', album: 'Night Garden' })
hold(9)
lyr('test-ko', [
  ['별빛이 내리는 밤에', 8, 12],
  ['너를 기다리고 있어', 12, 16],
  ['Hold me close tonight', 16, 20],
  ['우리 함께 걸어가자', 20, 24],
  ['사랑해 오늘도', 24, 28]
])
await sleep(3200)
console.log('first-run tip:', await win.textContent('#toast-text'))
await shot('01-ko-plain')
// The footer hides while idle; moving the mouse brings it back, as for a real user.
await win.mouse.move(200, 300)
await win.mouse.move(510, 740)
await sleep(300)
await win.click('#keys-btn')
console.log('footer ? opens shortcuts:', await win.isVisible('#keys'))
await win.keyboard.press('Escape')
await win.keyboard.press('t')
await sleep(1500)
await shot('02-ko-romanized')
await win.keyboard.press('t')
await sleep(3000)
await shot('03-ko-translated')
await win.keyboard.press('t')
await sleep(3000)
await shot('03b-ko-both')
await win.keyboard.press('=')
await win.keyboard.press('=')
await sleep(900)
await shot('04-ko-bigger-text')
await win.evaluate(() => window.lyrique.patchSettings({ font: 'serif' }))
await sleep(700)
await shot('05-serif')
await win.evaluate(() => window.lyrique.patchSettings({ font: 'rounded', textScale: 1 }))

// Share card → clipboard.
await win.keyboard.press('s')
await sleep(1200)
await shot('06-share-toast')
const png = await app.evaluate(async ({ clipboard }) => {
  const [item] = await clipboard.read()
  const blob = await item.getType('image/png')
  return Buffer.from(await blob.arrayBuffer()).toString('base64')
})
writeFileSync(join(outDir, '07-share-card.png'), Buffer.from(png, 'base64'))

// Mini bar.
await win.keyboard.press('m')
let mini = null
for (let i = 0; i < 30 && !mini; i++) {
  await sleep(200)
  mini = app.windows().find((w) => w !== win && w.url().includes('mini'))
}
if (!mini) throw new Error('mini window did not open')
mini.on('pageerror', (e) => errors.push(`mini: ${e}`))
await sleep(1500)
await shot('08-mini-ko', mini)
hold(16.5)
await sleep(1200)
await shot('09-mini-english-line', mini)

// Song 2: Japanese, romanization + translation, in both windows.
await win.evaluate(() => window.lyrique.patchSettings({ subMode: 'both' }))
play({ videoId: 'test-ja', title: '夜明けの歌', artist: 'Sora', album: '' })
hold(5)
lyr('test-ja', [
  ['夜明けの空に歌を', 4, 8],
  ['君の名前を呼んだ', 8, 12],
  ['今日も明日も', 12, 16]
])
await sleep(4000)
await shot('10-ja-both')
await shot('11-mini-ja', mini)

// Song 3: a file that pairs each line with its romanization under the same timestamp.
await win.evaluate(() => window.lyrique.patchSettings({ subMode: 'off' }))
play({ videoId: 'test-pairs', title: '朝の歌', artist: 'Sora', album: '' })
hold(3.4)
lyr('test-pairs', [
  ['朝の光が窓を染める', 4, 4],
  ['Asa no hikari ga mado o someru', 4, 8],
  ['君の声を思い出す', 8, 8],
  ['Kimi no koe o omoidasu', 8, 12]
])
await sleep(2300)
await shot('13-pairs-main')
await shot('14-pairs-mini', mini)

// Lyrics picker on a real song (needs the internet): list, pick another, back to automatic.
await mini.click('#close', { force: true }).catch(() => {})
play({ videoId: 'test-pick', title: 'アイドル', artist: 'YOASOBI', album: 'アイドル', duration: 213 })
hold(40)
await sleep(7000)
await win.click('#refetch', { force: true })
await win.waitForSelector('.pk-row', { timeout: 20000 })
await sleep(500)
await shot('15-picker')
const rows = await win.$$eval('.pk-row .pk-title', (els) => els.map((e) => e.textContent))
console.log('picker rows:', rows.length, rows.slice(0, 4).join(' | '))
const before = await win.textContent('#source')
await (await win.$$('.pk-row'))[1].click()
await win.waitForSelector('#picker', { state: 'hidden', timeout: 15000 })
await sleep(1200)
console.log('source before/after pick:', before, '→', await win.textContent('#source'))
await shot('16-picked')
await win.click('#refetch', { force: true })
await win.waitForSelector('.pk-row.current', { timeout: 20000 })
console.log('current row marked:', await win.textContent('.pk-row.current .pk-title'))
await win.click('#pk-auto')
await sleep(6000)
console.log('after automatic:', await win.textContent('#source'))

// Menu-bar lyrics: switch on, then read the menu-bar text back from the diagnostics.
await win.evaluate(() => window.lyrique.patchSettings({ menuBarLyrics: true }))
play({ videoId: 'test-ko', title: '별빛 정원', artist: 'Haneul', album: 'Night Garden' })
hold(12.5)
await sleep(2500)
await win.evaluate(() => window.lyrique.copyDiagnostics())
console.log('menu bar:', (await app.evaluate(({ clipboard }) => clipboard.readText())).match(/Menu bar lyrics: .*/)?.[0])

// Spotify (stand-in): starts playing, so Lyrique switches to it from YouTube Music, which is
// paused first (a playing YouTube Music tab would rightly win back the lyrics on pause).
clearInterval(ticker)
send({ ...base, playing: false, position: 20, sentAt: Date.now() })
writeFileSync(osaState, JSON.stringify({ playing: true, position: 30 }))
await sleep(7000)
await shot('17-spotify')
console.log('spotify title:', await win.textContent('#title'), '· source:', await win.textContent('#source'))
// Pause from Lyrique: the button must flip once and stay, never bounce back.
const watchButton = async (ms) => {
  const seen = []
  for (let t = 0; t < ms; t += 50) {
    seen.push((await win.getAttribute('#np-play', 'class')).includes('paused') ? 'P' : '>')
    await sleep(50)
  }
  return seen.join('').replace(/(.)\1+/g, '$1')
}
await win.keyboard.press('Space')
console.log('button after pause (should be "P"):', await watchButton(2500))
await win.keyboard.press('Space')
console.log('button after play (should be ">"):', await watchButton(2500))
await win.keyboard.press('ArrowRight')
await sleep(800)
console.log('commands sent to Spotify:', readFileSync(osaLog, 'utf8').trim().split('\n').join(' | '))
// Paused Spotify + YouTube Music starts: Lyrique follows YouTube Music again.
writeFileSync(osaState, JSON.stringify({ playing: false }))
await sleep(900)
play({ videoId: 'test-ko', title: '별빛 정원', artist: 'Haneul', album: 'Night Garden' })
hold(10)
await sleep(1500)
console.log('after YouTube Music resumes:', await win.textContent('#title'))
writeFileSync(osaState, JSON.stringify({ off: true }))

// Settings (⌘,): renders, and a switch changes the real setting.
await win.setViewportSize({ width: 560, height: 760 })
await win.keyboard.press('Meta+Comma')
await win.waitForSelector('#settings:not([hidden])')
await sleep(400)
await shot('18-settings')
await win.$eval('#st-body', (el) => (el.scrollTop = el.scrollHeight))
await sleep(200)
await shot('19-settings-bottom')
const before2 = (await win.evaluate(() => window.lyrique.getSettings())).menuBarLyrics
const switches = await win.$$('#st-body .st-row')
for (const r of switches) {
  if ((await r.textContent()).includes('Lyrics in the menu bar')) await (await r.$('.st-switch')).click()
}
await sleep(400)
console.log('settings switch: menuBarLyrics', before2, '→', (await win.evaluate(() => window.lyrique.getSettings())).menuBarLyrics)
await win.keyboard.press('Escape')
await sleep(200)
// Shortcut guide (?).
await win.keyboard.press('Shift+Slash')
await win.waitForSelector('#keys:not([hidden])')
await sleep(300)
await shot('20-shortcuts')
await win.keyboard.press('Escape')
// Setup Guide.
await win.evaluate(() => window.lyrique.showSetup())
await win.waitForSelector('#setup:not([hidden])')
await sleep(400)
await shot('21-setup')
await win.click('#setup-done')

// Problem log: a window error is recorded in the log file and in the diagnostics.
await win.evaluate(() => setTimeout(() => {
  throw new Error('test problem from the window')
}))
await sleep(500)
console.log('log file:', readFileSync(join(profile, 'logs', 'lyrique.log'), 'utf8').trim().split('\n').filter((l) => l.includes('test problem')).length, 'matching line(s)')

// Diagnostics.
await win.evaluate(() => window.lyrique.copyDiagnostics())
const diag = await app.evaluate(({ clipboard }) => clipboard.readText())
writeFileSync(join(outDir, '12-diagnostics.txt'), diag)

// The mini bar was closed from its own button above; the setting follows.
await sleep(300)
const after = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
console.log('mini after close:', after.mini, '· windows:', app.windows().length)
const unexpected = errors.filter((e) => !e.includes('test problem from the window'))
console.log(unexpected.length ? `PAGE ERRORS:\n${unexpected.join('\n')}` : 'no page errors')
clearInterval(ticker)
ws.close()
artServer.close()
await app.close()
