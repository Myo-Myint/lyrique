import { app, net } from 'electron'
import { RELEASES_REPO } from '../shared/links'

export interface UpdateInfo {
  version: string
  url: string
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** "1.10.0" > "1.9.3"; ignores a leading "v" and any pre-release suffix. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split('-')[0]!.split('.').map((n) => Number(n) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * Looks for a newer release on the public releases repo. Unsigned builds can't install
 * updates themselves, so this only tells you and links to the download.
 * Silent on any failure (offline, repo not public yet, rate-limited).
 */
async function check(): Promise<UpdateInfo | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Lyrique/${app.getVersion()}` }
    })
    if (!res.ok) return null
    const rel = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
    if (!rel.tag_name || rel.draft || rel.prerelease) return null
    return isNewer(rel.tag_name, app.getVersion()) ? { version: rel.tag_name.replace(/^v/i, ''), url: rel.html_url ?? '' } : null
  } catch {
    return null
  }
}

/** `enabled` is read before every check, so switching it off in Settings takes effect at once. */
export function watchForUpdates(onUpdate: (u: UpdateInfo) => void, enabled: () => boolean): void {
  if (!app.isPackaged) return
  let last = ''
  const run = async () => {
    if (!enabled()) return
    const u = await check()
    if (u && u.version !== last) {
      last = u.version
      onUpdate(u)
    }
  }
  setTimeout(() => void run(), 15_000)
  setInterval(() => void run(), CHECK_EVERY_MS)
}
