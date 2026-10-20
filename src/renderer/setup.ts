/**
 * First-run checklist: app → extension connected → extension up to date → YouTube Music
 * playing → open at login. Shown until finished, and any time from the menu bar
 * ("Setup Guide…"). Each row updates live as things connect.
 */
import type { SetupStatus } from '../preload/index'
import { t } from '../shared/i18n'

const $ = (id: string) => document.getElementById(id)!

export function initSetup(): void {
  const root = $('setup')
  const list = $('setup-list')
  let status: SetupStatus | null = null

  /** `optional`: another way to listen, not a step still to do. */
  const row = (ok: boolean, title: string, detail: string, actions: Array<[string, () => void]> = [], optional = false) => {
    const el = document.createElement('div')
    el.className = 'setup-row' + (ok ? ' ok' : optional ? ' optional' : '')
    const mark = document.createElement('span')
    mark.className = 'setup-mark'
    mark.textContent = ok ? '✓' : ''
    const body = document.createElement('div')
    const head = document.createElement('div')
    head.className = 'setup-title'
    head.textContent = title
    body.appendChild(head)
    if (!ok && detail) {
      const d = document.createElement('div')
      d.className = 'setup-detail'
      d.innerHTML = detail
      body.appendChild(d)
    }
    if (!ok && actions.length) {
      const a = document.createElement('div')
      a.className = 'setup-actions'
      for (const [label, fn] of actions) {
        const b = document.createElement('button')
        b.className = 'chip small'
        b.textContent = label
        b.addEventListener('click', () => {
          fn()
          if (label === t('setup.copyExtensions')) b.textContent = t('copied')
        })
        a.appendChild(b)
      }
      body.appendChild(a)
    }
    el.append(mark, body)
    list.appendChild(el)
  }

  const heading = (text: string) => {
    const h = document.createElement('div')
    h.className = 'st-heading setup-heading'
    h.textContent = text
    list.appendChild(h)
  }

  function render(): void {
    if (!status) return
    list.textContent = ''
    const s = status
    row(true, s.packaged ? t('setup.running') : t('setup.runningDev'), '')

    const youtubeReady = s.extensionConnected && s.playing && s.bridgeUpToDate
    heading(t('setup.native'))
    row(
      !!s.nativePlayer,
      s.nativePlayer ? t('setup.following', { player: s.nativePlayer }) : t('setup.nothingToInstall'),
      t('setup.nativeHelp'),
      [],
      youtubeReady
    )

    heading(t('setup.youtube'))
    row(
      s.extensionConnected,
      t('setup.extension'),
      (s.webStoreUrl ? t('setup.extensionStore') : t('setup.extensionManual')) + (s.nativePlayer ? ` ${t('setup.onlyYouTube')}` : ''),
      s.webStoreUrl
        ? [[t('setup.addToChrome'), () => void window.lyrique.openExternal(s.webStoreUrl)]]
        : [
            [t('setup.copyExtensions'), () => void window.lyrique.copyText('chrome://extensions')],
            [t('setup.showFolder'), () => void window.lyrique.openExtensionFolder()]
          ],
      !!s.nativePlayer
    )
    if (s.extensionConnected) {
      row(
        s.playing && s.bridgeUpToDate,
        t('setup.upToDate'),
        s.playing ? t('setup.reloadHelp') : t('setup.checkedLater'),
        s.playing ? [[t('setup.copyExtensions'), () => void window.lyrique.copyText('chrome://extensions')]] : []
      )
    }

    heading(t('setup.then'))
    row(s.playing, t('setup.playing'), t('setup.playingHelp'), [
      [t('setup.openYouTube'), () => void window.lyrique.openExternal('https://music.youtube.com')]
    ])
    if (s.packaged && !s.store) {
      row(s.openAtLogin, t('setup.login'), t('setup.loginHelp'), [
        [t('setup.turnOn'), () => void window.lyrique.setOpenAtLogin(true)]
      ])
    }
    const allGood = s.playing && (!!s.nativePlayer || (s.extensionConnected && s.bridgeUpToDate))
    $('setup-sub').textContent = allGood ? t('setup.allSet') : t('setup.worksWith')
    $('setup-done').textContent = allGood ? t('setup.start') : t('setup.skip')
  }

  const show = (s: SetupStatus) => {
    status = s
    root.hidden = false
    render()
  }

  $('setup-done').addEventListener('click', () => {
    root.hidden = true
    void window.lyrique.finishSetup()
  })
  $('setup-diag').addEventListener('click', () => {
    void window.lyrique.copyDiagnostics()
    $('setup-diag').textContent = t('setup.diagnosticsCopied')
  })
  window.lyrique.onSetupShow(show)
  window.lyrique.onSetupChanged((s) => {
    status = s
    if (!root.hidden) render()
  })

  // First launch: show the checklist until it's been finished or skipped once.
  void window.lyrique.getSettings().then(async (settings) => {
    if (!settings.onboarded) show(await window.lyrique.getSetupStatus())
  })
}
