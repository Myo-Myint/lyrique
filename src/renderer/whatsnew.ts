/**
 * "What's new", once after each update: the features added since the version you last saw,
 * each with a button that tries it on the spot. Many features live behind single keys, and
 * people who just update never find them otherwise. Reopen it from the menu bar or Settings.
 */
import { t, type MessageKey } from '../shared/i18n'

const $ = (id: string) => document.getElementById(id)!

export type WhatsNewAction = 'karaoke' | 'mini' | 'menubar' | 'second' | 'share' | 'settings'

interface Item {
  /** Version that introduced it. */
  since: string
  key: 'renamed' | 'controls' | 'language' | 'karaoke' | 'duets' | 'motion' | 'settings' | 'players' | 'menubar' | 'mini' | 'second' | 'share'
  action?: WhatsNewAction
}

/** Newest first. */
const ITEMS: Item[] = [
  { since: '0.6.0', key: 'renamed' },
  { since: '0.5.1', key: 'controls' },
  { since: '0.5.0', key: 'language', action: 'settings' },
  { since: '0.4.4', key: 'karaoke', action: 'karaoke' },
  { since: '0.4.4', key: 'duets' },
  { since: '0.4.4', key: 'motion', action: 'settings' },
  { since: '0.4.2', key: 'settings', action: 'settings' },
  { since: '0.4.0', key: 'players' },
  { since: '0.4.0', key: 'menubar', action: 'menubar' },
  { since: '0.3.0', key: 'mini', action: 'mini' },
  { since: '0.3.0', key: 'second', action: 'second' },
  { since: '0.3.0', key: 'share', action: 'share' }
]

/** Shown to anyone updating from before this card existed, and to top up a short list. */
const HIGHLIGHTS: Item['key'][] = ['karaoke', 'mini', 'second', 'menubar', 'share', 'players']
const MAX = 6

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

export function initWhatsNew(deps: { run: (a: WhatsNewAction) => void; showShortcuts: () => void }) {
  const root = $('whatsnew')
  const list = $('wn-list')

  function render(version: string, seen: string): void {
    list.textContent = ''
    $('wn-title').textContent = t('new.title', { version })
    const fresh = seen ? ITEMS.filter((i) => newer(i.since, seen) && !newer(i.since, version)) : []
    const extra = fresh.length >= 3 ? [] : ITEMS.filter((i) => HIGHLIGHTS.includes(i.key) && !fresh.includes(i)).slice(0, MAX - fresh.length)
    fresh.slice(0, MAX).forEach(add)
    if (extra.length && fresh.length) {
      const h = document.createElement('div')
      h.className = 'st-heading wn-heading'
      h.textContent = t('new.missed')
      list.appendChild(h)
    }
    extra.forEach(add)
  }

  function add(item: Item): void {
    if (item.key === 'menubar' && window.lyrique.platform !== 'darwin') return
    const r = document.createElement('div')
    r.className = 'wn-row'
    const text = document.createElement('div')
    const title = document.createElement('div')
    title.className = 'wn-title'
    title.textContent = t(`new.${item.key}.title` as MessageKey)
    const body = document.createElement('div')
    body.className = 'wn-body'
    body.textContent = t(`new.${item.key}.body` as MessageKey)
    text.append(title, body)
    r.appendChild(text)
    if (item.action) {
      const b = document.createElement('button')
      b.className = 'chip small'
      b.textContent = item.action === 'settings' ? t('new.open') : t('new.try')
      b.addEventListener('click', () => {
        close()
        deps.run(item.action!)
      })
      r.appendChild(b)
    }
    list.appendChild(r)
  }

  function open(version: string, seen: string): void {
    render(version, seen)
    root.hidden = false
  }

  function close(): void {
    root.hidden = true
  }

  $('wn-close').addEventListener('click', close)
  $('wn-done').addEventListener('click', close)
  $('wn-keys').addEventListener('click', () => {
    close()
    deps.showShortcuts()
  })
  root.addEventListener('click', (e) => e.target === root && close())
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      e.stopPropagation()
    },
    true
  )

  /** At start: once per new version, never on a first install (the Setup Guide is showing). */
  async function maybeShow(): Promise<void> {
    const s = await window.lyrique.getSettings()
    const { version, autoWhatsNew } = await window.lyrique.settingsInfo()
    if (!autoWhatsNew || s.seenVersion === version) return
    void window.lyrique.patchSettings({ seenVersion: version })
    if (!s.onboarded) return
    window.setTimeout(() => {
      if ($('setup').hidden) open(version, s.seenVersion)
    }, 1200)
  }

  /** From the menu bar or Settings: everything since the last version, or the highlights. */
  async function show(): Promise<void> {
    const { version } = await window.lyrique.settingsInfo()
    const prev = ITEMS.map((i) => i.since).find((v) => newer(version, v) || v === version)
    const before = ITEMS.map((i) => i.since).find((v) => prev && newer(prev, v))
    open(version, before ?? '')
  }

  window.lyrique.onShowWhatsNew(() => void show())
  return { maybeShow, show, isOpen: () => !root.hidden }
}
