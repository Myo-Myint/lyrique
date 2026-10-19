// Gets everything the video needs into public/ (all of it git-ignored):
//   fonts/  Apple's SF Pro, copied from this Mac (it can't be redistributed)
//   clips/  the app recordings from ../scripts/howto-clips.mjs, encoded at 30 fps
//   audio/  sound effects from audio/make_audio.py
// Usage: node scripts/prepare.mjs [clipsDir]   (default ../dist/howto, made by
//   `npm run build && node scripts/howto-clips.mjs dist/howto` in the app folder)
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const clipsDir = process.argv[2] ?? join(root, '..', 'dist', 'howto')

// 1. Fonts
mkdirSync(join(pub, 'fonts'), { recursive: true })
const SF = '/System/Library/Fonts/SFNS.ttf'
if (existsSync(SF)) copyFileSync(SF, join(pub, 'fonts', 'SFNS.ttf'))
else console.warn('SF Pro not found (not a Mac?): the video falls back to the system sans-serif.')

// 2. Clips: frames.txt holds each frame's real duration; resample to a steady 30 fps.
mkdirSync(join(pub, 'clips'), { recursive: true })
const ffmpeg = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
for (const name of ['play', 'karaoke', 'timing', 'romanize', 'settings']) {
  const list = join(clipsDir, name, 'frames.txt')
  if (!existsSync(list)) throw new Error(`Missing ${list}: record the clips first (see the comment at the top).`)
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1600:1000:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', join(pub, 'clips', `${name}.mp4`)])
  console.log('clip', name)
}
// The mini bar floats over other windows, so it keeps its transparency (VP9 with alpha).
ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(clipsDir, 'mini', 'frames.txt'), '-vf', 'fps=30,scale=1520:248:flags=lanczos,format=yuva420p',
  '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '18', '-auto-alt-ref', '0', join(pub, 'clips', 'mini.webm')])
console.log('clip mini')

// 3. Audio
execFileSync('python3', [join(root, 'audio', 'make_audio.py'), join(pub, 'audio')], { stdio: 'inherit' })
