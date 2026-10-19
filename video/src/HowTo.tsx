import { linearTiming, TransitionSeries } from '@remotion/transitions'
import { Fragment } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { FONT } from './brand'
import { dip } from './dip'
import { Bridge, Download, Intro, Karaoke, Mini, Outro, Play, Romanize, Settings, Timing } from './scenes'
import { ORDER, SCENES, STARTS, TOTAL, TRANSITION } from './timing'
import { Background, clamp } from './ui'

const VIEWS = { intro: Intro, download: Download, play: Play, bridge: Bridge, karaoke: Karaoke, romanize: Romanize, mini: Mini, timing: Timing, settings: Settings, outro: Outro }

export function HowTo() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#17161c', WebkitFontSmoothing: 'antialiased' }}>
      <Background />
      <TransitionSeries>
        {ORDER.map((name, i) => {
          const View = VIEWS[name]
          return (
            <Fragment key={name}>
              {i > 0 ? <TransitionSeries.Transition presentation={dip()} timing={linearTiming({ durationInFrames: TRANSITION })} /> : null}
              <TransitionSeries.Sequence durationInFrames={SCENES[name]}>
                <View />
              </TransitionSeries.Sequence>
            </Fragment>
          )
        })}
      </TransitionSeries>

      {/* A soft swish into each step. */}
      {ORDER.slice(1, -1).map((name, i) => (
        <Sequence key={name} from={STARTS[name] - 15} layout="none">
          <Audio src={staticFile(`audio/sfx-${i % 2 ? 'air-back' : 'air'}.wav`)} volume={0.048} />
        </Sequence>
      ))}

      {/* Progress along the bottom, and a gentle fade out at the very end. */}
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 56, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.07)' }}>
        <div style={{ height: '100%', borderRadius: 2, width: `${(frame / TOTAL) * 100}%`, background: 'linear-gradient(90deg, #e4572e, #2e7dff)' }} />
      </div>
      <AbsoluteFill style={{ background: '#f7f4ef', opacity: interpolate(frame, [TOTAL - 18, TOTAL], [0, 1], clamp), pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}
