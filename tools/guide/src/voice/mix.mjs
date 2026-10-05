// The soundtrack: a music bed, and voice lines over it when the short is voiced.
//
// A port of the mix the first voiced shorts were made with. Each line starts
// on its caption; a line that would overrun its step may be sped up by at most
// 6 percent, and beyond that the build stops and says which step needs more
// time (in this pipeline that cannot happen, because a voiced step is held
// until its line has finished). The music is ducked from 0.5 to 0.18 under
// each line with quarter-second ramps, the voice is normalised to -16 LUFS,
// and every stage is cut to the exact sample count of the video, so the audio
// never drifts from the picture at the end.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE } from '../paths.mjs'
import { cached } from '../cache.mjs'
import { duration, hash, sh } from '../util.mjs'

const SR = 48000

/** The per-short music, or a synthesised pad when none has been supplied. */
export async function musicFor(id, seconds) {
  const dir = process.env.GUIDE_MUSIC ?? join(CACHE, 'music')
  for (const ext of ['.mp3', '.wav', '.m4a']) {
    const f = join(dir, `${id}${ext}`)
    if (existsSync(f) && duration(f) >= seconds - 0.5) return f
  }
  return pad(Math.ceil(seconds) + 2)
}

/**
 * A soft ambient pad (Dmaj9, Bm7, Gmaj7, A6sus, nine seconds each), made
 * offline so a build never depends on a music service. Same recipe as the
 * first silent shorts used.
 */
export async function pad(secs) {
  return (
    await cached('music', `pad-${secs}`, '.wav', (tmp) => {
      const sr = 44100
      const n = Math.floor(sr * secs)
      const x = new Float32Array(n)
      const hz = (m) => 440 * 2 ** ((m - 69) / 12)
      const chords = [
        [50, 57, 62, 64, 66, 69],
        [47, 54, 57, 62, 66],
        [43, 50, 54, 59, 62, 66],
        [45, 52, 57, 59, 62, 64],
      ]
      const seg = 9
      for (let k = 0; k < secs / seg + 2; k++) {
        const start = k * seg - 2
        const ch = chords[k % 4]
        const a = Math.floor(Math.max(start, 0) * sr)
        const b = Math.min(Math.floor((start + seg + 4) * sr), n)
        const L = seg + 4
        for (let i = a; i < b; i++) {
          const tt = i / sr - start
          const env = Math.min(1, Math.max(0, Math.min(tt / 3.5, (L - tt) / 3.5))) ** 2
          let s = 0
          ch.forEach((m, j) => {
            for (const det of [-0.12, 0.12]) {
              const ph = 2 * Math.PI * hz(m) * (1 + det / 100) * tt + j
              s += Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.05 * Math.sin(3 * ph)
            }
          })
          x[i] += (env * s) / (ch.length * 2)
        }
      }
      let acc = 0
      for (let i = 0; i < n; i++) {
        x[i] *= 0.85 + 0.15 * Math.sin((2 * Math.PI * i) / sr / 13)
        acc += 0.06 * (x[i] - acc)
        x[i] = acc
      }
      const r = Float32Array.from(x)
      for (const [d, g] of [
        [0.113, 0.35],
        [0.197, 0.28],
        [0.311, 0.22],
        [0.433, 0.16],
        [0.61, 0.11],
      ]) {
        const s = Math.floor(d * sr)
        for (let i = n - 1; i >= s; i--) r[i] += g * x[i - s]
      }
      let peak = 1e-9
      for (const v of r) peak = Math.max(peak, Math.abs(v))
      const fade = 3 * sr
      const pcm = Buffer.alloc(n * 4)
      const lag = Math.floor(0.012 * sr)
      const at = (i) => {
        let v = (r[i] / peak) * 0.6
        if (i < fade) v *= i / fade
        if (i > n - fade) v *= (n - i) / fade
        return Math.round(v * 32767)
      }
      for (let i = 0; i < n; i++) {
        pcm.writeInt16LE(at(i), i * 4)
        pcm.writeInt16LE(at((i - lag + n) % n), i * 4 + 2)
      }
      const h = Buffer.alloc(44)
      h.write('RIFF', 0)
      h.writeUInt32LE(36 + pcm.length, 4)
      h.write('WAVEfmt ', 8)
      h.writeUInt32LE(16, 16)
      h.writeUInt16LE(1, 20)
      h.writeUInt16LE(2, 22)
      h.writeUInt32LE(sr, 24)
      h.writeUInt32LE(sr * 4, 28)
      h.writeUInt16LE(4, 32)
      h.writeUInt16LE(16, 34)
      h.write('data', 36)
      h.writeUInt32LE(pcm.length, 40)
      writeFileSync(tmp, Buffer.concat([h, pcm]))
    })
  ).path
}

/**
 * Builds the soundtrack for a video of `total` seconds into `out` (WAV).
 * `lines` are `{ wav, start, end }` in final-video seconds; empty for a silent short.
 */
export function soundtrack({ total, music, lines, out, work }) {
  const N = Math.round(total * SR)
  if (!lines.length) {
    // Silent short: the bed alone at -22 LUFS, measured first so the level is exact.
    const af = `aresample=${SR},atrim=end_sample=${N},afade=t=in:d=0.6,afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5`
    const probe = sh('bash', [
      '-c',
      `ffmpeg -hide_banner -nostdin -i '${music}' -af '${af},loudnorm=I=-22:TP=-2:LRA=11:print_format=json' -f null - 2>&1`,
    ])
    const j = JSON.parse(probe.slice(probe.lastIndexOf('{'), probe.lastIndexOf('}') + 1))
    sh('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      music,
      '-af',
      `${af},loudnorm=I=-22:TP=-2:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=${SR},apad=whole_len=${N},atrim=end_sample=${N}`,
      '-ac',
      '2',
      out,
    ])
    return []
  }
  const inputs = []
  const filt = []
  const labels = []
  const spans = []
  lines.forEach((l, k) => {
    const ld = duration(l.wav)
    const win = l.end - l.start - 0.2
    const tempo = Math.max(1, ld / win)
    if (tempo > 1.06)
      throw new Error(`voice line ${k + 1} needs ${tempo.toFixed(2)}x; give its step more time`)
    inputs.push('-i', l.wav)
    filt.push(
      `[${k}:a]aresample=${SR},atempo=${tempo.toFixed(4)},adelay=${Math.round(l.start * 1000)}:all=1[v${k}]`,
    )
    labels.push(`[v${k}]`)
    spans.push([l.start, l.start + ld / tempo])
  })
  const voice = join(work, 'voice.wav')
  filt.push(
    `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_len=${N},atrim=end_sample=${N},loudnorm=I=-16:TP=-2:LRA=7,aresample=${SR}[out]`,
  )
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    filt.join(';'),
    '-map',
    '[out]',
    '-ac',
    '1',
    voice,
  ])
  const [lo, hi, r] = [0.18, 0.5, 0.25]
  const terms = spans
    .map(
      ([a, b]) =>
        `max(0,min(1,min((t-${(a - r).toFixed(3)})/${r},(${(b + r).toFixed(3)}-t)/${r})))`,
    )
    .join('+')
  const env = `${hi}-(${hi}-${lo})*min(1,${terms})`
  const bed = join(work, 'music.wav')
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    music,
    '-af',
    `aresample=${SR},loudnorm=I=-20:TP=-3,aresample=${SR},atrim=end_sample=${N},volume='${env}':eval=frame,afade=t=in:d=0.6,afade=t=out:st=${(total - 1.8).toFixed(3)}:d=1.8,apad=whole_len=${N},atrim=end_sample=${N}`,
    '-ac',
    '2',
    bed,
  ])
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    voice,
    '-i',
    bed,
    '-filter_complex',
    `[0:a]pan=stereo|c0=c0|c1=c0[v];[v][1:a]amix=inputs=2:normalize=0,volume=-3dB,alimiter=limit=0.89,apad=whole_len=${N},atrim=end_sample=${N}[a]`,
    '-map',
    '[a]',
    out,
  ])
  return spans
}

export const soundKey = (parts) => hash(parts)
