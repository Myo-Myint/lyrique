import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, Tray, type Display } from 'electron'
import { dirname, join } from 'node:path'
import { ExtensionBridge, type ExtensionAudio, type ExtensionLyrics } from './bridge'
import { estimateOffset, type AudioFrame, type SyncResult } from '../shared/autosync'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { findLyrics, listCandidates, loadCandidate, publishToLrclib, type Candidate } from './lyrics'
import { watchForUpdates, type UpdateInfo } from './updates'
import { APP_LABEL, isPermissionError, MUSIC_ART, musicArtwork, NATIVE_APPS, NativePlayers, type NativeApp } from './players'
import { WEB_STORE_URL } from '../shared/links'
import { captureConsole, logProblem, recentProblems } from './log'
import { languageName, subtitles, systemLanguage, TRANSLATE_LANGUAGES } from './extras'
import { LyricsCache, SettingsStore, UserLyricsStore } from './store'
import { clip, lineAt } from '../shared/nowline'
import { inferEndTimes, looksFakeSynced, mergeSameTime, parseLrc } from '../shared/lrc'
import { getLocale, LOCALES, pickLocale, setLocale, setPlatform, t } from '../shared/i18n'
import { TEXT_SCALES, type ConnectionStatus, type LyricsFont, type Lyrics, type PlayerState, type Settings, type SubMode, type TrackInfo } from '../shared/types'

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
captureConsole()
// Scripted tests run against a throwaway profile, never the real settings.
if (process.env.LYRIQUE_USER_DATA) {
  app.setPath('userData', process.env.LYRIQUE_USER_DATA)
  app.setAppLogsPath(join(process.env.LYRIQUE_USER_DATA, 'logs'))
}
// Lyrique was called Lyrica until 0.6: bring its settings, cache and synced lyrics along once.
// Copied, not moved, so an old copy of Lyrica still works until it's deleted. Only our own
// files: Chromium's caches and locks stay behind (and Chromium may already have made the folder).
if (!process.env.LYRIQUE_USER_DATA) {
  const dir = app.getPath('userData')
  const old = join(dirname(dir), 'Lyrica')
  if (!existsSync(join(dir, 'settings.json')) && existsSync(join(old, 'settings.json'))) {
    for (const name of ['settings.json', 'lyrics-cache', 'user-lyrics', 'Local Storage']) {
      try {
        if (existsSync(join(old, name))) cpSync(join(old, name), join(dir, name), { recursive: true })
      } catch (err) {
        console.error(`${name} from Lyrica not copied`, err)
      }
    }
  }
}
const settings = new SettingsStore()
const cache = new LyricsCache()
const userLyrics = new UserLyricsStore()
let win: BrowserWindow | null = null
let mini: BrowserWindow | null = null
let tray: Tray | null = null
let bridge: ExtensionBridge | null = null
let currentVideoId = ''
let currentTitle = ''
let lastState: PlayerState | null = null
let lyricsRequest = 0 // monotonically increasing token to drop stale fetches
/** Lyrics delivered by the extension from YouTube Music itself, keyed by video id. */
const ytLyrics = new Map<string, Lyrics>()
/** What the renderer is currently showing for the active track. */
let shownLyrics: Lyrics | null = null
let lastArtwork: { videoId: string; artwork: string } | null = null

if (!app.requestSingleInstanceLock()) app.quit()

/* ---------------------------- window ---------------------------- */

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 320,
    minHeight: 260,
    show: false,
    title: 'Lyrique',
    // Lyrics run edge to edge: the Mac keeps its traffic lights, Windows its min/max/close.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 40 } }),
    backgroundColor: '#0c0c12',
    alwaysOnTop: settings.get().alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // The lyrics clock must keep running while the window sits unfocused over the browser.
      backgroundThrottling: false
    }
  })
  if (settings.get().alwaysOnTop) {
    w.setAlwaysOnTop(true, 'floating')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }

  w.once('ready-to-show', () => {
    placeOnSavedDisplay(w)
    w.show()
  })
  // Minimized or hidden: let the window stop animating (menu-bar lyrics and the mini bar
  // keep going). Not occlusion — macOS reports floating windows as covered when they aren't.
  const visible = (v: boolean) => () => !w.isDestroyed() && w.webContents.send('window:visible', v)
  w.on('minimize', visible(false))
  w.on('hide', visible(false))
  w.on('restore', visible(true))
  w.on('show', visible(true))
  w.on('enter-full-screen', () => onFullscreenChange(w, true))
  w.on('leave-full-screen', () => onFullscreenChange(w, false))
  // Remember which screen the user dragged it to.
  w.on('moved', () => {
    if (w.isFullScreen()) return
    const id = screen.getDisplayMatching(w.getBounds()).id
    if (id !== settings.get().displayId) {
      settings.patch({ displayId: id })
      buildTrayMenu()
    }
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.on('closed', () => {
    win = null
  })

  loadPage(w, 'index')
  return w
}

/** Everything the lyrics views need goes to both the main window and the mini bar. */
function send(channel: string, payload: unknown): void {
  for (const w of [win, mini]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

function loadPage(w: BrowserWindow, page: 'index' | 'mini'): void {
  if (isDev && process.env.ELECTRON_RENDERER_URL) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`)
  else w.loadFile(join(__dirname, `../renderer/${page}.html`))
}

/* --------------------------- mini lyrics bar --------------------------- */

const MINI_SHORTCUT = 'Alt+CommandOrControl+L'

/** A slim floating strip with just the current line, above every window and Space. */
function createMini(): BrowserWindow {
  const saved = settings.get().miniBounds
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(760, area.width - 40)
  const height = 124
  const bounds =
    saved && screen.getAllDisplays().some((d) => rectInside(saved, d.workArea))
      ? saved
      : { x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height - 28, width, height }
  const w = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 72,
    maxHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    title: 'Lyrique Mini',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.once('ready-to-show', () => w.showInactive())
  const remember = () => {
    if (!w.isDestroyed()) settings.patch({ miniBounds: w.getBounds() })
  }
  w.on('moved', remember)
  w.on('resized', remember)
  w.on('closed', () => {
    mini = null
    if (!quitting) settings.patch({ mini: false })
    buildTrayMenu()
    send('mini:changed', false)
  })
  loadPage(w, 'mini')
  return w
}

function rectInside(r: { x: number; y: number; width: number; height: number }, a: Electron.Rectangle): boolean {
  return r.x >= a.x - 20 && r.y >= a.y - 20 && r.x + r.width <= a.x + a.width + 20 && r.y + r.height <= a.y + a.height + 20
}

function setMini(on: boolean): void {
  if (on && !mini) mini = createMini()
  else if (!on && mini) mini.close()
  settings.patch({ mini: on })
  buildTrayMenu()
  send('mini:changed', on)
}

let quitting = false

const bridgePort = () => Number(process.env.LYRIQUE_PORT) || settings.get().port

/* ------------------------------ lyrics text ------------------------------ */

function patchAndBroadcast(p: Partial<Settings>): Settings {
  const next = settings.patch(p)
  if ('menuBarLyrics' in p) updateMenuBarLyrics()
  if ('players' in p) startNativePlayers()
  const relabel = 'language' in p && applyLocale()
  buildTrayMenu()
  send('settings:changed', next)
  // New interface language: reload the windows so every label is drawn again.
  if (relabel) for (const w of [win, mini]) if (w && !w.isDestroyed()) w.webContents.reload()
  return next
}

/* ------------------------------- language -------------------------------- */

const systemLocale = () => pickLocale(app.getPreferredSystemLanguages())

/** Settings → Language, or the closest match to macOS's languages. True if it changed. */
function applyLocale(): boolean {
  const before = getLocale()
  setLocale(settings.get().language || process.env.LYRIQUE_LANG || systemLocale())
  return getLocale() !== before
}

function stepTextScale(dir: 1 | -1 | 0): void {
  const cur = settings.get().textScale
  const i = TEXT_SCALES.reduce((best, v, k) => (Math.abs(v - cur) < Math.abs(TEXT_SCALES[best]! - cur) ? k : best), 0)
  const next = dir === 0 ? 1 : TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, i + dir))]!
  patchAndBroadcast({ textScale: next })
}

function translateTarget(): string {
  return settings.get().translateTo || systemLanguage()
}

/* ---------------------------- menu-bar lyrics ---------------------------- */

/** The audio output the windows report, for its delay offset (AirPods etc.). */
let outputDevice = 'default'
let menuBarTimer: ReturnType<typeof setInterval> | null = null
let menuBarText = ''
const MENU_BAR_CHARS = 42
/** Same small lead the windows use. */
const LEAD_MS = 40

/** Where the song is now, from the last position sample. */
function positionMs(st: PlayerState): number {
  const elapsed = st.playing ? Math.max(0, Date.now() - st.sentAt) * (st.rate || 1) : 0
  return st.position * 1000 + elapsed
}

/** Same layers as the windows: your song offset or auto-sync's, global, audio output. */
function lyricsOffsetMs(videoId: string, l: Lyrics): number {
  const s = settings.get()
  const manual = s.trackOffsets[videoId] ?? 0
  const auto = s.autoOffsets[videoId]
  const song = manual !== 0 ? manual : auto && auto.source === l.source ? auto.offsetMs : 0
  return song + s.globalOffsetMs + (s.deviceOffsets[outputDevice] ?? 0)
}

function setTrayTitle(text: string): void {
  if (text === menuBarText) return
  menuBarText = text
  tray?.setTitle(text ? ` ${text}` : '')
}

function tickMenuBar(): void {
  const st = lastState
  const l = shownLyrics
  if (!st || st.isAd || !activeSource || st.videoId !== currentVideoId || l?.kind !== 'synced') return setTrayTitle('')
  const line = lineAt(l.lines, positionMs(st) + LEAD_MS - lyricsOffsetMs(st.videoId, l))
  setTrayTitle(line ? clip(line.text, MENU_BAR_CHARS) : st.playing ? '♪' : '')
}

/** Start or stop the 5 Hz line check that drives the menu-bar text. */
function updateMenuBarLyrics(): void {
  const on = settings.get().menuBarLyrics
  if (on && !menuBarTimer) menuBarTimer = setInterval(tickMenuBar, 200)
  if (!on && menuBarTimer) {
    clearInterval(menuBarTimer)
    menuBarTimer = null
    setTrayTitle('')
  }
}

/* ------------------------------ diagnostics ------------------------------ */

/** Plain-text report for bug reports: versions, connection, what's playing and what was found. */
function diagnostics(): string {
  const s = settings.get()
  const l = shownLyrics
  const fmt = (ms: number) => `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(2)} s`
  const st = lastState
  const auto = st ? s.autoOffsets[st.videoId] : undefined
  const devices = Object.values(s.deviceOffsets)
  return [
    `Lyrique ${app.getVersion()} (${process.arch}${app.isPackaged ? '' : ', development build'})`,
    `${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'} ${process.getSystemVersion()} · Electron ${process.versions.electron}`,
    `Following: ${activeSource ? SOURCE_LABEL[activeSource] : 'nothing'} · Mac apps ${NATIVE_APPS.map((a) => `${APP_LABEL[a]} ${!settings.get().players[a] ? 'off' : nativeErrors.has(a) ? `error (${nativeErrors.get(a)!.slice(0, 80)})` : sources.has(a) ? 'playing' : 'idle'}`).join(', ')}`,
    `Extension: ${bridge?.connected ? 'connected' : 'not connected'}${st ? ` · bridge v${st.bridge ?? 1} (needs v${REQUIRED_BRIDGE})` : ''} · port ${bridgePort()}`,
    `Displays: ${screen.getAllDisplays().map((d) => `${d.size.width}×${d.size.height}`).join(', ')}${win?.isFullScreen() ? ' · full screen' : ''}`,
    st
      ? `Now playing: ${st.title} — ${st.artist}${st.album ? ` · ${st.album}` : ''} (${st.videoId}, ${st.videoType || '?'}, ${Math.round(st.duration)} s, ${st.playing ? 'playing' : 'paused'})`
      : 'Now playing: nothing',
    l
      ? `Lyrics: ${l.kind} from ${l.source}${l.wordSynced ? ', word-synced' : ''} · ${l.lines.length} lines${l.tried ? ` · searched ${l.tried.join(', ')}` : ''}`
      : 'Lyrics: none loaded',
    `Offsets: song ${fmt(st ? (s.trackOffsets[st.videoId] ?? 0) : 0)} · auto ${auto ? `${fmt(auto.offsetMs)} (${auto.source})` : 'none'} · global ${fmt(s.globalOffsetMs)} · ${devices.length} audio output offset(s)${devices.length ? ` ${devices.map(fmt).join(', ')}` : ''}`,
    `Menu bar lyrics: ${s.menuBarLyrics ? `on, showing "${menuBarText.trim()}"` : 'off'} · audio output offset in use ${fmt(s.deviceOffsets[outputDevice] ?? 0)}`,
    `View: second line ${s.subMode}${s.subMode === 'translate' ? ` → ${translateTarget()}` : ''} · text ×${s.textScale} · font ${s.font} · mini ${mini ? 'on' : 'off'} · on top ${s.alwaysOnTop ? 'on' : 'off'}`,
    `Update: ${update ? `${update.version} available` : 'up to date or not checked'}`,
    ...(() => {
      const problems = recentProblems()
      return problems.length
        ? [`Recent problems (full log: ${join(app.getPath('logs'), 'lyrique.log').split(app.getPath('home')).join('~')}):`, ...problems.map((p) => `  ${p}`)]
        : ['Recent problems: none']
    })()
  ].join('\n')
}

/* ----------------------------- tray ----------------------------- */

function trayIcon() {
  // Windows: the app icon, in colour (a black template icon vanishes on a dark taskbar).
  if (!isMac) {
    const p = join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../build'), 'icon.png')
    return nativeImage.createFromPath(p).resize({ width: 32, height: 32 })
  }
  // "Template" suffix lets macOS tint it for light/dark menu bars.
  const p = join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../build'), 'trayTemplate.png')
  const img = nativeImage.createFromPath(p)
  img.setTemplateImage(true)
  return img
}

function buildTrayMenu(): void {
  if (!tray) return
  const s = settings.get()
  const connected = bridge?.connected ?? false
  const denied = NATIVE_APPS.filter((a) => nativeErrors.has(a) && isPermissionError(nativeErrors.get(a)!))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: activeSource
          ? t('tray.following', { player: SOURCE_LABEL[activeSource] })
          : connected
            ? t('tray.extensionConnected')
            : t('tray.waiting'),
        enabled: false
      },
      ...denied.map((a) => ({
        label: t('tray.allow', { app: APP_LABEL[a] }),
        click: () => void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation')
      })),
      lastState
        ? { label: `${lastState.title} — ${lastState.artist}`.slice(0, 60), enabled: false }
        : { label: t('tray.nothingPlaying'), enabled: false },
      { type: 'separator' },
      { label: t('tray.show'), click: () => showWindow() },
      { label: t('tray.mini'), type: 'checkbox', checked: !!mini, accelerator: MINI_SHORTCUT, click: (item) => setMini(item.checked) },
      // Only the Mac menu bar can show text next to an icon.
      ...(isMac
        ? [
            {
              label: t('tray.menubar'),
              type: 'checkbox' as const,
              checked: s.menuBarLyrics,
              click: (item: Electron.MenuItem) => patchAndBroadcast({ menuBarLyrics: item.checked })
            }
          ]
        : []),
      {
        label: t('tray.display'),
        submenu: screen.getAllDisplays().map((d, i) => ({
          label: displayName(d, i),
          type: 'radio' as const,
          checked: win ? screen.getDisplayMatching(win.getBounds()).id === d.id : d.id === s.displayId,
          click: () => {
            showWindow()
            if (win) moveToDisplay(win, d)
          }
        }))
      },
      {
        label: t('tray.fullscreen'),
        type: 'checkbox',
        checked: win?.isFullScreen() ?? false,
        accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
        click: () => {
          showWindow()
          toggleFullscreen()
        }
      },
      {
        label: t('tray.karaoke'),
        click: () => {
          showWindow()
          win?.webContents.send('karaoke:toggle', null)
        }
      },
      {
        label: t('tray.onTop'),
        type: 'checkbox',
        checked: s.alwaysOnTop,
        click: (item) => setAlwaysOnTop(item.checked)
      },
      {
        label: t('tray.login'),
        type: 'checkbox',
        checked: openAtLogin(),
        enabled: app.isPackaged,
        click: (item) => setOpenAtLogin(item.checked)
      },
      {
        label: t('tray.lyrics'),
        submenu: [
          { label: t('tray.larger'), click: () => stepTextScale(1) },
          { label: t('tray.smaller'), click: () => stepTextScale(-1) },
          { label: t('tray.defaultSize'), enabled: s.textScale !== 1, click: () => stepTextScale(0) },
          { type: 'separator' },
          ...(
            [
              ['default', t('tray.systemFont')],
              ['rounded', t('tray.rounded')],
              ['serif', t('tray.serif')]
            ] as Array<[LyricsFont, string]>
          ).map(([font, label]) => ({
            label,
            type: 'radio' as const,
            checked: s.font === font,
            click: () => patchAndBroadcast({ font })
          })),
          { type: 'separator' },
          ...(
            [
              ['off', t('tray.noSecond')],
              ['romanize', t('tray.romanization')],
              ['translate', t('tray.translation', { language: languageName(translateTarget()) })]
            ] as Array<[SubMode, string]>
          ).map(([subMode, label]) => ({
            label,
            type: 'radio' as const,
            checked: s.subMode === subMode,
            click: () => patchAndBroadcast({ subMode })
          })),
          {
            label: t('tray.translateTo'),
            submenu: [
              {
                label: t('tray.systemLanguage', { language: languageName(systemLanguage()) }),
                type: 'radio' as const,
                checked: !s.translateTo,
                click: () => patchAndBroadcast({ translateTo: '' })
              },
              { type: 'separator' as const },
              ...TRANSLATE_LANGUAGES.map((code) => ({
                label: languageName(code),
                type: 'radio' as const,
                checked: s.translateTo === code,
                click: () => patchAndBroadcast({ translateTo: code, subMode: 'translate' })
              }))
            ]
          }
        ]
      },
      {
        label: t('tray.follow'),
        submenu: [
          { label: t('tray.ytExtension'), type: 'checkbox' as const, checked: true, enabled: false },
          ...NATIVE_APPS.map((a) => ({
            label: APP_LABEL[a],
            type: 'checkbox' as const,
            checked: s.players[a],
            click: (item: Electron.MenuItem) => patchAndBroadcast({ players: { ...settings.get().players, [a]: item.checked } })
          }))
        ]
      },
      { label: t('tray.settings'), accelerator: 'CmdOrCtrl+,', click: () => showSettings() },
      {
        label: t('tray.shortcuts'),
        click: () => {
          showWindow()
          send('keys:show', null)
        }
      },
      {
        label: t('tray.whatsNew'),
        click: () => {
          showWindow()
          send('whatsnew:show', null)
        }
      },
      { label: t('tray.setup'), click: () => showSetupGuide() },
      ...(update
        ? [{ label: t('tray.update', { version: update.version }), click: () => void shell.openExternal(update!.url) }]
        : []),
      { type: 'separator' },
      { label: t('tray.refetch'), enabled: !!lastState, click: () => refetch() },
      { label: t('tray.extensionFolder'), click: () => shell.openPath(extensionDir()) },
      { label: t('tray.diagnostics'), toolTip: t('tray.diagnosticsTip'), click: () => clipboard.writeText(diagnostics()) },
      { type: 'separator' },
      { label: t('tray.quit'), role: 'quit' }
    ])
  )
}

/* --------------------------- displays / full screen --------------------------- */

function displayName(d: Display, i: number): string {
  const size = `${d.size.width}×${d.size.height}`
  return `${d.label || t('tray.displayN', { n: i + 1 })} (${size})`
}

function placeOnSavedDisplay(w: BrowserWindow): void {
  const { displayId, fullscreen } = settings.get()
  const d = screen.getAllDisplays().find((x) => x.id === displayId)
  if (d && screen.getDisplayMatching(w.getBounds()).id !== d.id) moveToDisplay(w, d, fullscreen)
  else if (fullscreen) w.setFullScreen(true)
}

/** Centre the window on a display; full screen happens on whichever display it's on. */
function moveToDisplay(w: BrowserWindow, d: Display, fullscreen = w.isFullScreen()): void {
  const go = () => {
    const a = d.workArea
    const width = Math.min(Math.max(w.getBounds().width, 560), a.width)
    const height = Math.min(Math.max(w.getBounds().height, 760), a.height)
    w.setBounds({ x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height })
    if (fullscreen) setTimeout(() => w.setFullScreen(true), 50)
  }
  if (w.isFullScreen()) {
    // macOS animates out of full screen; move once it's done.
    w.once('leave-full-screen', () => setTimeout(go, 50))
    w.setFullScreen(false)
  } else go()
  settings.patch({ displayId: d.id })
  buildTrayMenu()
}

function onFullscreenChange(w: BrowserWindow, on: boolean): void {
  settings.patch({ fullscreen: on })
  // Native full screen and "visible on all workspaces" fight each other.
  if (settings.get().alwaysOnTop) w.setVisibleOnAllWorkspaces(!on, { visibleOnFullScreen: true, skipTransformProcessType: true })
  send('window:fullscreen', on)
  buildTrayMenu()
}

function toggleFullscreen(): void {
  if (!win) return
  win.setFullScreen(!win.isFullScreen())
}

/* ------------------------------- login / setup ------------------------------ */

function openAtLogin(): boolean {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin
}

/** Login items only make sense for the installed app, not a dev build. */
function setOpenAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: on })
  buildTrayMenu()
  send('setup:changed', setupStatus())
}

let update: UpdateInfo | null = null

function setupStatus() {
  return {
    webStoreUrl: WEB_STORE_URL,
    packaged: app.isPackaged,
    openAtLogin: openAtLogin(),
    extensionConnected: bridge?.connected ?? false,
    nativePlayer: activeSource && activeSource !== 'ytm' ? SOURCE_LABEL[activeSource] : null,
    playing: !!lastState,
    bridgeUpToDate: lastState ? bridgeOutdated === false : false,
    extensionPath: extensionDir()
  }
}

function showSettings(): void {
  showWindow()
  send('settings:show', null)
}

/** What the Settings window shows besides the settings themselves. */
function settingsInfo() {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    openAtLogin: openAtLogin(),
    systemLanguage: { code: systemLanguage(), name: languageName(systemLanguage()) },
    languages: TRANSLATE_LANGUAGES.map((code) => ({ code, name: languageName(code) })),
    mini: !!mini,
    extensionConnected: bridge?.connected ?? false,
    following: activeSource ? SOURCE_LABEL[activeSource] : null,
    update: update?.version ?? null,
    locales: Object.entries(LOCALES).map(([code, name]) => ({ code, name })),
    /** Show "What's new" by itself after an update (installed app; tests opt in). */
    autoWhatsNew: app.isPackaged || !!process.env.LYRIQUE_WHATSNEW,
    platform: process.platform,
    systemLocale: LOCALES[systemLocale()]
  }
}

function showSetupGuide(): void {
  showWindow()
  send('setup:show', setupStatus())
}

function extensionDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'extension') : join(__dirname, '../../extension')
}

function showWindow(): void {
  if (!win) win = createWindow()
  win.show()
  win.focus()
}

function setAlwaysOnTop(on: boolean): void {
  settings.patch({ alwaysOnTop: on })
  win?.setAlwaysOnTop(on, 'floating')
  win?.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true, skipTransformProcessType: true })
  buildTrayMenu()
  send('settings:changed', settings.get())
}

/* -------------------------- player state ------------------------- */

async function fetchArtwork(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:')) return url // Windows players hand over the cover itself

  // Ask Google's image CDN for a bigger render than the 60 px thumbnail the player bar uses.
  const big = url.replace(/=w\d+-h\d+(-[a-z0-9-]+)?$/i, '=w640-h640-l90-rj').replace(/=s\d+(-c)?$/i, '=s640')
  try {
    const res = await net.fetch(big)
    if (!res.ok) throw new Error(String(res.status))
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    logProblem('artwork', String(err))
    return ''
  }
}

function trackInfo(s: PlayerState, artwork = ''): TrackInfo {
  return {
    videoId: s.videoId,
    title: s.title,
    artist: s.artist,
    album: s.album,
    duration: s.duration,
    videoType: s.videoType,
    artwork
  }
}

/**
 * Look up and show lyrics for a track. `lyricsOnly` re-decides the lyrics for the song that's
 * already showing (a pick in the lyrics picker) without the song-change transition.
 */
async function loadTrack(s: PlayerState, force = false, lyricsOnly = false): Promise<void> {
  const token = ++lyricsRequest
  const s0 = settings.get()
  if (!lyricsOnly) {
    send('track:changed', {
      track: trackInfo(s),
      offsetMs: s0.trackOffsets[s.videoId] ?? 0,
      globalOffsetMs: s0.globalOffsetMs,
      autoOffset: s0.autoOffsets[s.videoId] ?? null
    })

    // Artwork and lyrics in parallel; each is delivered as soon as it lands.
    void (s.artwork === MUSIC_ART ? musicArtwork(s) : fetchArtwork(s.artwork)).then((art) => {
      if (token === lyricsRequest && art) {
        lastArtwork = { videoId: s.videoId, artwork: art }
        send('track:artwork', lastArtwork)
      }
    })
  }

  // YouTube Music's own timed lyrics (if the extension already fetched them) win:
  // they're cut to the exact master that's playing, so they never need an offset.
  const yt = force ? undefined : ytLyrics.get(s.videoId)
  shownLyrics = null
  // Your own sync wins unless you switched back to the original for this song.
  const mine = userLyrics.get(s.videoId)
  const useMine = !!mine && !s0.userSyncOff[s.videoId]
  send('track:userSync', { videoId: s.videoId, state: mine ? (useMine ? 'on' : 'off') : 'none' })
  // Lyrics you picked by hand for this song: nothing automatic replaces them.
  const picked = force ? undefined : cache.get(s.videoId)
  if (picked?.picked && !(mine && useMine)) {
    shownLyrics = picked
    send('track:lyrics', { videoId: s.videoId, lyrics: picked })
    return
  }
  if (mine && useMine) {
    shownLyrics = mine
    send('track:lyrics', { videoId: s.videoId, lyrics: mine })
  } else if (yt && yt.kind !== 'none') {
    shownLyrics = yt
    send('track:lyrics', { videoId: s.videoId, lyrics: yt })
  }

  let lyrics: Lyrics | undefined = force ? undefined : withMergedLines(cache.get(s.videoId))
  // Cached before fake-timing detection existed: look again.
  if (lyrics?.kind === 'synced' && looksFakeSynced(lyrics.lines)) lyrics = undefined
  if (!lyrics) {
    try {
      const pre = force ? undefined : prefetched.get(trackKey(s.title, s.artist))
      lyrics = (pre && (await pre)) || (await findLyrics(s))
    } catch (err) {
      console.error('[lyrics] fetch failed', err)
      lyrics = {
        kind: 'none',
        source: 'error',
        lines: [],
        plain: '',
        wordSynced: false,
        matched: { title: s.title, artist: s.artist, album: s.album, duration: s.duration }
      }
    }
    cache.set(s.videoId, lyrics)
  }
  if (token !== lyricsRequest) return
  // Only replace what's on screen (possibly YouTube Music's own lyrics) with something better.
  if (!shownLyrics || rank(lyrics) > rank(shownLyrics)) {
    shownLyrics = lyrics
    send('track:lyrics', { videoId: s.videoId, lyrics })
  }
}

/** Lyrics cached before same-timestamp pairs were folded together: fold them now. */
function withMergedLines(l: Lyrics | undefined): Lyrics | undefined {
  if (l?.kind !== 'synced' || l.lines.some((x) => x.sub !== undefined)) return l
  const lines = mergeSameTime(l.lines)
  if (lines.length === l.lines.length) return l
  inferEndTimes(lines, Math.round(l.matched.duration * 1000))
  return { ...l, lines }
}

/** Quality order: word-synced > line-synced (YouTube's own first, it matches the master) > plain > none. */
function rank(l: Lyrics): number {
  if (l.source === USER_SOURCE) return 5 // synced by you for exactly this recording
  if (l.picked) return 4.5 // chosen by you in the picker
  if (l.kind === 'instrumental') return 2.5
  if (l.kind === 'synced') return l.wordSynced ? 4 : l.source.startsWith('YouTube') ? 3 : 2.7
  if (l.kind === 'plain') return 1
  return 0
}

function handleExtensionLyrics(l: ExtensionLyrics): void {
  const matched = lastState
    ? { title: lastState.title, artist: lastState.artist, album: lastState.album, duration: lastState.duration }
    : { title: '', artist: '', album: '', duration: 0 }
  let lyrics: Lyrics
  if (l.lines?.length) {
    const lines = mergeSameTime(l.lines.map((x) => ({ text: x.text, startMs: x.startMs, endMs: x.endMs || 0 })))
    inferEndTimes(lines, Math.round(matched.duration * 1000))
    lyrics = { kind: 'synced', source: l.source, lines, plain: lines.map((x) => x.text).join('\n'), wordSynced: false, matched }
  } else if (l.plain) {
    lyrics = { kind: 'plain', source: l.source, lines: [], plain: l.plain, wordSynced: false, matched }
  } else return
  ytLyrics.set(l.videoId, lyrics)
  if (l.videoId !== currentVideoId) return
  // Upgrade what's on screen if this is better than what we have.
  if (!shownLyrics || rank(lyrics) > rank(shownLyrics)) {
    shownLyrics = lyrics
    send('track:lyrics', { videoId: l.videoId, lyrics })
  }
}

/* ------------------------------- sources ------------------------------- */
// Several players can be open at once (YouTube Music in Chrome, Spotify, Apple Music).
// Lyrique follows the one that most recently started playing; when nothing is playing it
// stays on the last one, so pausing never makes the lyrics jump to another app.

type Source = 'ytm' | NativeApp
const SOURCE_LABEL: Record<Source, string> = { ytm: 'YouTube Music', ...APP_LABEL }
const native = new NativePlayers()
const nativeErrors = new Map<NativeApp, string>()
const sources = new Map<Source, { s: PlayerState; playingSince: number }>()
let activeSource: Source | null = null

function onSourceState(src: Source, st: PlayerState | null): void {
  const prev = sources.get(src)
  if (st) {
    if (src !== 'ytm') nativeErrors.delete(src)
    const continuing = prev?.s.playing && prev.s.videoId === st.videoId
    sources.set(src, { s: st, playingSince: st.playing ? (continuing ? prev!.playingSince : Date.now()) : 0 })
  } else sources.delete(src)

  let next = activeSource && sources.has(activeSource) ? activeSource : null
  const newest = [...sources].filter(([, v]) => v.s.playing).sort((a, b) => b[1].playingSince - a[1].playingSince)[0]
  const cur = next ? sources.get(next)! : null
  if (newest && (!cur || !cur.s.playing || newest[1].playingSince > cur.playingSince)) next = newest[0]
  if (!next) next = (sources.keys().next().value as Source | undefined) ?? null

  const changed = next !== activeSource
  activeSource = next
  if (changed) sendConnection()
  // Re-read: while quitting, sources can drop out during sendConnection.
  const active = next ? sources.get(next) : undefined
  if (active && (changed || next === src)) handleState(active.s)
}

/** Something to follow: the extension is connected or a Mac app is playing. */
function anyConnected(): boolean {
  return (bridge?.connected ?? false) || [...sources.keys()].some((k) => k !== 'ytm')
}

function sendConnection(): void {
  send('bridge:status', { extensionConnected: anyConnected(), port: settings.get().port } satisfies ConnectionStatus)
  send('setup:changed', setupStatus())
  buildTrayMenu()
}

function startNativePlayers(): void {
  const p = settings.get().players
  nativeErrors.clear()
  native.start(NATIVE_APPS.filter((a) => p[a]))
}

/* --------------------------- audio auto-sync --------------------------- */

const MAX_FRAMES = 120 * 50 // two minutes at 20 ms
const RUN_EVERY_S = 10
let syncVideoId = ''
let syncFrames: AudioFrame[] = []
let syncLastRunS = 0
let syncResults: SyncResult[] = []
let syncLocked = false
let syncSource = ''

function resetAutoSync(videoId: string): void {
  syncVideoId = videoId
  syncFrames = []
  syncLastRunS = 0
  syncResults = []
  syncLocked = false
}

function handleAudio(a: ExtensionAudio): void {
  if (a.videoId !== currentVideoId) return
  if (a.videoId !== syncVideoId) resetAutoSync(a.videoId)
  if (syncLocked || syncFrames.length >= MAX_FRAMES) return
  for (const [t, mid, side, flat] of a.frames) syncFrames.push({ t, mid, side, flat })
  const secs = syncFrames.length * 0.02
  if (secs - syncLastRunS < RUN_EVERY_S) return
  syncLastRunS = secs
  runAutoSync()
}

/**
 * Measure how far the lyrics file is from the audio. YouTube Music's own lyrics are cut to
 * the exact master, so only third-party lyrics are checked. Applied once two consecutive
 * runs agree within 100 ms, or one run is unambiguous; the manual per-song offset still wins.
 */
function runAutoSync(): void {
  const ly = shownLyrics
  // YouTube Music's lyrics are cut to the master and yours were tapped against it: nothing to fix.
  if (!ly || ly.kind !== 'synced' || ly.source.startsWith('YouTube') || ly.source === USER_SOURCE || !lastState) return
  if (ly.source !== syncSource) {
    // Different lyrics file, different offset: start the agreement count over.
    syncSource = ly.source
    syncResults = []
    syncLocked = false
  }
  const r = estimateOffset(syncFrames, ly.lines)
  dumpAutoSync(r)
  if (!r?.confident) return
  syncResults.push(r)
  const prev = syncResults[syncResults.length - 2]
  const agreed = prev && Math.abs(prev.offsetMs - r.offsetMs) <= 100
  if (!agreed && r.margin < 0.1) return
  const offsetMs = Math.round((agreed ? (prev.offsetMs + r.offsetMs) / 2 : r.offsetMs) / 10) * 10
  syncLocked = !!agreed
  const auto = { offsetMs, source: ly.source }
  send('settings:changed', settings.patch({ autoOffsets: { ...settings.get().autoOffsets, [syncVideoId]: auto } }))
  send('track:autoOffset', { videoId: syncVideoId, auto })
  console.log(`[autosync] ${lastState.title}: ${offsetMs} ms (score ${r.score.toFixed(3)}, margin ${r.margin.toFixed(3)})`)
}

/** Local-only debug record (features, not audio) for tuning the matcher. */
/** Auto-sync tuning dumps are opt-in: LYRIQUE_DEBUG=1. */
const DEBUG = process.env.LYRIQUE_DEBUG === '1'

function dumpAutoSync(r: SyncResult | null): void {
  if (!DEBUG || !lastState) return
  try {
    const dir = join(app.getPath('userData'), 'autosync-debug')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${syncVideoId}.json`),
      JSON.stringify({
        title: lastState.title,
        artist: lastState.artist,
        source: shownLyrics?.source,
        manualOffsetMs: settings.get().trackOffsets[syncVideoId] ?? null,
        result: r,
        lines: shownLyrics?.lines.map((l) => ({ text: l.text, startMs: l.startMs, endMs: l.endMs, words: l.words })),
        frames: syncFrames.map((f) => [f.t, f.mid, f.side, f.flat])
      })
    )
  } catch {
    /* debug only */
  }
}

function refetch(): void {
  if (!lastState?.title) return
  cache.delete(lastState.videoId)
  ytLyrics.delete(lastState.videoId)
  void loadTrack(lastState, true)
}

/* ----------------------------- lyrics picker ----------------------------- */

interface PickerList {
  candidates: Candidate[]
  /** YouTube Music has its own lyrics for this song (offered first). */
  youtube: { kind: string } | null
  /** Id of the hand-picked lyrics showing now, if any. */
  pickedId: string | null
  showing: string
}

async function pickerList(): Promise<PickerList | null> {
  const st = lastState
  if (!st || st.isAd) return null
  const yt = ytLyrics.get(st.videoId)
  return {
    candidates: await listCandidates(st),
    youtube: yt && yt.kind !== 'none' ? { kind: yt.kind } : null,
    pickedId: shownLyrics?.picked?.id ?? null,
    showing: shownLyrics ? `${shownLyrics.source}${shownLyrics.kind === 'synced' ? '' : ` · ${shownLyrics.kind}`}` : ''
  }
}

/** Show the chosen lyrics now and remember the choice; 'auto' goes back to automatic. */
async function chooseLyrics(id: string): Promise<{ ok: boolean; message?: string }> {
  const st = lastState
  if (!st) return { ok: false, message: t('picker.nothingPlaying') }
  if (id === 'auto') {
    if (cache.get(st.videoId)?.picked) cache.delete(st.videoId)
    void loadTrack(st, false, true)
    return { ok: true }
  }
  const lyrics = id === 'youtube' ? ytLyrics.get(st.videoId) : await loadCandidate(id, Math.round(st.duration * 1000))
  if (!lyrics) return { ok: false, message: t('picker.expired') }
  if (lyrics.kind === 'none') return { ok: false, message: t('picker.empty') }
  if (st.videoId !== currentVideoId) return { ok: false, message: t('picker.songChanged') }
  const picked: Lyrics = { ...lyrics, picked: { id } }
  cache.set(st.videoId, picked)
  // Your own sync for this song steps aside so the choice shows.
  if (userLyrics.get(st.videoId)) settings.patch({ userSyncOff: { ...settings.get().userSyncOff, [st.videoId]: true } })
  void loadTrack(st, false, true)
  return { ok: true }
}

/* -------------------------------- prefetch -------------------------------- */

/** Lyrics lookups for upcoming queue entries, keyed by title+artist (no video id yet). */
const prefetched = new Map<string, Promise<Lyrics | null>>()
const trackKey = (title: string, artist: string) => `${title}\u0000${artist}`.toLowerCase().replace(/\s+/g, ' ').trim()

function prefetchNext(s: PlayerState): void {
  const n = s.next
  if (!n?.title || !n.artist) return
  const key = trackKey(n.title, n.artist)
  if (prefetched.has(key)) return
  if (prefetched.size > 20) prefetched.delete(prefetched.keys().next().value!)
  const fake = { ...s, videoId: '', title: n.title, artist: n.artist, album: '', duration: n.duration, next: null }
  // A miss isn't cached: the real track will search again (maybe with better metadata).
  prefetched.set(key, findLyrics(fake).then((l) => (l.kind === 'none' ? null : l)).catch(() => null))
}

/** Page-script version this app needs for play/pause/skip and queue prefetch. */
const REQUIRED_BRIDGE = 2
let bridgeOutdated: boolean | null = null

function handleState(s: PlayerState): void {
  lastState = s
  const outdated = (s.bridge ?? 1) < REQUIRED_BRIDGE
  if ((s.player ?? 'ytm') === 'ytm' && outdated !== bridgeOutdated) {
    bridgeOutdated = outdated
    send('bridge:outdated', outdated)
    send('setup:changed', setupStatus())
  }
  prefetchNext(s)
  // Never look up a track without a title; and if the title arrives (or changes) after the
  // videoId did, look it up again instead of leaving a "nothing matched" miss on screen.
  if (!s.isAd && s.videoId && s.title && (s.videoId !== currentVideoId || s.title !== currentTitle)) {
    if (s.videoId === currentVideoId) cache.delete(s.videoId)
    currentVideoId = s.videoId
    currentTitle = s.title
    void loadTrack(s)
    buildTrayMenu()
  } else if (s.artwork.startsWith('data:') && s.videoId === currentVideoId && lastArtwork?.videoId !== s.videoId) {
    // Windows players publish the cover a moment after the song changes.
    lastArtwork = { videoId: s.videoId, artwork: s.artwork }
    send('track:artwork', lastArtwork)
  }
  // The cover travels once, as track:artwork; not with every position update.
  send('player:state', s.artwork.startsWith('data:') ? { ...s, artwork: '' } : s)
}

/* -------------------------- user-synced lyrics -------------------------- */

const USER_SOURCE = 'You'

/** Lyrics synced in the app's tap-along editor; stamped in media time, so no offset applies. */
function saveUserLyrics(videoId: string, lrc: string): boolean {
  if (!lastState || videoId !== currentVideoId) return false
  const lines = parseLrc(lrc, Math.round(lastState.duration * 1000))
  if (!lines.length) return false
  const lyrics: Lyrics = {
    kind: 'synced',
    source: USER_SOURCE,
    lines,
    plain: lines.map((l) => l.text).join('\n'),
    wordSynced: false,
    matched: { title: lastState.title, artist: lastState.artist, album: lastState.album, duration: lastState.duration }
  }
  userLyrics.set(videoId, lyrics)
  const { [videoId]: _, ...rest } = settings.get().userSyncOff
  settings.patch({ userSyncOff: rest })
  settings.setTrackOffset(videoId, 0)
  shownLyrics = lyrics
  send('track:lyrics', { videoId, lyrics })
  send('track:userSync', { videoId, state: 'on' })
  return true
}

/** Switch between your sync and the fetched lyrics, or delete your sync. */
function setUserSync(videoId: string, action: 'use' | 'original' | 'delete'): void {
  const off = { ...settings.get().userSyncOff }
  if (action === 'use') delete off[videoId]
  else if (action === 'original') off[videoId] = true
  else {
    userLyrics.delete(videoId)
    delete off[videoId]
  }
  settings.patch({ userSyncOff: off })
  if (lastState && videoId === currentVideoId) void loadTrack(lastState)
}

/** Your saved sync for the current song, for editing: lines and their start times. */
function getUserLyrics(videoId: string): { lines: string[]; stamps: number[] } | null {
  const l = userLyrics.get(videoId)
  return l ? { lines: l.lines.map((x) => x.text), stamps: l.lines.map((x) => x.startMs) } : null
}

/** Lines → LRC text: [mm:ss.xx]text. */
function toLrc(lines: Lyrics['lines']): string {
  const ts = (ms: number) => {
    const cs = Math.round(ms / 10)
    return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
  }
  return lines.map((l) => `[${ts(l.startMs)}]${l.text}`).join('\n')
}

async function publishUserLyrics(videoId: string): Promise<{ ok: boolean; message: string }> {
  const l = userLyrics.get(videoId)
  if (!l || !lastState || videoId !== currentVideoId) {
    return { ok: false, message: t('publish.nothing') }
  }
  try {
    return await publishToLrclib({
      trackName: lastState.title,
      artistName: lastState.artist,
      albumName: lastState.album || lastState.title,
      duration: Math.round(lastState.duration),
      plainLyrics: l.lines.map((x) => x.text).filter(Boolean).join('\n'),
      syncedLyrics: toLrc(l.lines)
    })
  } catch (err) {
    return { ok: false, message: t('publish.unreachable', { error: String(err) }) }
  }
}

/* ------------------------------ ipc ----------------------------- */

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settings.get())
  // Asked once, synchronously, as each window starts: its labels depend on it.
  ipcMain.on('i18n:locale', (e) => (e.returnValue = getLocale()))
  ipcMain.handle('settings:patch', (_e, patch) => {
    if (typeof patch.alwaysOnTop === 'boolean') {
      win?.setAlwaysOnTop(patch.alwaysOnTop, 'floating')
      win?.setVisibleOnAllWorkspaces(patch.alwaysOnTop, { visibleOnFullScreen: true, skipTransformProcessType: true })
    }
    return patchAndBroadcast(patch)
  })
  ipcMain.handle('offset:set', (_e, videoId: string, ms: number) => {
    const next = settings.setTrackOffset(videoId, ms)
    send('settings:changed', next)
    return next
  })
  ipcMain.handle('lyrics:sub', (_e, lines: string[], mode: SubMode) =>
    subtitles(Array.isArray(lines) ? lines.map(String) : [], mode, translateTarget())
  )
  ipcMain.handle('text:step', (_e, dir: 1 | -1 | 0) => stepTextScale(dir))
  ipcMain.handle('mini:set', (_e, on: boolean) => setMini(!!on))
  ipcMain.handle('mini:get', () => !!mini)
  ipcMain.handle('mini:init', () => ({
    state: lastState,
    track: lastState && !lastState.isAd ? trackInfo(lastState) : null,
    lyrics: shownLyrics,
    artwork: lastArtwork?.videoId === lastState?.videoId ? lastArtwork?.artwork : '',
    settings: settings.get(),
    connected: anyConnected()
  }))
  ipcMain.handle('window:show', () => showWindow())
  ipcMain.handle('audio:device', (_e, name: string) => {
    outputDevice = String(name || 'default')
  })
  ipcMain.handle('log:problem', (_e, where: string, message: string) => logProblem(`window:${String(where).slice(0, 20)}`, String(message)))
  ipcMain.handle('app:copyDiagnostics', () => clipboard.writeText(diagnostics()))
  ipcMain.handle('app:copyImage', (_e, dataUrl: string) => {
    const png = nativeImage.createFromDataURL(String(dataUrl)).toPNG()
    return clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  ipcMain.handle('app:saveImage', async (_e, dataUrl: string, name: string) => {
    const opts = {
      defaultPath: join(app.getPath('pictures'), `${String(name).replace(/[/\\:*?"<>|]+/g, ' ').trim() || 'Lyrique'}.png`),
      filters: [{ name: t('save.pngImage'), extensions: ['png'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, nativeImage.createFromDataURL(String(dataUrl)).toPNG())
    return true
  })
  ipcMain.handle('lyrics:refetch', () => refetch())
  ipcMain.handle('lyrics:candidates', () => pickerList())
  ipcMain.handle('lyrics:choose', (_e, id: string) => chooseLyrics(String(id)))
  ipcMain.handle('track:replay', () => {
    if (lastState && !lastState.isAd) void loadTrack(lastState)
  })
  ipcMain.handle('lyrics:saveUser', (_e, videoId: string, lrc: string) => saveUserLyrics(videoId, lrc))
  ipcMain.handle('lyrics:publish', (_e, videoId: string) => publishUserLyrics(videoId))
  ipcMain.handle('lyrics:userSync', (_e, videoId: string, action: 'use' | 'original' | 'delete') => setUserSync(videoId, action))
  ipcMain.handle('lyrics:userGet', (_e, videoId: string) => getUserLyrics(videoId))
  ipcMain.handle('window:toggleFullscreen', () => toggleFullscreen())
  ipcMain.handle('window:isFullscreen', () => win?.isFullScreen() ?? false)
  ipcMain.handle('player:command', (_e, action: string) => {
    if (!['playPause', 'next', 'previous'].includes(action)) return
    if (activeSource && activeSource !== 'ytm') native.command(activeSource, action as 'playPause' | 'next' | 'previous')
    else bridge?.broadcast({ type: 'command', action })
  })
  ipcMain.handle('player:seek', (_e, seconds: number) => {
    if (!Number.isFinite(seconds)) return
    if (activeSource && activeSource !== 'ytm') native.seek(activeSource, seconds)
    else bridge?.broadcast({ type: 'seek', position: Math.max(0, seconds) })
  })
  ipcMain.handle('status:get', (): ConnectionStatus => ({
    extensionConnected: anyConnected(),
    port: settings.get().port
  }))
  ipcMain.handle('player:last', () => lastState)
  ipcMain.handle('bridge:isOutdated', () => bridgeOutdated ?? false)
  ipcMain.handle('setup:status', () => setupStatus())
  ipcMain.handle('setup:show', () => showSetupGuide())
  ipcMain.handle('settings:info', () => settingsInfo())
  ipcMain.handle('update:get', () => update)
  ipcMain.handle('setup:setOpenAtLogin', (_e, on: boolean) => setOpenAtLogin(!!on))
  ipcMain.handle('setup:done', () => {
    settings.patch({ onboarded: true })
  })
  ipcMain.handle('app:copyText', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('app:openExtensionFolder', () => shell.openPath(extensionDir()))
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
  })
}

/* ---------------------------- lifecycle -------------------------- */

app.whenReady().then(() => {
  app.setName('Lyrique')
  setPlatform(process.platform)
  applyLocale()
  registerIpc()
  // Tuning dumps from earlier builds: features only, but no longer needed.
  if (!DEBUG) rmSync(join(app.getPath('userData'), 'autosync-debug'), { recursive: true, force: true })

  bridge = new ExtensionBridge(bridgePort())
  bridge.onState = (st) => onSourceState('ytm', { ...st, player: 'ytm' })
  bridge.onLyrics = handleExtensionLyrics
  bridge.onAudio = handleAudio
  bridge.onConnection = (connected) => {
    if (!connected) onSourceState('ytm', null)
    sendConnection()
  }
  bridge.start()

  native.onState = (a, st) => onSourceState(a, st)
  native.onError = (a, err) => {
    const known = nativeErrors.get(a)
    nativeErrors.set(a, err)
    if (known !== err) {
      console.error(`[players] ${APP_LABEL[a]}: ${err}`)
      buildTrayMenu()
    }
  }
  startNativePlayers()

  // Big screen plugged back in: go back to it (and full screen, if that's how it was left).
  screen.on('display-added', (_e, d) => {
    if (win && d.id === settings.get().displayId) setTimeout(() => win && moveToDisplay(win, d, settings.get().fullscreen), 800)
    buildTrayMenu()
  })
  screen.on('display-removed', () => buildTrayMenu())

  watchForUpdates((u) => {
    update = u
    buildTrayMenu()
    send('update:available', u)
  })

  tray = new Tray(trayIcon())
  tray.setToolTip('Lyrique — synced lyrics')
  tray.on('click', () => showWindow())
  buildTrayMenu()
  updateMenuBarLyrics()

  win = createWindow()
  if (settings.get().mini) setMini(true)
  // Works from any app; silently skipped if another app already owns the shortcut.
  globalShortcut.register(MINI_SHORTCUT, () => setMini(!mini))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
    else win?.show()
  })
  app.on('second-instance', () => showWindow())
})

// Keep running in the menu bar / notification area when the window is closed.
app.on('window-all-closed', () => {
  if (!tray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  native.stop()
  bridge?.stop()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
