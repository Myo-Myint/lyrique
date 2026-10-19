// Sets the rendered video's sound-effects track to a consistent peak level (-3 dBFS) without
// touching the picture. Peak, not loudness: effects-only audio is mostly silence, and loudness
// normalization would push the clicks far too loud. Usage: node scripts/loudnorm.mjs out/howto.mp4
import { execFileSync } from 'node:child_process'
import { renameSync } from 'node:fs'

const file = process.argv[2]
const probe = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }).toString()
const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(probe)?.[1] ?? 0)
const gain = (-3 - peak).toFixed(2)
const tmp = file.replace(/\.mp4$/, '.level.mp4')
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-c:v', 'copy', '-af', `volume=${gain}dB`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp], { stdio: 'inherit' })
renameSync(tmp, file)
console.log(`audio peak ${peak} dB → -3 dB (${gain} dB):`, file)
