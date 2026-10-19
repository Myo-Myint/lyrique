/**
 * A small local log of problems (failed lookups, player errors, window errors), so a bug
 * report can say what actually went wrong. Lives in ~/Library/Logs/Lyrique/lyrique.log, never
 * leaves the Mac by itself; the last few entries go into Copy Diagnostics.
 */
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_BYTES = 256 * 1024
const KEEP = 40

const recent: string[] = []
let file = ''

/** Home folder paths would carry the account name: shorten them to ~. */
const redact = (s: string) => s.split(homedir()).join('~')

export function logProblem(area: string, message: string): void {
  const now = new Date()
  const line = `${now.toISOString()} ${area}: ${redact(message).replace(/\s+/g, ' ').trim().slice(0, 500)}`
  recent.push(line)
  if (recent.length > KEEP) recent.shift()
  try {
    if (!file) {
      const dir = app.getPath('logs')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      file = join(dir, 'lyrique.log')
    }
    // One old file kept beside the current one.
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
    appendFileSync(file, line + '\n')
  } catch {
    /* logging must never break the app */
  }
}

/** Last problems, oldest first, with local time instead of the full timestamp. */
export function recentProblems(n = 8): string[] {
  return recent.slice(-n).map((l) => {
    const [stamp, ...rest] = l.split(' ')
    const t = new Date(stamp!)
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    return `${hhmm} ${rest.join(' ').slice(0, 200)}`
  })
}

function describe(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/** Everything already written with console.error / console.warn also lands in the log. */
export function captureConsole(): void {
  const wrap = (orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
    orig(...args)
    const text = args.map(describe).join(' ')
    const m = /^\[([\w-]+)\]\s*(.*)$/s.exec(text)
    logProblem(m ? m[1]! : 'app', m ? m[2]! : text)
  }
  console.error = wrap(console.error.bind(console))
  console.warn = wrap(console.warn.bind(console))
  // Monitor only: Electron's own handling of a crash stays as it was.
  process.on('uncaughtExceptionMonitor', (err) => logProblem('crash', `${err.name}: ${err.message}`))
  process.on('unhandledRejection', (err) => logProblem('crash', String(err instanceof Error ? `${err.name}: ${err.message}` : err)))
}
