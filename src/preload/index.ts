import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AutoOffset, ConnectionStatus, Lyrics, PlayerState, Settings, SubMode, TrackInfo, UserSyncState } from '../shared/types'

type Unsub = () => void
function on<T>(channel: string, cb: (payload: T) => void): Unsub {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export interface SetupStatus {
  webStoreUrl: string
  /** Installed from the Microsoft Store. */
  store: boolean
  packaged: boolean
  openAtLogin: boolean
  extensionConnected: boolean
  /** Spotify / Apple Music being followed directly, if any. */
  nativePlayer: string | null
  playing: boolean
  bridgeUpToDate: boolean
  extensionPath: string
}

export interface TrackChanged {
  track: TrackInfo
  offsetMs: number
  globalOffsetMs: number
  autoOffset: AutoOffset | null
}

export interface PickerCandidate {
  id: string
  source: string
  title: string
  artist: string
  album: string
  duration: number
  kind: 'word' | 'synced' | 'unreliable' | 'plain' | 'instrumental' | 'unknown'
  preview: string
  paired: boolean
  score: number
}

export interface PickerList {
  candidates: PickerCandidate[]
  youtube: { kind: string } | null
  pickedId: string | null
  showing: string
}

export interface SettingsInfo {
  version: string
  packaged: boolean
  /** Installed from the Microsoft Store. */
  store: boolean
  openAtLogin: boolean
  systemLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string }>
  mini: boolean
  extensionConnected: boolean
  following: string | null
  update: string | null
  /** Interface languages, each named in itself. */
  locales: Array<{ code: string; name: string }>
  /** The interface language macOS's settings point to. */
  systemLocale: string
  autoWhatsNew: boolean
  platform: string
}

export interface MiniInit {
  state: PlayerState | null
  track: TrackInfo | null
  lyrics: Lyrics | null
  artwork: string
  settings: Settings
  connected: boolean
}

const api = {
  /** Interface language for this window, decided by the app at start. */
  locale: ipcRenderer.sendSync('i18n:locale') as string,
  /** 'darwin', 'win32' or 'linux'. */
  platform: process.platform as string,
  onPlayerState: (cb: (s: PlayerState) => void) => on<PlayerState>('player:state', cb),
  onTrackChanged: (cb: (t: TrackChanged) => void) => on<TrackChanged>('track:changed', cb),
  onTrackArtwork: (cb: (a: { videoId: string; artwork: string }) => void) =>
    on<{ videoId: string; artwork: string }>('track:artwork', cb),
  onTrackLyrics: (cb: (l: { videoId: string; lyrics: Lyrics }) => void) =>
    on<{ videoId: string; lyrics: Lyrics }>('track:lyrics', cb),
  onAutoOffset: (cb: (a: { videoId: string; auto: AutoOffset }) => void) =>
    on<{ videoId: string; auto: AutoOffset }>('track:autoOffset', cb),
  onUserSync: (cb: (u: { videoId: string; state: UserSyncState }) => void) =>
    on<{ videoId: string; state: UserSyncState }>('track:userSync', cb),
  onBridgeOutdated: (cb: (outdated: boolean) => void) => on<boolean>('bridge:outdated', cb),
  isBridgeOutdated: (): Promise<boolean> => ipcRenderer.invoke('bridge:isOutdated'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('app:copyText', text),
  getSetupStatus: (): Promise<SetupStatus> => ipcRenderer.invoke('setup:status'),
  setOpenAtLogin: (on: boolean): Promise<void> => ipcRenderer.invoke('setup:setOpenAtLogin', on),
  finishSetup: (): Promise<void> => ipcRenderer.invoke('setup:done'),
  showSetup: (): Promise<void> => ipcRenderer.invoke('setup:show'),
  settingsInfo: (): Promise<SettingsInfo> => ipcRenderer.invoke('settings:info'),
  onShowSettings: (cb: () => void) => on<null>('settings:show', () => cb()),
  onShowShortcuts: (cb: () => void) => on<null>('keys:show', () => cb()),
  onShowWhatsNew: (cb: () => void) => on<null>('whatsnew:show', () => cb()),
  onKaraoke: (cb: () => void) => on<null>('karaoke:toggle', () => cb()),
  onSetupChanged: (cb: (s: SetupStatus) => void) => on<SetupStatus>('setup:changed', cb),
  onSetupShow: (cb: (s: SetupStatus) => void) => on<SetupStatus>('setup:show', cb),
  onUpdate: (cb: (u: { version: string; url: string }) => void) => on<{ version: string; url: string }>('update:available', cb),
  getUpdate: (): Promise<{ version: string; url: string } | null> => ipcRenderer.invoke('update:get'),
  onFullscreen: (cb: (on: boolean) => void) => on<boolean>('window:fullscreen', cb),
  onWindowVisible: (cb: (visible: boolean) => void) => on<boolean>('window:visible', cb),
  onBridgeStatus: (cb: (s: ConnectionStatus) => void) => on<ConnectionStatus>('bridge:status', cb),
  onSettingsChanged: (cb: (s: Settings) => void) => on<Settings>('settings:changed', cb),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  patchSettings: (p: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:patch', p),
  setTrackOffset: (videoId: string, ms: number): Promise<Settings> => ipcRenderer.invoke('offset:set', videoId, ms),
  refetchLyrics: (): Promise<void> => ipcRenderer.invoke('lyrics:refetch'),
  lyricsCandidates: (): Promise<PickerList | null> => ipcRenderer.invoke('lyrics:candidates'),
  chooseLyrics: (id: string): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('lyrics:choose', id),
  replayTrack: (): Promise<void> => ipcRenderer.invoke('track:replay'),
  seek: (seconds: number): Promise<void> => ipcRenderer.invoke('player:seek', seconds),
  command: (action: 'playPause' | 'next' | 'previous'): Promise<void> => ipcRenderer.invoke('player:command', action),
  saveUserLyrics: (videoId: string, lrc: string): Promise<boolean> => ipcRenderer.invoke('lyrics:saveUser', videoId, lrc),
  setUserSync: (videoId: string, action: 'use' | 'original' | 'delete'): Promise<void> =>
    ipcRenderer.invoke('lyrics:userSync', videoId, action),
  getUserLyrics: (videoId: string): Promise<{ lines: string[]; stamps: number[] } | null> =>
    ipcRenderer.invoke('lyrics:userGet', videoId),
  publishLyrics: (videoId: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('lyrics:publish', videoId),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('window:toggleFullscreen'),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullscreen'),
  getStatus: (): Promise<ConnectionStatus> => ipcRenderer.invoke('status:get'),
  getLastState: (): Promise<PlayerState | null> => ipcRenderer.invoke('player:last'),
  openExtensionFolder: (): Promise<void> => ipcRenderer.invoke('app:openExtensionFolder'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  /** Romanization / translation for each line (null where there's nothing to show). */
  subtitles: (lines: string[], mode: SubMode): Promise<{ lines: Array<string | null>; note?: string }> =>
    ipcRenderer.invoke('lyrics:sub', lines, mode),
  stepTextScale: (dir: 1 | -1 | 0): Promise<void> => ipcRenderer.invoke('text:step', dir),
  setMini: (on: boolean): Promise<void> => ipcRenderer.invoke('mini:set', on),
  isMini: (): Promise<boolean> => ipcRenderer.invoke('mini:get'),
  onMini: (cb: (on: boolean) => void) => on<boolean>('mini:changed', cb),
  miniInit: (): Promise<MiniInit> => ipcRenderer.invoke('mini:init'),
  showMain: (): Promise<void> => ipcRenderer.invoke('window:show'),
  copyDiagnostics: (): Promise<void> => ipcRenderer.invoke('app:copyDiagnostics'),
  logProblem: (where: string, message: string): Promise<void> => ipcRenderer.invoke('log:problem', where, message),
  /** Which audio output is playing, so the menu-bar lyrics use its delay too. */
  reportAudioDevice: (name: string): Promise<void> => ipcRenderer.invoke('audio:device', name),
  copyImage: (dataUrl: string): Promise<void> => ipcRenderer.invoke('app:copyImage', dataUrl),
  saveImage: (dataUrl: string, name: string): Promise<boolean> => ipcRenderer.invoke('app:saveImage', dataUrl, name)
}

export type LyriqueApi = typeof api

contextBridge.exposeInMainWorld('lyrique', api)
