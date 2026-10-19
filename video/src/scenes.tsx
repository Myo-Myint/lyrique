import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { C, Logo } from './brand'
import { Chip, clamp, Copy, ease, Frame, Key, Stage, TrafficLights, useEnter, useProgress, Wipe } from './ui'

/** A one-shot sound effect at `at` frames into the scene (files from audio/make_audio.py). */
function Sfx({ name, at, volume }: { name: string; at: number; volume: number }) {
  return (
    <Sequence from={at} layout="none">
      <Audio src={staticFile(`audio/sfx-${name}.wav`)} volume={volume} />
    </Sequence>
  )
}

/** A recorded app clip filling its window; `zoom` pushes in towards `origin`. */
function Clip({ name, from = 0, zoom = 0, origin = '50% 50%' }: { name: string; from?: number; zoom?: number; origin?: string }) {
  return (
    <OffthreadVideo
      src={staticFile(`clips/${name}.mp4`)}
      startFrom={from}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover', transformOrigin: origin, transform: `scale(${1 + zoom})` }}
    />
  )
}

// ------------------------------------------------------------------ intro: product reveal

export function Intro() {
  const frame = useCurrentFrame()
  const fly = useEnter(0, { damping: 18, mass: 1, stiffness: 70 })
  const back = useProgress(57, 93)
  const scale = interpolate(back, [0, 1], [interpolate(fly, [0, 1], [0.45, 1.5]), 0.92]) + frame * 0.0002
  const copy = useEnter(75)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ perspective: 2200 }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 1040,
            height: 650,
            margin: '-325px 0 0 -520px',
            opacity: interpolate(frame, [0, 10], [0, 1], clamp),
            transform: `translate(${back * 330}px, ${(1 - fly) * 260}px) rotateX(${(1 - fly) * 38 + back * 3}deg) rotateY(${back * -8}deg) scale(${scale})`
          }}
        >
          <Frame>
            <Clip name="play" from={90} />
          </Frame>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 120, top: '50%', width: 560, opacity: copy, transform: `translateY(calc(-50% + ${(1 - copy) * 50}px))` }}>
        <Logo size={120} style={{ filter: 'drop-shadow(0 18px 30px rgba(90,60,140,0.25))', transform: `scale(${0.4 + useEnter(75, { damping: 13 }) * 0.6})`, transformOrigin: '0 50%' }} />
        <div style={{ marginTop: 30, fontSize: 120, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1 }}>
          <Wipe start={84} end={117}>Lyrique</Wipe>
        </div>
        <div style={{ marginTop: 26, fontSize: 34, color: C.dim, fontWeight: 500, opacity: useEnter(105) }}>Lyrics that move with your music.</div>
      </div>
      <Sfx name="swell" at={0} volume={0.08} />
      <Sfx name="landing" at={31} volume={0.44} />
      <Sfx name="pull" at={54} volume={0.056} />
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------------ step 1: download

function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" style={{ position: 'absolute', left: x, top: y, zIndex: 5, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.35))' }}>
      <path d="M4 2l16 10-7 1.5L9.5 21z" fill="#111" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function Browser({ url, children, right }: { url: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <Frame lights={false} style={{ background: '#fff' }}>
      <div style={{ height: 72, background: '#f1eee9', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 22 }}>
        <TrafficLights style={{ position: 'static' }} />
        <div style={{ flex: 1, height: 44, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', padding: '0 20px', fontSize: 22, color: '#2b2a30', fontWeight: 500 }}>{url}</div>
        {right}
      </div>
      <div style={{ position: 'absolute', top: 72, left: 0, right: 0, bottom: 0 }}>{children}</div>
    </Frame>
  )
}

export function Download() {
  const frame = useCurrentFrame()
  const url = 'lyrique.app'
  const typed = url.slice(0, Math.floor(interpolate(frame, [27, 60], [0, url.length], clamp)))
  const caret = Math.floor(frame / 14) % 2 ? 0 : 1
  const move = useEnter(72, { damping: 26, stiffness: 70 })
  const click = interpolate(frame, [111, 114, 120], [0, 1, 0], clamp)
  return (
    <AbsoluteFill>
      <Copy step="Step 1" title="Download it. Free." sub="Get Lyrique for Mac, or the Windows beta. No account, no ads." />
      <Stage>
        <Browser
          url={
            <>
              {typed}
              <span style={{ display: 'inline-block', width: 2, height: 26, background: '#2b2a30', marginLeft: 2, opacity: caret }} />
            </>
          }
        >
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at 30% 20%, rgba(255,154,107,0.28), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(124,196,255,0.3), transparent 60%)' }}>
            <Logo size={120} />
            <div style={{ marginTop: 26, fontSize: 58, fontWeight: 600, letterSpacing: '-0.035em' }}>Lyrique</div>
            <div style={{ marginTop: 10, fontSize: 24, color: C.dim }}>Synced, word-by-word lyrics</div>
            <div style={{ marginTop: 36, display: 'flex', gap: 18 }}>
              <div style={{ padding: '18px 32px', borderRadius: 999, fontSize: 24, fontWeight: 600, background: C.ink, color: '#fff', transform: `scale(${1 - click * 0.06})`, boxShadow: `0 0 ${click * 40}px rgba(228,87,46,${click * 0.5})` }}>Download for Mac</div>
              <div style={{ padding: '18px 32px', borderRadius: 999, fontSize: 24, fontWeight: 600, background: '#fff', border: '1px solid rgba(0,0,0,0.12)' }}>Windows (beta)</div>
            </div>
          </div>
          <Cursor x={interpolate(move, [0, 1], [900, 380])} y={interpolate(move, [0, 1], [500, 380])} />
        </Browser>
      </Stage>
      <Sfx name="click" at={111} volume={0.18} />
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------------ step 2: play

export function Play() {
  const push = useProgress(96, 150)
  return (
    <AbsoluteFill>
      <Copy step="Step 2" title="Play any song." sub="Spotify and Apple Music are picked up on their own. Lyrics light up word by word.">
        <Chip delay={30}>Spotify</Chip>
        <Chip delay={35}>Apple Music</Chip>
        <Chip delay={40}>YouTube Music</Chip>
      </Copy>
      <Stage>
        <Frame>
          <Clip name="play" zoom={push * 0.35} origin="30% 45%" />
        </Frame>
      </Stage>
      <Sfx name="pull" at={92} volume={0.064} />
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------------ YouTube Music: Lyrique Bridge

export function Bridge() {
  const frame = useCurrentFrame()
  const press = interpolate(frame, [48, 51, 57], [0, 1, 0], clamp)
  const pop = useEnter(60, { damping: 15, stiffness: 140 })
  return (
    <AbsoluteFill>
      <Copy step="YouTube Music" title="Add Lyrique Bridge." sub="One small extension for Chrome, Edge, Brave or Arc. It tells Lyrique what's playing." />
      <Stage>
        <Browser url="music.youtube.com" right={<div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: `rgba(0,0,0,${0.04 + press * 0.1})`, transform: `scale(${1 - press * 0.15})` }}><Logo size={30} /></div>}>
          <div style={{ position: 'absolute', left: 60, top: 70, display: 'flex', gap: 30, alignItems: 'center' }}>
            <div style={{ width: 220, height: 220, borderRadius: 14, background: 'linear-gradient(135deg, #ff7a3d, #e5466b 50%, #2f8cff)', filter: 'blur(1px) saturate(1.2)' }} />
            <div>
              <div style={{ fontSize: 40, fontWeight: 600 }}>Glass Orchard</div>
              <div style={{ fontSize: 24, color: C.dim }}>Mara Vale · Ember</div>
            </div>
          </div>
          <div style={{ position: 'absolute', left: 60, right: 60, bottom: 70, height: 6, borderRadius: 3, background: '#e6e3de' }}>
            <div style={{ height: '100%', borderRadius: 3, background: '#ff0033', width: `${32 + frame * 0.04}%` }} />
          </div>
          <div style={{ position: 'absolute', right: 26, top: 12, width: 420, borderRadius: 18, background: '#fff', boxShadow: '0 30px 70px rgba(60,40,20,0.22), 0 0 0 1px rgba(0,0,0,0.08)', padding: 26, opacity: pop, transformOrigin: '90% 0', transform: `scale(${0.6 + pop * 0.4})` }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 26, fontWeight: 600 }}>
              <Logo size={48} />
              Lyrique Bridge
            </div>
            <div style={{ marginTop: 18, fontSize: 22, display: 'flex', alignItems: 'center', gap: 10, color: '#1f8a47' }}>
              <i style={{ width: 12, height: 12, borderRadius: '50%', background: '#2fd36b', display: 'block', boxShadow: '0 0 12px #2fd36b' }} />
              Connected to Lyrique
            </div>
          </div>
        </Browser>
      </Stage>
      <Sfx name="click" at={48} volume={0.16} />
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------------ tips

export function Karaoke() {
  return (
    <AbsoluteFill>
      <Copy step="Tip" title="Karaoke night." sub="Full screen, lyrics only, extra large. Perfect on a TV.">
        <Key label="K" appear={27} press={[48]} />
      </Copy>
      <Stage>
        <Frame lights={false}>
          <Clip name="karaoke" />
        </Frame>
      </Stage>
      <Sfx name="key" at={48} volume={0.16} />
    </AbsoluteFill>
  )
}

export function Romanize() {
  const push = useProgress(62, 104)
  return (
    <AbsoluteFill>
      <Copy step="Tip" title="Sing in any language." sub="Add romanization or a translation under every line.">
        <Key label="T" appear={27} press={[48]} />
      </Copy>
      <Stage>
        <Frame>
          <Clip name="romanize" zoom={push * 0.3} origin="20% 40%" />
        </Frame>
      </Stage>
      <Sfx name="key" at={48} volume={0.16} />
      <Sfx name="pull" at={60} volume={0.056} />
    </AbsoluteFill>
  )
}

export function Mini() {
  const frame = useCurrentFrame()
  const up = useEnter(45, { damping: 16, stiffness: 110 })
  const doc = (style: CSSProperties, bars: number[], tone: string) => (
    <div style={{ position: 'absolute', width: 600, height: 420, borderRadius: 14, padding: 40, boxShadow: '0 20px 50px rgba(60,40,20,0.15)', ...style }}>
      {bars.map((w, i) => (
        <i key={i} style={{ display: 'block', height: 16, borderRadius: 8, background: tone, marginBottom: 22, width: `${w}%` }} />
      ))}
    </div>
  )
  return (
    <AbsoluteFill>
      <Copy step="Tip" title="Lyrics while you work." sub="The mini bar floats over any app. ⌥⌘L from anywhere.">
        <Key label="M" appear={27} press={[42]} />
      </Copy>
      <Stage>
        <Frame lights={false} style={{ background: 'linear-gradient(135deg, #dfe9f5, #f3eee8 55%, #f5e4dc)' }}>
          {doc({ left: 70, top: 70, background: '#fff' }, [70, 100, 85, 100, 60], '#d8d4cc')}
          {doc({ left: 380, top: 150, background: '#fbfaf7' }, [55, 100, 75], '#e4e0d8')}
          <div style={{ position: 'absolute', left: 90, bottom: 50, width: 860, opacity: up, transform: `translateY(${(1 - up) * 90 + Math.sin(frame / 20) * 3}px) scale(${0.9 + up * 0.1})`, filter: 'drop-shadow(0 24px 40px rgba(60,40,20,0.3))' }}>
            <OffthreadVideo src={staticFile('clips/mini.webm')} transparent muted style={{ width: '100%', display: 'block' }} />
          </div>
        </Frame>
      </Stage>
      <Sfx name="key" at={42} volume={0.16} />
      <Sfx name="rise" at={44} volume={0.05} />
    </AbsoluteFill>
  )
}

export function Timing() {
  const frame = useCurrentFrame()
  const zoom = useProgress(34, 64) - interpolate(frame, [116, 132], [0, 1], { ...clamp, easing: ease })
  return (
    <AbsoluteFill>
      <Copy step="Tip" title="Off by a beat?" sub="Nudge this song's lyrics earlier or later. Lyrique remembers it.">
        <Key label="[" appear={27} press={[]} />
        <Key label="]" appear={31} press={[60, 88]} />
      </Copy>
      <Stage>
        <Frame>
          <Clip name="timing" zoom={zoom * 0.9} origin="93% 3%" />
        </Frame>
      </Stage>
      <Sfx name="pull" at={32} volume={0.056} />
      <Sfx name="key" at={60} volume={0.16} />
      <Sfx name="key" at={88} volume={0.15} />
    </AbsoluteFill>
  )
}

export function Settings() {
  const push = useProgress(24, 60)
  return (
    <AbsoluteFill>
      <Copy step="Make it yours" title="Everything else is in Settings." sub="Text size, fonts, players, languages and more.">
        <Key label="⌘ ," appear={20} press={[39]} wide />
      </Copy>
      <Stage>
        <Frame>
          <Clip name="settings" zoom={push * 0.7} origin="30% 30%" />
        </Frame>
      </Stage>
      <Sfx name="key" at={39} volume={0.16} />
      <Sfx name="swell" at={72} volume={0.08} />
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------------ outro

export function Outro() {
  const logo = useEnter(3, { damping: 13, stiffness: 120 })
  const url = useEnter(72, { damping: 14 })
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}
      from={-67}
    >
      <Logo size={200} style={{ transform: `scale(${0.3 + logo * 0.7})`, opacity: Math.min(1, logo * 2), filter: 'drop-shadow(0 30px 60px rgba(90,60,140,0.25))' }} />
      <div style={{ marginTop: 40, fontSize: 120, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1 }}>
        <Wipe start={15} end={54}>Lyrique</Wipe>
      </div>
      <div style={{ marginTop: 40, display: 'flex', gap: 16 }}>
        {['Free', 'Mac', 'Windows beta', 'Open source'].map((c, i) => (
          <Chip key={c} delay={42 + i * 4}>{c}</Chip>
        ))}
      </div>
      <div style={{ marginTop: 48, fontSize: 56, fontWeight: 600, letterSpacing: '-0.02em', padding: '18px 44px', borderRadius: 999, background: C.ink, color: '#fff', opacity: url, transform: `scale(${0.7 + url * 0.3})` }}>lyrique.app</div>
      <Sfx name="landing" at={2} volume={0.4} />
    </AbsoluteFill>
  )
}
