// Screencast frames (variable rate, time-stamped) to a steady 30 fps video.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh } from '../util.mjs'

/**
 * `frames` are `{ file, t }` in recorder time, already filtered for cuts and
 * re-timed. Each frame is held until the next one; the video starts at t=0
 * (the first frame is cloned back to zero if it arrived late) and ends at `end`.
 */
export function framesToMp4(frames, end, out, dir, { width = 1440, height = 900 } = {}) {
  let list = ''
  for (let i = 0; i < frames.length; i++) {
    const d = (i + 1 < frames.length ? frames[i + 1].t : end) - frames[i].t
    list += `file '${frames[i].file}'\nduration ${Math.max(d, 0.001).toFixed(4)}\n`
  }
  list += `file '${frames[frames.length - 1].file}'\n`
  const listFile = join(dir, 'frames.txt')
  writeFileSync(listFile, list)
  const start = frames[0].t
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-vf',
    `scale=${width < 600 ? width * 2 : width}:${width < 600 ? height * 2 : height}:flags=lanczos,fps=30,tpad=start_duration=${start.toFixed(3)}:start_mode=clone,format=yuv420p`,
    '-t',
    end.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '14',
    '-f',
    'mp4',
    out,
  ])
}
