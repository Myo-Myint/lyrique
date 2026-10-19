import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Lyrics, type Settings } from '../shared/types'

function dataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export class SettingsStore {
  private file = join(dataDir(), 'settings.json')
  private data: Settings

  constructor() {
    this.data = { ...DEFAULT_SETTINGS }
    try {
      if (existsSync(this.file)) this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      /* corrupt file — start fresh */
    }
  }

  get(): Settings {
    return this.data
  }

  patch(p: Partial<Settings>): Settings {
    this.data = { ...this.data, ...p }
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      /* ignore */
    }
    return this.data
  }

  setTrackOffset(videoId: string, ms: number): Settings {
    const trackOffsets = { ...this.data.trackOffsets }
    if (ms === 0) delete trackOffsets[videoId]
    else trackOffsets[videoId] = ms
    return this.patch({ trackOffsets })
  }
}

/** On-disk JSON cache of lyrics keyed by video id (so repeat plays never hit the network). */
export class LyricsCache {
  private dir = join(dataDir(), 'lyrics-cache')
  private mem = new Map<string, Lyrics>()

  constructor() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  get(videoId: string): Lyrics | undefined {
    const hit = this.mem.get(videoId)
    if (hit) return hit
    const f = join(this.dir, `${videoId}.json`)
    if (!existsSync(f)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(f, 'utf8')) as Lyrics
      this.mem.set(videoId, parsed)
      return parsed
    } catch {
      return undefined
    }
  }

  set(videoId: string, lyrics: Lyrics): void {
    this.mem.set(videoId, lyrics)
    // Don't persist misses — the catalogue grows and the user may add lyrics later.
    if (lyrics.kind === 'none') return
    try {
      writeFileSync(join(this.dir, `${videoId}.json`), JSON.stringify(lyrics))
    } catch {
      /* ignore */
    }
  }

  delete(videoId: string): void {
    this.mem.delete(videoId)
    rmSync(join(this.dir, `${videoId}.json`), { force: true })
  }
}

/** Lyrics you synced yourself, kept apart from fetched lyrics so the originals are never lost. */
export class UserLyricsStore {
  private dir = join(dataDir(), 'user-lyrics')

  constructor() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  get(videoId: string): Lyrics | undefined {
    const f = join(this.dir, `${videoId}.json`)
    if (!existsSync(f)) return undefined
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Lyrics
    } catch {
      return undefined
    }
  }

  set(videoId: string, lyrics: Lyrics): void {
    writeFileSync(join(this.dir, `${videoId}.json`), JSON.stringify(lyrics))
  }

  delete(videoId: string): void {
    rmSync(join(this.dir, `${videoId}.json`), { force: true })
  }
}
