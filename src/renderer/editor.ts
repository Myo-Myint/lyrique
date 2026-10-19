/**
 * Tap-along lyric sync: paste → tap → review → save.
 *
 * Stamps are media time ("what you hear", already corrected for your audio output's delay)
 * minus a typical reaction time, so the result needs no offset. Nothing is saved until you
 * press Save, and your sync is stored apart from the fetched lyrics, so mistakes never
 * cost you the originals.
 */
import type { TrackInfo } from '../shared/types'
import { t } from '../shared/i18n'

/** Typical delay between hearing a line start and pressing a key. */
const REACTION_MS = 120
/** Taps closer than this are treated as accidental doubles. */
const MIN_TAP_GAP_MS = 250
/** Review playback starts this far before the chosen line. */
const PREROLL_MS = 2000
const NUDGE_MS = 100

export interface EditorDeps {
  /** Media time you're hearing now, in ms. */
  nowMs(): number
  track(): TrackInfo | null
  seek(seconds: number): void
  /** Called after a successful save. */
  onSaved(): void
}

type Phase = 'paste' | 'tap' | 'review' | 'saved'

interface State {
  phase: Phase
  videoId: string
  lines: string[]
  stamps: Array<number | null>
  /** Next line to stamp while tapping. */
  i: number
  lastTapAt: number
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export function initEditor(deps: EditorDeps): { open(prefill: string): Promise<void>; isOpen(): boolean; close(): void } {
  const root = $('editor')
  const body = $('ed-body')
  const actions = $('ed-actions')
  const status = $('ed-status')
  let st: State | null = null
  let rowEls: HTMLElement[] = []
  let raf = 0

  const fmt = (ms: number | null) => {
    if (ms == null) return '–:–.–'
    const cs = Math.round(ms / 10)
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
  }
  const lrcTime = (ms: number) => {
    const cs = Math.round(ms / 10)
    return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
  }

  function button(label: string, onClick: () => void, kind: 'primary' | 'plain' | 'small' = 'plain', title = ''): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = kind === 'small' ? 'chip small' : `chip${kind === 'primary' ? ' primary' : ''}`
    b.textContent = label
    if (title) b.title = title
    // Never keep focus: Space must mean "tap", not "press the focused button again".
    b.tabIndex = -1
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  function parseText(text: string): string[] {
    const out: string[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^(\[[^\]]*\])+/, '').trim() // tolerate pasted LRC
      if (line || (out.length && out[out.length - 1] !== '')) out.push(line)
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    return out
  }

  async function open(prefill: string): Promise<void> {
    const tr = deps.track()
    if (!tr) return
    st = { phase: 'paste', videoId: tr.videoId, lines: [], stamps: [], i: 0, lastTapAt: 0 }
    $('ed-song').textContent = `${tr.title} — ${tr.artist}`
    root.hidden = false
    // Editing an existing sync goes straight to review.
    const mine = await window.lyrique.getUserLyrics(tr.videoId)
    if (mine && st) {
      st.lines = mine.lines
      st.stamps = mine.stamps
      st.i = mine.lines.length
      st.phase = 'review'
    } else {
      pasteText = prefill.trim()
    }
    render()
  }

  let pasteText = ''

  function close(): void {
    st = null
    root.hidden = true
    cancelAnimationFrame(raf)
  }

  /* --------------------------------- phases -------------------------------- */

  function startTapping(fromLine: number): void {
    if (!st) return
    if (st.phase === 'paste') {
      st.lines = parseText(pasteText)
      if (!st.lines.length) return
      st.stamps = st.lines.map(() => null)
    }
    for (let k = fromLine; k < st.lines.length; k++) st.stamps[k] = null
    st.i = fromLine
    st.lastTapAt = 0
    st.phase = 'tap'
    const before = fromLine > 0 ? st.stamps[fromLine - 1]! : 0
    deps.seek(Math.max(0, (before - PREROLL_MS) / 1000))
    render()
  }

  function tap(): void {
    if (!st || st.phase !== 'tap') return
    const now = performance.now()
    if (now - st.lastTapAt < MIN_TAP_GAP_MS) return
    st.lastTapAt = now
    const prev = st.i > 0 ? st.stamps[st.i - 1]! : -Infinity
    st.stamps[st.i] = Math.round(Math.max(prev + MIN_TAP_GAP_MS, deps.nowMs() - REACTION_MS, 0))
    st.i++
    if (st.i >= st.lines.length) st.phase = 'review'
    render()
  }

  function undo(): void {
    if (!st || st.phase !== 'tap' || st.i === 0) return
    st.i--
    st.stamps[st.i] = null
    const before = st.i > 0 ? st.stamps[st.i - 1]! : 0
    deps.seek(Math.max(0, (before - PREROLL_MS) / 1000))
    render()
  }

  function nudge(k: number, delta: number): void {
    if (!st || st.stamps[k] == null) return
    const lo = k > 0 ? (st.stamps[k - 1] ?? 0) + 50 : 0
    const hi = k < st.lines.length - 1 && st.stamps[k + 1] != null ? st.stamps[k + 1]! - 50 : Infinity
    st.stamps[k] = Math.min(hi, Math.max(lo, st.stamps[k]! + delta))
    render()
  }

  async function save(): Promise<void> {
    if (!st || st.stamps.some((x) => x == null)) return
    const lrc = st.lines.map((l, k) => `[${lrcTime(st!.stamps[k]!)}]${l}`).join('\n')
    const ok = await window.lyrique.saveUserLyrics(st.videoId, lrc)
    if (!st) return
    if (!ok) {
      status.textContent = t('editor.songChanged')
      return
    }
    st.phase = 'saved'
    deps.onSaved()
    render()
  }

  /* --------------------------------- render -------------------------------- */

  function render(): void {
    cancelAnimationFrame(raf)
    if (!st) return
    body.textContent = ''
    actions.textContent = ''
    status.textContent = ''
    rowEls = []
    const help = (html: string) => {
      const p = document.createElement('p')
      p.className = 'ed-help'
      p.innerHTML = html
      body.appendChild(p)
    }

    if (st.phase === 'paste') {
      help(t('editor.pasteHelp'))
      const ta = document.createElement('textarea')
      ta.id = 'ed-text'
      ta.spellcheck = false
      ta.placeholder = t('editor.placeholder')
      ta.value = pasteText
      ta.addEventListener('input', () => (pasteText = ta.value))
      body.appendChild(ta)
      actions.append(button(t('editor.start'), () => startTapping(0), 'primary'), button(t('editor.cancel'), close))
      setTimeout(() => ta.focus(), 0)
      return
    }

    if (st.phase === 'tap') {
      help(t('editor.tapHelp', { n: st.i + 1, total: st.lines.length }))
      const stage = document.createElement('div')
      stage.className = 'ed-tapstage'
      for (let k = Math.max(0, st.i - 1); k <= Math.min(st.lines.length - 1, st.i + 2); k++) {
        const row = document.createElement('div')
        row.className = 'ed-line' + (k === st.i ? ' current' : k < st.i ? ' done' : '')
        row.textContent = st.lines[k] || t('editor.instrumental')
        stage.appendChild(row)
      }
      body.appendChild(stage)
      help(t('editor.tapKeys'))
      actions.append(
        button(t('editor.tap'), tap, 'primary'),
        button(t('editor.undo'), undo),
        button(t('editor.stop'), () => {
          st!.phase = 'review'
          render()
        })
      )
      return
    }

    if (st.phase === 'review') {
      const missing = st.stamps.filter((x) => x == null).length
      help(
        missing === 1 ? t('editor.missingOne') : missing ? t('editor.missingMany', { n: missing }) : t('editor.reviewHelp')
      )
      const list = document.createElement('div')
      list.className = 'ed-review'
      st.lines.forEach((text, k) => {
        const row = document.createElement('div')
        row.className = 'ed-row' + (st!.stamps[k] == null ? ' missing' : '')
        const time = document.createElement('span')
        time.className = 'ed-time'
        time.textContent = fmt(st!.stamps[k] ?? null)
        const label = document.createElement('span')
        label.className = 'ed-text'
        label.textContent = text || t('editor.instrumental')
        const tools = document.createElement('span')
        tools.className = 'ed-tools'
        const has = st!.stamps[k] != null
        if (has) {
          tools.append(
            button('▶', () => deps.seek(Math.max(0, (st!.stamps[k]! - PREROLL_MS) / 1000)), 'small', t('editor.playFrom')),
            button('−', () => nudge(k, -NUDGE_MS), 'small', t('editor.earlier')),
            button('+', () => nudge(k, NUDGE_MS), 'small', t('editor.later'))
          )
        }
        tools.append(button(t('editor.retap'), () => startTapping(k), 'small'))
        row.append(time, label, tools)
        list.appendChild(row)
        rowEls.push(row)
      })
      body.appendChild(list)
      const saveBtn = button(t('editor.save'), () => void save(), 'primary')
      saveBtn.disabled = missing > 0
      actions.append(
        saveBtn,
        button(t('editor.editText'), () => {
          pasteText = st!.lines.join('\n')
          st!.phase = 'paste'
          render()
        }),
        button(t('editor.cancel'), close)
      )
      followPlayback()
      return
    }

    // saved
    help(t('editor.saved'))
    const pubMsg = document.createElement('p')
    pubMsg.className = 'ed-help'
    body.appendChild(pubMsg)
    const pub = button(t('editor.publish'), () => {
      if (pub.dataset.confirm !== '1') {
        pub.dataset.confirm = '1'
        pub.textContent = t('editor.confirmPublish')
        pubMsg.textContent = t('editor.publishWarning')
        return
      }
      pub.disabled = true
      pub.textContent = t('editor.publishing')
      pubMsg.textContent = t('editor.solving')
      void window.lyrique.publishLyrics(st!.videoId).then((r) => {
        pubMsg.textContent = r.message
        pub.textContent = r.ok ? t('editor.published') : t('editor.tryAgain')
        pub.disabled = r.ok
        delete pub.dataset.confirm
      })
    })
    actions.append(button(t('editor.done'), close, 'primary'), pub)
  }

  /** In review, highlight the row that's playing so you can see where a line lands. */
  function followPlayback(): void {
    if (!st || st.phase !== 'review') return
    const ms = deps.nowMs()
    let cur = -1
    st.stamps.forEach((s, k) => {
      if (s != null && s <= ms) cur = k
    })
    rowEls.forEach((r, k) => r.classList.toggle('playing', k === cur))
    raf = requestAnimationFrame(followPlayback)
  }

  $('ed-close').addEventListener('click', close)

  // While open, the editor owns the keyboard (capture phase, ahead of app shortcuts).
  window.addEventListener(
    'keydown',
    (e) => {
      if (!st) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (st.phase === 'tap') {
          st.phase = 'review'
          render()
        } else close()
        return
      }
      e.stopImmediatePropagation()
      if (st.phase !== 'tap') return // typing in the box / review buttons
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) tap()
      } else if (e.key === 'ArrowUp' || e.key === 'Backspace') {
        e.preventDefault()
        undo()
      }
    },
    { capture: true }
  )

  return { open, isOpen: () => !!st, close }
}
