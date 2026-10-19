import { t } from '../shared/i18n'
import { app, net } from 'electron'
import { RELEASES_REPO } from '../shared/links'
import YAML from 'yaml'
import { createHash } from 'node:crypto'
import type { Lyrics, PlayerState } from '../shared/types'
import { cleanArtist, cleanTitle, fromLyricsfile, looksFakeSynced, parseLrc, similarity, stripCredits } from '../shared/lrc'

const API = 'https://lrclib.net/api'
const USER_AGENT = `Lyrique v${app.getVersion()} (https://github.com/${RELEASES_REPO})`

interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
  hasWordSync?: boolean
  lyricsfile?: string | null
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT, Accept: 'application/json' }
  })
  if (res.status === 404) return null
  if (res.status === 429 || res.status === 503) {
    const wait = Number(res.headers.get('retry-after') ?? '1') * 1000
    await new Promise((r) => setTimeout(r, Math.min(wait, 5000)))
    const retry = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT } })
    if (!retry.ok) return null
    return (await retry.json()) as T
  }
  if (!res.ok) return null
  return (await res.json()) as T
}

function toLyrics(rec: LrclibRecord, durationMs: number, source: string): Lyrics {
  const matched = { title: rec.trackName, artist: rec.artistName, album: rec.albumName, duration: rec.duration }
  if (rec.instrumental) {
    return { kind: 'instrumental', source, lines: [], plain: '', wordSynced: false, matched }
  }
  // Prefer the Lyricsfile document when it carries word timings.
  if (rec.hasWordSync && rec.lyricsfile) {
    try {
      const doc = YAML.parse(rec.lyricsfile)
      const lf = fromLyricsfile(doc, durationMs)
      if (lf.lines.length) {
        return {
          kind: 'synced',
          source: `${source} · word-synced`,
          lines: lf.lines,
          plain: lf.plain || rec.plainLyrics || '',
          wordSynced: lf.lines.some((l) => l.words?.length),
          matched
        }
      }
    } catch {
      /* fall through to LRC */
    }
  }
  if (rec.syncedLyrics) {
    const lines = parseLrc(rec.syncedLyrics, durationMs)
    if (lines.length && !looksFakeSynced(lines)) {
      return {
        kind: 'synced',
        source,
        lines,
        plain: rec.plainLyrics || lines.map((l) => l.text).join('\n'),
        wordSynced: lines.some((l) => l.words?.length),
        matched
      }
    }
  }
  const plain = rec.plainLyrics || (rec.syncedLyrics ? parseLrc(rec.syncedLyrics).map((l) => l.text).join('\n') : '')
  if (plain.trim()) {
    return { kind: 'plain', source, lines: [], plain, wordSynced: false, matched }
  }
  return { kind: 'none', source, lines: [], plain: '', wordSynced: false, matched }
}

/**
 * Provider chain (LRCLIB only — the one free, keyless synced-lyrics API as of 2026):
 *  1. /api/get with exact metadata + duration (server tolerance ±2 s)
 *  2. /api/get without duration (handles music-video vs audio masters)
 *  3. /api/search by title + artist, pick the best-scoring synced result
 *  4. /api/search by free text
 */
async function lrclibLyrics(state: PlayerState): Promise<Lyrics> {
  const title = cleanTitle(state.title)
  const artist = cleanArtist(state.artist)
  const durationMs = Math.round(state.duration * 1000)
  const empty: Lyrics = {
    kind: 'none',
    source: 'lrclib',
    lines: [],
    plain: '',
    wordSynced: false,
    matched: { title, artist, album: state.album, duration: state.duration }
  }
  if (!title) return empty

  const q = (p: Record<string, string | number | undefined>) =>
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&')

  // 1 + 2: exact lookups
  const exactParams = [
    { track_name: title, artist_name: artist, album_name: state.album || undefined, duration: Math.round(state.duration) || undefined },
    { track_name: title, artist_name: artist, duration: Math.round(state.duration) || undefined },
    { track_name: title, artist_name: artist }
  ]
  for (const p of exactParams) {
    try {
      const rec = await getJson<LrclibRecord>(`${API}/get?${q(p)}`)
      if (rec && (rec.syncedLyrics || rec.instrumental || rec.hasWordSync)) {
        const l = toLyrics(rec, durationMs, 'lrclib')
        if (l.kind !== 'plain') return l
        // Fake timings: keep looking for a genuinely synced copy, else fall back to its text.
        const synced = await searchBest(title, artist, state.duration, q)
        return synced ? toLyrics(synced, durationMs, 'lrclib · search') : l
      }
      if (rec && rec.plainLyrics && !p.duration) {
        // keep as fallback but keep searching for a synced copy
        const synced = await searchBest(title, artist, state.duration, q)
        return synced ? toLyrics(synced, durationMs, 'lrclib · search') : toLyrics(rec, durationMs, 'lrclib')
      }
    } catch (err) {
      // Network hiccup: try the next lookup.
      console.warn('[lrclib]', String(err))
    }
  }

  // 3 + 4: search
  const best = await searchBest(title, artist, state.duration, q)
  if (best) return toLyrics(best, durationMs, 'lrclib · search')
  return empty
}

async function searchBest(
  title: string,
  artist: string,
  duration: number,
  q: (p: Record<string, string | number | undefined>) => string
): Promise<LrclibRecord | null> {
  const queries = [
    `${API}/search?${q({ track_name: title, artist_name: artist })}`,
    `${API}/search?${q({ q: `${artist} ${title}` })}`
  ]
  for (const url of queries) {
    let results: LrclibRecord[] | null = null
    try {
      results = await getJson<LrclibRecord[]>(url)
    } catch {
      continue
    }
    if (!results?.length) continue
    const scored = results
      .map((r) => {
        const titleScore = similarity(r.trackName, title)
        const artistScore = artist ? similarity(r.artistName, artist) : 0.5
        const dDur = duration ? Math.abs(r.duration - duration) : 0
        // spotDL-style duration penalty; 15 s is the widest window observed in the wild
        const durScore = duration ? Math.exp(-0.1 * dDur) : 0.5
        const genuine = r.hasWordSync || (!!r.syncedLyrics && !looksFakeSynced(parseLrc(r.syncedLyrics)))
        const syncedBonus = genuine ? 1 : r.plainLyrics || r.syncedLyrics ? 0.3 : 0
        return { r, score: titleScore * 2 + artistScore + durScore + syncedBonus, titleScore, dDur }
      })
      .filter((s) => s.titleScore >= 0.5 && s.dDur <= 15)
      .sort((a, b) => b.score - a.score)
    const top = scored[0]
    if (top) return top.r
  }
  return null
}

/* ---------------------------- LRCLIB publishing ---------------------------- */

/**
 * Publish user-synced lyrics to LRCLIB (public, anonymous). LRCLIB gates publishing with a
 * proof-of-work challenge: find a nonce so sha256(prefix + nonce) ≤ target.
 */
export async function publishToLrclib(rec: {
  trackName: string
  artistName: string
  albumName: string
  duration: number
  plainLyrics: string
  syncedLyrics: string
}): Promise<{ ok: boolean; message: string }> {
  const headers = { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT, 'Content-Type': 'application/json' }
  const ch = await net.fetch(`${API}/request-challenge`, { method: 'POST', headers })
  if (!ch.ok) return { ok: false, message: t('publish.challengeFailed', { status: ch.status }) }
  const { prefix, target } = (await ch.json()) as { prefix: string; target: string }
  const nonce = await solveChallenge(prefix, target)
  const res = await net.fetch(`${API}/publish`, {
    method: 'POST',
    headers: { ...headers, 'X-Publish-Token': `${prefix}:${nonce}` },
    body: JSON.stringify(rec)
  })
  if (res.ok) return { ok: true, message: t('publish.thanks') }
  let detail = ''
  try {
    detail = ((await res.json()) as { message?: string }).message ?? ''
  } catch {
    /* no body */
  }
  return { ok: false, message: t('publish.rejected', { status: res.status, detail: detail ? `: ${detail}` : '' }) }
}

async function solveChallenge(prefix: string, target: string): Promise<string> {
  const t = Buffer.from(target, 'hex')
  for (let nonce = 0; ; nonce++) {
    const h = createHash('sha256').update(prefix + nonce).digest()
    if (Buffer.compare(h, t) <= 0) return String(nonce)
    if (nonce % 20_000 === 0) await new Promise((r) => setImmediate(r)) // keep the main process responsive
  }
}

/* ------------------------------- QQ Music -------------------------------- */
/*
 * Unofficial public endpoints (no account). Large catalogue incl. Western releases, line-
 * synced LRC. Used only as a fallback after YouTube Music and LRCLIB, and labelled as such.
 * NetEase was evaluated too but now answers anonymous clients with a CAPTCHA, so it's not used.
 */
const QQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  Referer: 'https://y.qq.com/'
}

interface QqSong {
  songmid: string
  songname: string
  singer: Array<{ name: string }>
  interval: number
}

async function qqJson<T>(url: string): Promise<T | null> {
  const res = await net.fetch(url, { headers: QQ_HEADERS })
  if (!res.ok) return null
  return (await res.json()) as T
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function qqLyrics(state: PlayerState): Promise<Lyrics> {
  const title = cleanTitle(state.title)
  const artist = cleanArtist(state.artist)
  const durationMs = Math.round(state.duration * 1000)
  const none: Lyrics = { kind: 'none', source: 'QQ Music', lines: [], plain: '', wordSynced: false, matched: { title, artist, album: state.album, duration: state.duration } }
  if (!title) return none
  const search = await qqJson<{ data?: { song?: { list?: QqSong[] } } }>(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=10&cr=1&w=${encodeURIComponent(`${artist} ${title}`)}`
  )
  const best = (search?.data?.song?.list ?? [])
    .map((s) => {
      const titleScore = similarity(s.songname, title)
      const artistScore = artist ? Math.max(0, ...s.singer.map((a) => similarity(a.name, artist))) : 0.5
      const dDur = state.duration && s.interval ? Math.abs(s.interval - state.duration) : 0
      return { s, titleScore, artistScore, dDur, score: titleScore * 2 + artistScore + Math.exp(-0.1 * dDur) }
    })
    .filter((x) => x.titleScore >= 0.6 && x.artistScore >= 0.5 && x.dDur <= 8)
    .sort((a, b) => b.score - a.score)[0]
  if (!best) return none
  return qqLyricsFor(best.s, durationMs)
}

async function qqLyricsFor(song: QqSong, durationMs: number, source = 'QQ Music'): Promise<Lyrics> {
  const lyr = await qqJson<{ retcode: number; lyric?: string }>(
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?format=json&nobase64=1&g_tk=5381&songmid=${encodeURIComponent(song.songmid)}`
  )
  const text = decodeEntities(lyr?.lyric ?? '')
  const matched = { title: song.songname, artist: song.singer.map((a) => a.name).join(', '), album: '', duration: song.interval }
  const lines = stripCredits(parseLrc(text, durationMs))
  if (lines.filter((l) => l.text.trim()).length >= 3 && !looksFakeSynced(lines)) {
    return { kind: 'synced', source, lines, plain: lines.map((l) => l.text).join('\n'), wordSynced: false, matched }
  }
  // Untimed text only.
  const plain = text.replace(/^\[[^\]]*\]/gm, '').trim()
  if (plain) return { kind: 'plain', source, lines: [], plain, wordSynced: false, matched }
  return { kind: 'none', source, lines: [], plain: '', wordSynced: false, matched }
}

/* ----------------------------- provider chain ----------------------------- */

const quality = (l: Lyrics) => (l.kind === 'synced' ? 3 : l.kind === 'instrumental' ? 2.5 : l.kind === 'plain' ? 1 : 0)

const PROVIDERS: Array<[string, (s: PlayerState) => Promise<Lyrics>]> = [
  ['LRCLIB', lrclibLyrics],
  ['QQ Music', qqLyrics]
]

/** Try each provider in order, stopping at the first synced result; keep the best otherwise. */
export async function findLyrics(state: PlayerState): Promise<Lyrics> {
  const tried: string[] = []
  let best: Lyrics | null = null
  for (const [name, fetchFrom] of PROVIDERS) {
    tried.push(name)
    let l: Lyrics
    try {
      l = await fetchFrom(state)
    } catch (err) {
      console.error(`[lyrics] ${name} failed`, err)
      continue
    }
    if (!best || quality(l) > quality(best)) best = l
    if (best.kind === 'synced' || best.kind === 'instrumental') break
  }
  const result: Lyrics = best ?? {
    kind: 'none',
    source: 'none',
    lines: [],
    plain: '',
    wordSynced: false,
    matched: { title: state.title, artist: state.artist, album: state.album, duration: state.duration }
  }
  return { ...result, tried }
}

/* ------------------------------ lyrics picker ------------------------------ */

/** One alternative the user can pick when the automatic match is wrong. */
export interface Candidate {
  id: string
  source: string
  title: string
  artist: string
  album: string
  /** Seconds (0 = unknown). */
  duration: number
  kind: 'word' | 'synced' | 'unreliable' | 'plain' | 'instrumental' | 'unknown'
  /** The first lines, to tell versions apart (original, English, romanized…). */
  preview: string
  /** Lines come paired with a romanization or translation. */
  paired: boolean
  /** How well title/artist/duration match the song playing (higher is better). */
  score: number
}

/** Loaders for the candidates listed most recently, by id. */
const loaders = new Map<string, (durationMs: number) => Promise<Lyrics>>()

/** Every plausible match from LRCLIB and QQ Music, best first. */
export async function listCandidates(state: PlayerState): Promise<Candidate[]> {
  const title = cleanTitle(state.title)
  const artist = cleanArtist(state.artist)
  if (!title) return []
  const q = (p: Record<string, string>) => new URLSearchParams(p).toString()
  const score = (t: string, a: string, d: number) => {
    const dDur = state.duration && d ? Math.abs(d - state.duration) : 5
    return similarity(t, title) * 2 + (artist ? similarity(a, artist) : 0.5) + Math.exp(-0.1 * dDur)
  }
  const [lrc, qq] = await Promise.all([
    Promise.all(
      [`${API}/search?${q({ track_name: title, artist_name: artist })}`, `${API}/search?${q({ q: `${artist} ${title}` })}`, `${API}/search?${q({ q: title })}`].map(
        (u) => getJson<LrclibRecord[]>(u).catch(() => null)
      )
    ),
    qqJson<{ data?: { song?: { list?: QqSong[] } } }>(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=10&cr=1&w=${encodeURIComponent(`${artist} ${title}`)}`
    ).catch(() => null)
  ])
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const r of lrc.flat()) {
    if (!r || seen.has(`lrclib:${r.id}`)) continue
    seen.add(`lrclib:${r.id}`)
    const kind: Candidate['kind'] = r.instrumental
      ? 'instrumental'
      : r.hasWordSync
        ? 'word'
        : r.syncedLyrics
          ? looksFakeSynced(parseLrc(r.syncedLyrics))
            ? 'unreliable'
            : 'synced'
          : r.plainLyrics
            ? 'plain'
            : 'unknown'
    if (kind === 'unknown') continue
    const id = `lrclib:${r.id}`
    const lines = r.syncedLyrics ? parseLrc(r.syncedLyrics) : (r.plainLyrics ?? '').split('\n').map((text) => ({ text, startMs: 0, endMs: 0, sub: undefined }))
    const preview = lines
      .map((l) => l.text.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' / ')
    const paired = lines.filter((l) => l.sub).length >= 3
    // LRCLIB holds many uploads of the same lyrics: show each distinct version once.
    const key = `${kind}|${Math.round(r.duration)}|${paired}|${preview}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, source: 'LRCLIB', title: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration, kind, preview, paired, score: score(r.trackName, r.artistName, r.duration) })
    loaders.set(id, async (durationMs) => toLyrics(r, durationMs, 'lrclib · chosen'))
  }
  for (const s of qq?.data?.song?.list ?? []) {
    const id = `qq:${s.songmid}`
    if (seen.has(id)) continue
    seen.add(id)
    const a = s.singer.map((x) => x.name).join(', ')
    out.push({ id, source: 'QQ Music', title: decodeEntities(s.songname), artist: decodeEntities(a), album: '', duration: s.interval, kind: 'unknown', preview: '', paired: false, score: score(s.songname, a, s.interval) })
    loaders.set(id, (durationMs) => qqLyricsFor(s, durationMs))
  }
  // Keep it to the plausible ones; LRCLIB's free-text search can return a lot of noise.
  return out.filter((c) => c.score >= 1.6).sort((a, b) => b.score - a.score).slice(0, 14)
}

/** Lyrics for a listed candidate, or null if it isn't known (list again first). */
export async function loadCandidate(id: string, durationMs: number): Promise<Lyrics | null> {
  const load = loaders.get(id)
  return load ? load(durationMs) : null
}
