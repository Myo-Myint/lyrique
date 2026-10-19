import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions'
import { AbsoluteFill, interpolate } from 'remotion'

/** Fade through: the old scene fades out in the first half, the new one fades in during the
 *  second half, so two scenes' text and windows never sit on top of each other. */
function Dip({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, never>>) {
  const p = presentationProgress
  const opacity =
    presentationDirection === 'exiting'
      ? interpolate(p, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' })
      : interpolate(p, [0.5, 1], [0, 1], { extrapolateLeft: 'clamp' })
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

export const dip = (): TransitionPresentation<Record<string, never>> => ({ component: Dip, props: {} })
