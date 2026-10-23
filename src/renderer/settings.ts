/**
 * Settings: everything that otherwise lives in the menu-bar menu and single-key shortcuts,
 * in one place. Opened with ⌘, or from the menu bar. Changes apply immediately.
 */
import type { SettingsInfo } from '../preload/index'
import { keyLabel, t } from '../shared/i18n'
import { TEXT_SCALES, type LyricsFont, type Settings, type SubMode } from '../shared/types'

const $ = (id: string) => document.getElementById(id)!

type Deps = {
  /** Name of the audio output playing now (for its delay). */
  outputDevice: () => string
  showShortcuts: () => void
  showWhatsNew: () => void
}

const fmtMs = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(1)} s`

export function initSettings(deps: Deps) {
  const root = $('settings')
  const body = $('st-body')
  let s: Settings | null = null
  let info: SettingsInfo | null = null

  const patch = (p: Partial<Settings>) => void window.lyrique.patchSettings(p)

  /* ------------------------------ controls ------------------------------ */

  function section(title: string): HTMLElement {
    const sec = document.createElement('div')
    sec.className = 'st-section'
    const h = document.createElement('div')
    h.className = 'st-heading'
    h.textContent = title
    sec.appendChild(h)
    body.appendChild(sec)
    return sec
  }

  function row(parent: HTMLElement, label: string, help: string, control: HTMLElement): void {
    const r = document.createElement('div')
    r.className = 'st-row'
    const text = document.createElement('div')
    const l = document.createElement('div')
    l.className = 'st-label'
    l.textContent = label
    text.appendChild(l)
    if (help) {
      const d = document.createElement('div')
      d.className = 'st-help'
      d.textContent = help
      text.appendChild(d)
    }
    r.append(text, control)
    parent.appendChild(r)
  }

  function toggle(on: boolean, set: (v: boolean) => void, disabled = false): HTMLElement {
    const b = document.createElement('button')
    b.className = 'st-switch' + (on ? ' on' : '')
    b.setAttribute('role', 'switch')
    b.setAttribute('aria-checked', String(on))
    b.disabled = disabled
    b.addEventListener('click', () => set(!on))
    return b
  }

  function segmented<T extends string>(value: T, options: Array<[T, string]>, set: (v: T) => void): HTMLElement {
    const g = document.createElement('div')
    g.className = 'st-seg'
    for (const [v, label] of options) {
      const b = document.createElement('button')
      b.textContent = label
      b.className = v === value ? 'on' : ''
      b.addEventListener('click', () => set(v))
      g.appendChild(b)
    }
    return g
  }

  function stepper(label: string, dec: () => void, inc: () => void, extra?: HTMLElement): HTMLElement {
    const g = document.createElement('div')
    g.className = 'st-step'
    const minus = document.createElement('button')
    minus.textContent = '−'
    minus.addEventListener('click', dec)
    const value = document.createElement('span')
    value.textContent = label
    const plus = document.createElement('button')
    plus.textContent = '+'
    plus.addEventListener('click', inc)
    g.append(minus, value, plus)
    if (extra) g.appendChild(extra)
    return g
  }

  function button(label: string, onClick: () => void, cls = 'chip small'): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = cls
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  /* ------------------------------- render ------------------------------- */

  function render(): void {
    if (!s || !info) return
    const scroll = body.scrollTop
    body.textContent = ''
    const st = s
    const inf = info

    const listen = section(t('settings.listening'))
    row(listen, 'Spotify', t('settings.spotifyHelp'), toggle(st.players.spotify, (v) => patch({ players: { ...st.players, spotify: v } })))
    row(listen, 'Apple Music', t('settings.musicHelp'), toggle(st.players.music, (v) => patch({ players: { ...st.players, music: v } })))
    row(
      listen,
      'YouTube Music',
      inf.extensionConnected ? t('settings.ytConnected') : t('settings.ytNeeds'),
      inf.extensionConnected ? document.createElement('span') : button(t('settings.setUp'), () => (close(), void window.lyrique.showSetup()))
    )
    if (inf.following) {
      const p = document.createElement('p')
      p.className = 'st-note'
      p.textContent = t('settings.following', { player: inf.following })
      listen.appendChild(p)
    }

    const look = section(t('settings.lyrics'))
    const i = TEXT_SCALES.indexOf(st.textScale)
    const at = i < 0 ? TEXT_SCALES.indexOf(1) : i
    row(
      look,
      t('settings.textSize'),
      t('settings.textSizeHelp'),
      stepper(
        `${Math.round(st.textScale * 100)}%`,
        () => patch({ textScale: TEXT_SCALES[Math.max(0, at - 1)]! }),
        () => patch({ textScale: TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, at + 1)]! })
      )
    )
    row(
      look,
      t('settings.font'),
      '',
      segmented<LyricsFont>(
        st.font,
        [
          ['default', t('settings.fontSystem')],
          ['rounded', t('settings.fontRounded')],
          ['serif', t('settings.fontSerif')]
        ],
        (font) => patch({ font })
      )
    )
    row(
      look,
      t('settings.secondLine'),
      t('settings.secondLineHelp'),
      segmented<SubMode>(
        st.subMode,
        [
          ['off', t('settings.off')],
          ['romanize', t('sub.romanize')],
          ['translate', t('sub.translate')],
          ['both', t('sub.bothShort')]
        ],
        (subMode) => patch({ subMode })
      )
    )
    const sel = document.createElement('select')
    sel.className = 'st-select'
    const sys = new Option(t('settings.systemLanguage', { name: inf.systemLanguage.name }), '')
    sel.add(sys)
    for (const l of inf.languages) sel.add(new Option(l.name, l.code))
    sel.value = st.translateTo
    sel.addEventListener('change', () => patch({ translateTo: sel.value }))
    row(look, t('settings.translateInto'), t('settings.translateHelp'), sel)
    row(look, t('settings.blur'), t('settings.blurHelp'), toggle(st.blur, (v) => patch({ blur: v })))
    const systemCalm = matchMedia('(prefers-reduced-motion: reduce)').matches
    row(
      look,
      t('settings.motion'),
      systemCalm ? t('settings.motionSystem') : t('settings.motionHelp'),
      toggle(systemCalm || st.reduceMotion, (v) => patch({ reduceMotion: v }), systemCalm)
    )

    const where = section(t('settings.where'))
    row(where, t('settings.mini'), t('settings.miniHelp'), toggle(inf.mini, (v) => void window.lyrique.setMini(v)))
    // Only the Mac menu bar can show text next to an icon.
    if (inf.platform === 'darwin') row(where, t('settings.menubar'), t('settings.menubarHelp'), toggle(st.menuBarLyrics, (v) => patch({ menuBarLyrics: v })))
    row(where, t('settings.onTop'), t('settings.onTopHelp'), toggle(st.alwaysOnTop, (v) => patch({ alwaysOnTop: v })))

    const timing = section(t('settings.timing'))
    row(
      timing,
      t('settings.allSongs'),
      t('settings.allSongsHelp'),
      stepper(
        fmtMs(st.globalOffsetMs),
        () => patch({ globalOffsetMs: st.globalOffsetMs - 100 }),
        () => patch({ globalOffsetMs: st.globalOffsetMs + 100 })
      )
    )
    const device = deps.outputDevice()
    const deviceLabel = device === 'default' ? t('settings.thisOutput') : device
    const setDevice = (name: string, ms: number) => {
      const deviceOffsets = { ...st.deviceOffsets }
      if (ms === 0) delete deviceOffsets[name]
      else deviceOffsets[name] = ms
      patch({ deviceOffsets })
    }
    const cur = st.deviceOffsets[device] ?? 0
    row(
      timing,
      t('settings.playingNow', { device: deviceLabel }),
      t('settings.deviceHelp'),
      stepper(fmtMs(cur), () => setDevice(device, cur - 100), () => setDevice(device, cur + 100))
    )
    for (const [name, ms] of Object.entries(st.deviceOffsets)) {
      if (name === device) continue
      row(timing, name === 'default' ? t('settings.defaultOutput') : name, fmtMs(ms), button(t('settings.reset'), () => setDevice(name, 0)))
    }

    const general = section(t('settings.general'))
    const lang = document.createElement('select')
    lang.className = 'st-select'
    lang.add(new Option(t('settings.languageSystem', { name: inf.systemLocale }), ''))
    for (const l of inf.locales) lang.add(new Option(l.name, l.code))
    lang.value = st.language
    lang.addEventListener('change', () => patch({ language: lang.value }))
    row(general, t('settings.language'), t('settings.languageHelp'), lang)
    // The Microsoft Store updates the app, and start at login is in Windows Settings → Apps → Startup.
    if (!inf.store) {
      row(
        general,
        t('settings.login'),
        inf.packaged ? t('settings.loginHelp') : t('settings.loginDev'),
        toggle(inf.openAtLogin, (v) => void window.lyrique.setOpenAtLogin(v).then(refreshInfo), !inf.packaged)
      )
      row(general, t('settings.updates'), t('settings.updatesHelp'), toggle(st.checkUpdates, (v) => patch({ checkUpdates: v })))
    }
    const tools = document.createElement('div')
    tools.className = 'st-tools'
    tools.append(
      button(t('settings.shortcuts'), () => (close(), deps.showShortcuts())),
      button(t('settings.whatsNew'), () => (close(), deps.showWhatsNew())),
      button(t('settings.setupGuide'), () => (close(), void window.lyrique.showSetup())),
      button(t('settings.copyDiagnostics'), function (this: HTMLButtonElement) {
        void window.lyrique.copyDiagnostics()
        this.textContent = t('copied')
      }),
      button(t('settings.report'), () => void window.lyrique.openExternal('https://github.com/Myo-Myint/lyrique/issues/new/choose'))
    )
    general.appendChild(tools)
    const ver = document.createElement('p')
    ver.className = 'st-note'
    ver.textContent = t('settings.version', { version: inf.version }) + (inf.update ? ` · ${t('settings.updateAvailable', { version: inf.update })}` : '')
    general.appendChild(ver)
    body.scrollTop = scroll
  }

  async function refreshInfo(): Promise<void> {
    info = await window.lyrique.settingsInfo()
    render()
  }

  async function open(): Promise<void> {
    s = await window.lyrique.getSettings()
    info = await window.lyrique.settingsInfo()
    root.hidden = false
    render()
    body.scrollTop = 0
  }

  function close(): void {
    root.hidden = true
  }

  $('st-close').addEventListener('click', close)
  root.addEventListener('click', (e) => e.target === root && close())
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === ',')) {
        e.preventDefault()
        close()
      }
      e.stopPropagation()
    },
    true
  )
  window.lyrique.onSettingsChanged((next) => {
    s = next
    if (!root.hidden) void refreshInfo()
  })
  window.lyrique.onMini(() => !root.hidden && void refreshInfo())
  window.lyrique.onShowSettings(() => void open())
  return { open, close, isOpen: () => !root.hidden }
}

/* ------------------------------ shortcut guide ------------------------------ */

/** Built when the guide opens, in the interface language. */
const keys = (): Array<[string, Array<[string, string]>]> => [
  [
    t('keys.playback'),
    [
      ['Space', t('keys.playPause')],
      ['← →', t('keys.seek')],
      ['⇧← ⇧→', t('keys.prevNext')],
      [t('keys.clickLine'), t('keys.jump')]
    ]
  ],
  [
    t('keys.view'),
    [
      ['F', t('keys.fullscreen')],
      ['K', t('keys.karaoke')],
      ['C', t('keys.cover')],
      ['M', t('keys.mini')],
      ['T', t('keys.second')],
      ['+ −', t('keys.size')],
      ['B', t('keys.blur')]
    ]
  ],
  [
    t('keys.lyrics'),
    [
      ['[ ]', t('keys.timing')],
      ['⌥[ ⌥]', t('keys.device')],
      ['0', t('keys.reset')],
      ['S', t('keys.share')]
    ]
  ],
  [
    t('keys.lyrique'),
    [
      ['⌘,', t('keys.settings')],
      ['?', t('keys.list')]
    ]
  ]
]

export function initShortcuts() {
  const root = $('keys')
  const list = $('keys-list')
  for (const [group, items] of keys()) {
    const g = document.createElement('div')
    g.className = 'keys-group'
    const h = document.createElement('div')
    h.className = 'st-heading'
    h.textContent = group
    g.appendChild(h)
    for (const [key, what] of items) {
      const r = document.createElement('div')
      r.className = 'keys-row'
      const k = document.createElement('span')
      k.className = 'keys-key'
      // "← →" is two keys; "Click a line" is one action.
      const parts = key === t('keys.clickLine') ? [key] : key.split(' ')
      for (const part of parts) {
        const kbd = document.createElement('kbd')
        kbd.textContent = keyLabel(part)
        k.appendChild(kbd)
      }
      const w = document.createElement('span')
      w.textContent = what
      r.append(k, w)
      g.appendChild(r)
    }
    list.appendChild(g)
  }
  const close = () => (root.hidden = true)
  $('keys-close').addEventListener('click', close)
  root.addEventListener('click', (e) => e.target === root && close())
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        close()
      }
      e.stopPropagation()
    },
    true
  )
  return { open: () => (root.hidden = false), isOpen: () => !root.hidden }
}
