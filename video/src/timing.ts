/** Scene lengths in frames at 30 fps. Scenes overlap by TRANSITION frames (a crossfade). */
export const FPS = 30
export const TRANSITION = 12

export const SCENES = {
  intro: 150,
  download: 147,
  play: 192,
  bridge: 147,
  karaoke: 132,
  romanize: 132,
  mini: 132,
  timing: 132,
  settings: 105,
  outro: 144
} as const

export type SceneName = keyof typeof SCENES
export const ORDER = Object.keys(SCENES) as SceneName[]

/** Where each scene starts on the final timeline (audio/make_audio.py uses the same, in seconds). */
export const STARTS: Record<SceneName, number> = (() => {
  const out = {} as Record<SceneName, number>
  let at = 0
  for (const name of ORDER) {
    out[name] = at
    at += SCENES[name] - TRANSITION
  }
  return out
})()

export const TOTAL = ORDER.reduce((sum, n) => sum + SCENES[n], 0) - TRANSITION * (ORDER.length - 1)
