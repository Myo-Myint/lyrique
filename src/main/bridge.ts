import { WebSocketServer, type WebSocket } from 'ws'
import type { PlayerState } from '../shared/types'

/** Audio feature frames from the extension: [mediaTime s, log10 mid, log10 side, flatness]. */
export interface ExtensionAudio {
  type: 'audio'
  videoId: string
  frames: Array<[number, number, number, number]>
}

/** Lyrics the extension pulled from YouTube Music's own lyrics tab. */
export interface ExtensionLyrics {
  type: 'lyrics'
  videoId: string
  source: string
  lines?: Array<{ text: string; startMs: number; endMs: number }>
  plain?: string
}

/**
 * Local WebSocket server the browser extension connects to.
 * Bound to loopback only; one message type ('state') flows in, 'hello' flows out.
 */
export class ExtensionBridge {
  private server: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  onState: ((s: PlayerState) => void) | null = null
  onLyrics: ((l: ExtensionLyrics) => void) | null = null
  onAudio: ((a: ExtensionAudio) => void) | null = null
  onConnection: ((connected: boolean) => void) | null = null

  constructor(private port: number) {}

  start(): void {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: this.port })
    this.server.on('connection', (ws, req) => {
      // Only accept browser-extension origins (chrome-extension://, safari-web-extension://) or none.
      const origin = req.headers.origin ?? ''
      if (origin && !/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) {
        ws.close(1008, 'origin not allowed')
        return
      }
      this.clients.add(ws)
      this.onConnection?.(true)
      ws.send(JSON.stringify({ type: 'hello', app: 'Lyrique', version: '0.1.0' }))
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string }
          if (msg.type === 'state') this.onState?.(msg as PlayerState)
          else if (msg.type === 'lyrics') this.onLyrics?.(msg as ExtensionLyrics)
          else if (msg.type === 'audio') this.onAudio?.(msg as ExtensionAudio)
          else if (msg.type === 'ping') ws.send('{"type":"pong"}')
        } catch {
          /* ignore malformed */
        }
      })
      const drop = () => {
        this.clients.delete(ws)
        if (this.clients.size === 0) this.onConnection?.(false)
      }
      ws.on('close', drop)
      ws.on('error', drop)
    })
    this.server.on('error', (err) => {
      console.error('[bridge] server error', err)
    })
  }

  /** Send a control message (e.g. seek) to every connected extension. */
  broadcast(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg)
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(data)
  }

  get connected(): boolean {
    return this.clients.size > 0
  }

  stop(): void {
    for (const c of this.clients) c.close()
    this.server?.close()
  }
}
