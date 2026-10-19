import { useEffect, useState } from 'react'
import { cancelRender, Composition, continueRender, delayRender, staticFile } from 'remotion'
import { HowTo } from './HowTo'
import { FPS, TOTAL } from './timing'

/** Waits for SF Pro (copied into public/fonts by scripts/prepare.mjs) before any frame renders. */
function useSfPro() {
  const [handle] = useState(() => delayRender('Loading SF Pro'))
  useEffect(() => {
    const face = new FontFace('SF Pro', `url(${staticFile('fonts/SFNS.ttf')})`, { weight: '1 1000' })
    face
      .load()
      .then((f) => {
        document.fonts.add(f)
        continueRender(handle)
      })
      .catch((err) => {
        console.warn('SF Pro missing, using the system font', err)
        continueRender(handle)
      })
      .catch(cancelRender)
  }, [handle])
}

export function Root() {
  useSfPro()
  return <Composition id="HowTo" component={HowTo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
}
