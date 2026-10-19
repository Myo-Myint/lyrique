/**
 * "Wrong lyrics?" — every plausible match from YouTube Music, LRCLIB and QQ Music, with how
 * well its length matches the song. Picking one shows it now and remembers it for the song.
 */
import type { PickerCandidate } from '../preload/index'
import type { TrackInfo } from '../shared/types'
import { t } from '../shared/i18n'

const $ = (id: string) => document.getElementById(id)!

const KIND = (): Record<PickerCandidate['kind'], [string, string]> => ({
  word: [t('picker.wordSynced'), 'good'],
  synced: [t('picker.synced'), 'good'],
  unreliable: [t('picker.timingOff'), 'warn'],
  plain: [t('picker.unsynced'), ''],
  instrumental: [t('picker.instrumental'), ''],
  unknown: [t('picker.lyrics'), '']
})

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`

export function initPicker(deps: { track: () => TrackInfo | null; openEditor: () => void }) {
  const root = $('picker')
  const list = $('pk-list')
  const status = $('pk-status')
  let token = 0

  const close = () => {
    root.hidden = true
    token++
  }

  function row(opts: { id: string; title: string; meta: string; preview?: string; tags: Array<[string, string]>; dur?: string; durOff?: boolean; current: boolean }) {
    const b = document.createElement('button')
    b.className = 'pk-row' + (opts.current ? ' current' : '')
    const head = document.createElement('div')
    head.className = 'pk-title'
    head.textContent = opts.title
    const m = document.createElement('div')
    m.className = 'pk-meta'
    m.textContent = opts.meta
    const tags = document.createElement('div')
    tags.className = 'pk-tags'
    for (const [label, cls] of opts.tags) {
      const s = document.createElement('span')
      s.className = `pk-tag ${cls}`
      s.textContent = label
      tags.appendChild(s)
    }
    if (opts.dur) {
      const d = document.createElement('span')
      d.className = 'pk-dur' + (opts.durOff ? ' off' : '')
      d.textContent = opts.dur
      tags.appendChild(d)
    }
    b.append(head, tags, m)
    if (opts.preview) {
      const p = document.createElement('div')
      p.className = 'pk-preview'
      p.textContent = opts.preview
      b.appendChild(p)
    }
    b.addEventListener('click', () => void choose(opts.id, b))
    list.appendChild(b)
  }

  async function choose(id: string, btn?: HTMLButtonElement): Promise<void> {
    for (const b of list.querySelectorAll('button')) b.disabled = true
    status.textContent = t('picker.loading')
    const r = await window.lyrique.chooseLyrics(id)
    if (r.ok) return close()
    status.textContent = r.message ?? t('picker.couldNotLoad')
    for (const b of list.querySelectorAll('button')) b.disabled = false
    btn?.focus()
  }

  async function open(): Promise<void> {
    const tr = deps.track()
    if (!tr) return
    const my = ++token
    root.hidden = false
    $('pk-song').textContent = `${tr.title} — ${tr.artist}`
    list.textContent = ''
    status.textContent = t('picker.searching')
    $('pk-auto').hidden = true
    const r = await window.lyrique.lyricsCandidates()
    if (my !== token) return
    if (!r) {
      status.textContent = t('picker.playFirst')
      return
    }
    $('pk-auto').hidden = !r.pickedId
    const total = (r.youtube ? 1 : 0) + r.candidates.length
    status.textContent = total
      ? t('picker.showing', { what: r.pickedId ? t('picker.yourChoice') : r.showing || t('picker.nothingYet') })
      : t('picker.noMatches')
    if (r.youtube) {
      row({
        id: 'youtube',
        title: t('picker.youtube'),
        meta: t('picker.youtubeMeta'),
        tags: [[r.youtube.kind === 'synced' ? t('picker.synced') : t('picker.unsynced'), r.youtube.kind === 'synced' ? 'good' : '']],
        current: r.pickedId === 'youtube'
      })
    }
    for (const c of r.candidates) {
      const delta = tr.duration && c.duration ? Math.round(c.duration - tr.duration) : null
      row({
        id: c.id,
        title: c.title,
        meta: [c.artist, c.album, c.source].filter(Boolean).join(' · '),
        preview: c.preview,
        tags: c.paired ? [KIND()[c.kind], [t('picker.romanization'), '']] : [KIND()[c.kind]],
        dur: c.duration ? `${fmt(c.duration)}${delta ? ` (${t('picker.seconds', { n: `${delta > 0 ? '+' : ''}${delta}` })})` : ''}` : undefined,
        durOff: delta !== null && Math.abs(delta) > 3,
        current: r.pickedId === c.id
      })
    }
  }

  $('pk-close').addEventListener('click', close)
  root.addEventListener('click', (e) => e.target === root && close())
  $('pk-auto').addEventListener('click', () => void choose('auto'))
  $('pk-search').addEventListener('click', () => {
    close()
    void window.lyrique.refetchLyrics()
  })
  $('pk-sync').addEventListener('click', () => {
    close()
    deps.openEditor()
  })
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return
      if (e.key === 'Escape') close()
      // Keep the player's single-key shortcuts from firing behind the dialog.
      e.stopPropagation()
    },
    true
  )
  return { open, close, isOpen: () => !root.hidden }
}
