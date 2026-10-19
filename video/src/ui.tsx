import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C } from './brand'

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
export const ease = Easing.bezier(0.33, 0, 0.2, 1)

/** 0 → 1 between two frames, eased. */
export function useProgress(from: number, to: number) {
  const frame = useCurrentFrame()
  return interpolate(frame, [from, to], [0, 1], { ...clamp, easing: ease })
}

/** A calm spring that starts at `delay` frames. */
export function useEnter(delay = 0, config: { damping?: number; mass?: number; stiffness?: number } = {}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping: 200, ...config } })
}

/** Soft warm and blue light drifting behind everything. */
export function Background() {
  const frame = useCurrentFrame()
  const t = frame / 30
  const blob = (color: string, x: number, y: number, opacity: number): CSSProperties => ({
    position: 'absolute',
    width: 1400,
    height: 1400,
    borderRadius: '50%',
    filter: 'blur(150px)',
    opacity,
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
    transform: `translate(${x}px, ${y}px)`
  })
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <div style={blob('#ff9a6b', -300 + Math.sin(t * 0.21) * 220, -500 + Math.cos(t * 0.17) * 160, 0.38)} />
      <div style={blob('#7cc4ff', 900 + Math.cos(t * 0.19) * 240, 100 + Math.sin(t * 0.23) * 180, 0.38)} />
      <div style={blob('#c3a6ff', 300 + Math.sin(t * 0.13) * 300, 300 + Math.cos(t * 0.11) * 200, 0.3)} />
    </AbsoluteFill>
  )
}

/** Headline that fills in like a sung lyric line: a dim copy, and a solid copy revealed by a
 *  soft-edged mask. (background-clip:text paints as a box in desktop Chrome while a parent fades.) */
export function Wipe({ children, start, end, style }: { children: ReactNode; start: number; end: number; style?: CSSProperties }) {
  const p = useProgress(start, end) * 106
  const mask = `linear-gradient(90deg, #000 0%, #000 ${p}%, transparent ${p + 6}%)`
  return (
    <span style={{ position: 'relative', display: 'inline-block', ...style }}>
      <span style={{ color: 'rgba(23,22,28,0.2)' }}>{children}</span>
      <span aria-hidden style={{ position: 'absolute', inset: 0, color: C.ink, WebkitMaskImage: mask, maskImage: mask }}>
        {children}
      </span>
    </span>
  )
}

export function Key({ label, appear, press, wide }: { label: string; appear: number; press: number[]; wide?: boolean }) {
  const frame = useCurrentFrame()
  const shown = useEnter(appear, { damping: 14, stiffness: 160 })
  // Each press: down fast, back up with a little spring.
  const down = press.reduce((d, at) => Math.max(d, interpolate(frame, [at, at + 2, at + 4, at + 10], [0, 1, 1, 0], clamp)), 0)
  return (
    <div
      style={{
        minWidth: 92,
        height: 92,
        padding: wide ? '0 26px' : 0,
        borderRadius: 22,
        background: 'linear-gradient(180deg, #ffffff, #efece7)',
        border: '1px solid rgba(0,0,0,0.08)',
        color: C.ink,
        fontSize: wide ? 38 : 46,
        fontWeight: 600,
        display: 'grid',
        placeItems: 'center',
        opacity: Math.min(1, shown * 1.5),
        boxShadow: `0 ${8 - down * 6}px 0 #d3cec6, 0 18px 40px rgba(60,40,20,0.18)`,
        transform: `translateY(${down * 6}px) scale(${interpolate(shown, [0, 1], [0.5, 1]) - down * 0.06})`
      }}
    >
      {label}
    </div>
  )
}

export function Chip({ children, delay }: { children: ReactNode; delay: number }) {
  const s = useEnter(delay, { damping: 16 })
  return (
    <div
      style={{
        whiteSpace: 'nowrap',
        padding: '12px 22px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.75)',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 6px 20px rgba(60,40,20,0.08)',
        fontSize: 22,
        fontWeight: 600,
        opacity: s,
        transform: `translateY(${(1 - s) * 18}px) scale(${0.85 + s * 0.15})`
      }}
    >
      {children}
    </div>
  )
}

/** Left column: small label, a headline that fills in, a line of explanation, then extras (keys, chips). */
export function Copy({ step, title, sub, children }: { step: string; title: string; sub: string; children?: ReactNode }) {
  const s = useEnter(0)
  const subIn = useEnter(14)
  return (
    <div style={{ position: 'absolute', left: 120, top: '50%', width: 600, transform: `translateY(calc(-50% + ${(1 - s) * 50}px))`, opacity: s }}>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.accent, marginBottom: 22 }}>{step}</div>
      <div style={{ fontSize: 72, lineHeight: 1.04, fontWeight: 600, letterSpacing: '-0.035em' }}>
        <Wipe start={6} end={40}>{title}</Wipe>
      </div>
      <div style={{ marginTop: 26, fontSize: 30, lineHeight: 1.35, color: C.dim, fontWeight: 500, opacity: subIn, transform: `translateY(${(1 - subIn) * 18}px)` }}>{sub}</div>
      {children ? <div style={{ marginTop: 40, display: 'flex', gap: 14, flexWrap: 'wrap' }}>{children}</div> : null}
    </div>
  )
}

/** A Mac window that swings in from the right in 3D, then drifts slowly. */
export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame()
  const s = useEnter(0, { damping: 20, mass: 1.1, stiffness: 90 })
  return (
    <AbsoluteFill style={{ perspective: 2200 }}>
      <div
        style={{
          position: 'absolute',
          right: 100,
          top: '50%',
          width: 1040,
          height: 650,
          marginTop: -325,
          transform: `translateX(${(1 - s) * 260 - frame * 0.12}px) rotateY(${-26 + s * 20}deg) rotateX(${8 - s * 6}deg) scale(${0.86 + s * 0.14 + frame * 0.0002})`,
          ...style
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  )
}

export function Frame({ children, lights = true, style }: { children: ReactNode; lights?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 22, overflow: 'hidden', background: '#111', boxShadow: `0 40px 100px ${C.shadow}, 0 0 0 1px rgba(0,0,0,0.06)`, ...style }}>
      {lights ? <TrafficLights /> : null}
      {children}
    </div>
  )
}

export function TrafficLights({ style }: { style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', left: 20, top: 18, display: 'flex', gap: 9, zIndex: 2, ...style }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <i key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c, display: 'block' }} />
      ))}
    </div>
  )
}
