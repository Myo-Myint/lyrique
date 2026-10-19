#!/usr/bin/env node
// Stand-in for osascript in scripted tests: plays "Spotify" with a made-up track. One-shot
// commands are logged to $FAKE_OSA_LOG and applied (playpause toggles, seek moves), with a
// realistic delay before the app reacts. $FAKE_OSA_STATE holds the shared state, e.g.
// {"playing":false}, {"position":30} or {"off":true} (Spotify not running).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const log = process.env.FAKE_OSA_LOG
const stateFile = process.env.FAKE_OSA_STATE
const args = process.argv.slice(2)
const read = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8') || '{}') : {})
const write = (s) => writeFileSync(stateFile, JSON.stringify(s))

/** Position now, advancing while playing (anchored in the state file). */
function position(s, now = Date.now()) {
  const base = s.anchorPos ?? 30
  return s.playing === false ? base : base + (now - (s.anchorAt ?? now)) / 1000
}
function setPlaying(s, playing) {
  const now = Date.now()
  write({ ...s, anchorPos: position(s, now), anchorAt: now, playing })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (args.includes('-e')) {
  const script = args[args.indexOf('-e') + 1]
  if (args[0] === '-e') {
    appendFileSync(log, script.replace(/\s+/g, ' ').trim() + '\n')
    await sleep(120) // Apple events take a moment
    const s = read()
    if (/playpause/.test(script)) setPlaying(s, s.playing === false)
    const seek = script.match(/set player position to ([\d.]+)/)
    if (seek) write({ ...s, anchorPos: Number(seek[1]), anchorAt: Date.now() })
  } else {
    // One-shot state query.
    const s = read()
    if (s.off) process.stdout.write(JSON.stringify({ app: 'spotify', running: false }))
    else process.stdout.write(JSON.stringify({ app: 'spotify', running: true, state: s.playing === false ? 'paused' : 'playing', pos: position(s), at: Date.now(), id: 'spotify:track:FAKE123' }))
  }
  process.exit(0)
}

let sentMeta = false
const tick = () => {
  const s = read()
  if (typeof s.position === 'number') {
    write({ ...s, position: undefined, anchorPos: s.position, anchorAt: Date.now() })
    return tick()
  }
  if (s.off) {
    process.stdout.write(JSON.stringify({ app: 'spotify', running: false }) + '\n')
    sentMeta = false
    return
  }
  const msg = { app: 'spotify', running: true, state: s.playing === false ? 'paused' : 'playing', pos: position(s), at: Date.now(), id: 'spotify:track:FAKE123' }
  if (!sentMeta) Object.assign(msg, { title: 'Harbor Lights', artist: 'Juno Park', album: 'Tidewater', duration: 200000, artwork: '' })
  sentMeta = true
  process.stdout.write(JSON.stringify(msg) + '\n')
  if (args.includes('music')) process.stdout.write(JSON.stringify({ app: 'music', running: false }) + '\n')
}
tick()
// Like the real loop: quick while playing, slow while paused.
const loop = () => setTimeout(() => (tick(), loop()), read().playing === false ? 1500 : 400)
loop()
