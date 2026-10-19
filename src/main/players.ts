/**
 * Spotify and Apple Music on this Mac, without any extension: a long-lived osascript
 * (JavaScript for Automation) loop reads each running app's track and position a few times a
 * second and streams them as JSON lines. Apps that aren't running are never launched.
 * Playback commands are one-shot scripts. macOS asks the user once per app for permission.
 */
import { app, net } from 'electron'
import { cleanArtist, cleanTitle, similarity } from '../shared/lrc'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlayerState } from '../shared/types'
import { logProblem } from './log'
import { createHash } from 'node:crypto'
import { WIN_LOOP } from './players-win'

const WINDOWS = process.platform === 'win32'

/** Scripted tests swap in a stand-in that pretends to be Spotify. */
const OSASCRIPT = process.env.LYRIQUE_OSASCRIPT || 'osascript'

export type NativeApp = 'spotify' | 'music'
export const NATIVE_APPS: NativeApp[] = ['spotify', 'music']
export const APP_NAME: Record<NativeApp, string> = { spotify: 'Spotify', music: 'Music' }
export const APP_LABEL: Record<NativeApp, string> = { spotify: 'Spotify', music: 'Apple Music' }

/** One line from the loop. */
interface Report {
  app: NativeApp
  running?: boolean
  state?: 'playing' | 'paused' | 'stopped'
  pos?: number
  at?: number
  id?: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  artwork?: string
  /** Duration is in seconds (Windows); otherwise Spotify reports milliseconds. */
  sec?: boolean
  /** Apple Music: the song after this one, when the order is known (not shuffled). */
  next?: { title: string; artist: string; duration: number } | null
  error?: string
}

const LOOP = String.raw`
ObjC.import('Foundation')
const out = $.NSFileHandle.fileHandleWithStandardOutput
function emit(o) { out.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)) }
// The song after this one in Music's current playlist, so its lyrics can load early. Music
// doesn't expose "Up Next", so only when not shuffling and the playlist really holds this track.
function musicNext(a, t) {
  try {
    if (a.shuffleEnabled()) return null
    const p = a.currentPlaylist()
    const i = t.index()
    if (p.tracks[i - 1].persistentID() !== t.persistentID()) return null
    const n = p.tracks[i]
    if (!n.exists()) return null
    return { title: n.name(), artist: n.artist(), duration: n.duration() }
  } catch (e) {
    return null
  }
}
function run(argv) {
  const names = { spotify: 'Spotify', music: 'Music' }
  const lastId = {}
  const wasRunning = {}
  const deniedUntil = {}
  while (true) {
    let playing = false
    for (const key of argv) {
      if (deniedUntil[key] && Date.now() < deniedUntil[key]) continue
      let a = null
      let running = false
      try {
        a = Application(names[key])
        running = a.running()
      } catch (e) {}
      if (!running) {
        if (wasRunning[key] !== false) emit({ app: key, running: false })
        wasRunning[key] = false
        lastId[key] = null
        continue
      }
      wasRunning[key] = true
      try {
        const state = a.playerState()
        if (state === 'stopped') {
          emit({ app: key, running: true, state })
          lastId[key] = null
          continue
        }
        const t0 = Date.now()
        const pos = a.playerPosition()
        const at = (t0 + Date.now()) / 2
        const t = a.currentTrack
        const id = key === 'spotify' ? t.id() : t.persistentID()
        const msg = { app: key, running: true, state, pos, at, id }
        if (id !== lastId[key]) {
          msg.title = t.name()
          msg.artist = t.artist()
          msg.album = t.album()
          msg.duration = t.duration()
          if (key === 'spotify') msg.artwork = t.artworkUrl()
          else msg.next = musicNext(a, t)
          lastId[key] = id
        }
        emit(msg)
        if (state === 'playing') playing = true
      } catch (e) {
        const err = String(e)
        emit({ app: key, running: true, error: err })
        // Permission refused (-1743): stop asking for a while instead of failing every tick.
        if (/-1743|not authori[sz]ed|not allowed/i.test(err)) deniedUntil[key] = Date.now() + 60000
        lastId[key] = null
      }
    }
    delay(playing ? 0.4 : 1.5)
  }
}
`

/** One read of an app's state, right after a command, so Lyrique doesn't wait for the loop. */
const QUERY = String.raw`
function run(argv) {
  const key = argv[0]
  const a = Application(key === 'spotify' ? 'Spotify' : 'Music')
  if (!a.running()) return JSON.stringify({ app: key, running: false })
  const state = a.playerState()
  if (state === 'stopped') return JSON.stringify({ app: key, running: true, state })
  const t0 = Date.now()
  const pos = a.playerPosition()
  const at = (t0 + Date.now()) / 2
  const id = key === 'spotify' ? a.currentTrack.id() : a.currentTrack.persistentID()
  return JSON.stringify({ app: key, running: true, state, pos, at, id })
}
`

/** What macOS calls the first-launch "control another app" permission problem. */
export function isPermissionError(err: string): boolean {
  return /-1743|not authori[sz]ed|not allowed/i.test(err)
}

export class NativePlayers {
  onState: (app: NativeApp, s: PlayerState | null) => void = () => {}
  onError: (app: NativeApp, error: string) => void = () => {}
  private proc: ChildProcess | null = null
  private apps: NativeApp[] = []
  private buf = ''
  /** Track metadata arrives only when the track changes; positions every tick. */
  private meta = new Map<NativeApp, Pick<Report, 'id' | 'title' | 'artist' | 'album' | 'duration' | 'artwork' | 'next' | 'sec'>>()
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = true

  start(apps: NativeApp[]): void {
    this.stop()
    this.apps = apps
    this.stopped = false
    if (!apps.length || !(WINDOWS || process.platform === 'darwin')) return
    const script = join(app.getPath('temp'), WINDOWS ? 'lyrique-players.ps1' : 'lyrique-players.js')
    // PowerShell 5 reads a script without a byte-order mark as the system code page.
    writeFileSync(script, WINDOWS ? '\ufeff' + WIN_LOOP : LOOP)
    const p = WINDOWS
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...apps], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(OSASCRIPT, ['-l', 'JavaScript', script, ...apps], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = p
    p.stdout!.setEncoding('utf8')
    p.stdout!.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        try {
          this.handle(JSON.parse(line) as Report)
        } catch {
          /* partial or noise */
        }
      }
    })
    p.stderr!.on('data', (d) => console.error('[players]', String(d).trim()))
    p.on('exit', () => {
      if (this.proc !== p) return
      this.proc = null
      for (const a of this.apps) this.onState(a, null)
      // Crashed or killed: come back after a moment, unless we were stopped on purpose.
      if (!this.stopped) this.restartTimer = setTimeout(() => this.start(this.apps), 3000)
    })
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const p = this.proc
    this.proc = null
    p?.kill()
    for (const a of this.apps) this.onState(a, null)
    this.meta.clear()
    this.buf = ''
  }

  private handle(r: Report): void {
    if (!NATIVE_APPS.includes(r.app)) return
    if (r.error) {
      this.onError(r.app, r.error)
      return
    }
    if (!r.running || r.state === 'stopped' || !r.id) {
      this.meta.delete(r.app)
      this.onState(r.app, null)
      return
    }
    if (r.title !== undefined) this.meta.set(r.app, r)
    const m = this.meta.get(r.app)
    if (!m || m.id !== r.id) return
    this.onState(r.app, toPlayerState(r.app, m, r))
  }

  /** play/pause, next, previous. */
  command(target: NativeApp, action: 'playPause' | 'next' | 'previous'): void {
    if (WINDOWS) return this.tell(`${action} ${target}`)
    const verb = { playPause: 'playpause', next: 'next track', previous: 'previous track' }[action]
    void osa(`tell application "${APP_NAME[target]}" to ${verb}`).then(() => this.pollNow(target))
  }

  seek(target: NativeApp, seconds: number): void {
    if (WINDOWS) return this.tell(`seek ${target} ${Math.max(0, seconds).toFixed(3)}`)
    void osa(`tell application "${APP_NAME[target]}" to set player position to ${Math.max(0, seconds).toFixed(3)}`).then(() => this.pollNow(target))
  }

  /** Windows: the loop takes commands on stdin and reports the result on its next read. */
  private tell(line: string): void {
    this.proc?.stdin?.write(line + '\n')
  }

  /** Read the app's state now instead of at the loop's next tick (up to 1.5 s when paused). */
  private pollNow(target: NativeApp): void {
    execFile(OSASCRIPT, ['-l', 'JavaScript', '-e', QUERY, target], { timeout: 5000 }, (err, stdout) => {
      if (err || !this.proc) return
      try {
        this.handle(JSON.parse(stdout.trim()) as Report)
      } catch {
        /* nothing useful */
      }
    })
  }
}

function toPlayerState(target: NativeApp, m: Pick<Report, 'id' | 'title' | 'artist' | 'album' | 'duration' | 'artwork' | 'next' | 'sec'>, r: Report): PlayerState {
  const id = m.id ?? ''
  // Windows has no track ids, only title|artist|album: hash it into a short, stable one.
  const key = m.sec ? createHash('sha1').update(id).digest('hex').slice(0, 16) : id.replace(/^spotify:track:/, '').replace(/[^A-Za-z0-9_-]/g, '_')
  return {
    type: 'state',
    // Safe as a file name: caches are keyed by it.
    videoId: `${target}-${key}`,
    title: m.title ?? '',
    artist: m.artist ?? '',
    album: m.album ?? '',
    // Spotify on the Mac reports milliseconds; Music and Windows report seconds.
    duration: target === 'spotify' && !m.sec ? (m.duration ?? 0) / 1000 : (m.duration ?? 0),
    position: r.pos ?? 0,
    playing: r.state === 'playing',
    rate: 1,
    artwork: m.artwork ?? (target === 'music' && !WINDOWS ? MUSIC_ART : ''),
    videoType: target,
    isAd: target === 'spotify' && /^spotify:ad:/.test(id),
    player: target,
    next: m.next ?? null,
    sentAt: r.at ?? Date.now()
  }
}

/** Placeholder artwork URL: Music's artwork is read from the app on demand. */
export const MUSIC_ART = 'lyrique-music-artwork:'

function osa(script: string, quiet = false): Promise<string> {
  return new Promise((resolve) => {
    execFile(OSASCRIPT, ['-e', script], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err && !quiet) logProblem('players', `${script.trim().split('\n')[0]!.slice(0, 80)} → ${(stderr || err.message).trim()}`)
      resolve(err ? '' : stdout.trim())
    })
  })
}

/**
 * Artwork for the Apple Music track playing, as a data: URL ('' if none). Music hands out
 * artwork for songs in your library, but usually not for songs streamed from the Apple Music
 * catalogue; those come from Apple's public catalogue search instead.
 */
export async function musicArtwork(track: { title: string; artist: string; album: string }): Promise<string> {
  return (await libraryArtwork()) || (await catalogueArtwork(track))
}

async function catalogueArtwork(track: { title: string; artist: string; album: string }): Promise<string> {
  const title = cleanTitle(track.title)
  const artist = cleanArtist(track.artist)
  if (!title) return ''
  try {
    const res = await net.fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, entity: 'song', limit: '10' })}`)
    if (!res.ok) return ''
    const { results = [] } = (await res.json()) as {
      results?: Array<{ trackName: string; artistName: string; collectionName: string; artworkUrl100?: string }>
    }
    const best = results
      .filter((r) => r.artworkUrl100)
      .map((r) => ({
        r,
        score:
          similarity(r.trackName, title) * 2 +
          similarity(r.artistName, artist) +
          (track.album ? similarity(r.collectionName, track.album) * 2 : 0)
      }))
      .filter((x) => x.score >= 2.2)
      .sort((a, b) => b.score - a.score)[0]
    if (!best) return ''
    const art = await net.fetch(best.r.artworkUrl100!.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/640x640bb.jpg'))
    if (!art.ok) return ''
    return `data:${art.headers.get('content-type') ?? 'image/jpeg'};base64,${Buffer.from(await art.arrayBuffer()).toString('base64')}`
  } catch {
    return ''
  }
}

/** From the Music app itself (tracks in your library). */
async function libraryArtwork(): Promise<string> {
  const file = join(app.getPath('temp'), 'lyrique-music-art')
  // Streamed songs have no artwork here; that's expected, not a problem worth logging.
  const path = await osa(`
    tell application "Music"
      if (count of artworks of current track) = 0 then return ""
      set d to raw data of artwork 1 of current track
    end tell
    set f to open for access (POSIX file "${file}") with write permission
    set eof f to 0
    write d to f
    close access f
    return "${file}"`, true)
  if (!path) return ''
  try {
    const buf = readFileSync(path)
    rmSync(path, { force: true })
    const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}
