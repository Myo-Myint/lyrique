/**
 * Playback clock fed by sparse position samples from the extension.
 *
 * Extrapolates on the renderer's monotonic clock (performance.now), anchored when each
 * sample arrives. Small disagreements are blended in over SLEW_MS so the highlight never
 * jitters; large ones (seeks, ≥150 ms drift, any backward step >50 ms) and play/pause/rate
 * changes snap. While playing, displayed time never moves backwards except on a snap.
 * Thresholds follow Spices (75 ms) and AMLL's seek detector (150 ms).
 */
export const SNAP_MS = 150
export const BACKSTEP_MS = 50
export const SLEW_MS = 300
const MAX_TRANSIT_MS = 250
/** After you press play/pause, how long to wait for the player to report the same. */
export const EXPECT_MS = 2000

export interface ClockSample {
  position: number // seconds
  playing: boolean
  rate: number
  duration: number
  /** Sender wall clock (ms). Same machine, so arrival − sentAt ≈ transit delay. */
  sentAt: number
}

export class PlaybackClock {
  private has = false
  private anchorPos = 0 // seconds
  private anchorT = 0 // performance.now() ms
  private playing = false
  private rate = 1
  private duration = 0
  private slew = 0 // seconds still being blended in
  private slewStart = 0
  private lastShown = -Infinity
  private expectPlaying: boolean | null = null
  private expectUntil = 0

  get isPlaying(): boolean {
    return this.playing
  }

  private base(t: number): number {
    return this.playing ? this.anchorPos + ((t - this.anchorT) / 1000) * this.rate : this.anchorPos
  }

  private raw(t: number): number {
    const k = Math.min(1, Math.max(0, (t - this.slewStart) / SLEW_MS))
    return this.base(t) + this.slew * k
  }

  /** Feed a sample. Returns true when the clock jumped (seek, resume, …). */
  sample(s: ClockSample, t = performance.now(), wallNow = Date.now()): boolean {
    if (this.expectPlaying !== null) {
      // Samples taken before the player acted on your play/pause would undo it for a moment.
      if (t < this.expectUntil && s.playing !== this.expectPlaying) return false
      this.expectPlaying = null
    }
    const rate = s.rate || 1
    const transit = Math.min(MAX_TRANSIT_MS, Math.max(0, wallNow - s.sentAt))
    const expected = s.position + (s.playing ? (transit / 1000) * rate : 0)
    this.duration = s.duration
    if (!this.has || s.playing !== this.playing || rate !== this.rate || !s.playing) {
      const jumped = !this.has || Math.abs(expected - this.raw(t)) * 1000 >= SNAP_MS
      this.snap(expected, s.playing, rate, t)
      return jumped
    }
    const cur = this.raw(t)
    const errMs = (expected - cur) * 1000
    if (Math.abs(errMs) >= SNAP_MS || errMs < -BACKSTEP_MS) {
      this.snap(expected, true, rate, t)
      return true
    }
    // Fold what's displayed into the anchor and blend the new error in.
    this.anchorPos = cur
    this.anchorT = t
    this.slew = expected - cur
    this.slewStart = t
    return false
  }

  private snap(pos: number, playing: boolean, rate: number, t: number): void {
    this.has = true
    this.anchorPos = pos
    this.anchorT = t
    this.playing = playing
    this.rate = rate
    this.slew = 0
    this.lastShown = -Infinity
  }

  /** Current position in seconds. */
  now(t = performance.now()): number {
    if (!this.has) return 0
    let p = this.raw(t)
    if (this.duration) p = Math.min(p, this.duration)
    if (this.playing) {
      p = Math.max(p, this.lastShown)
      this.lastShown = p
    }
    return p
  }

  /** You pressed play/pause: stop or start right here, before the player confirms. */
  expect(playing: boolean, t = performance.now()): void {
    if (!this.has) return
    this.snap(this.now(t), playing, this.rate, t)
    this.expectPlaying = playing
    this.expectUntil = t + EXPECT_MS
  }

  reset(): void {
    this.has = false
  }
}
