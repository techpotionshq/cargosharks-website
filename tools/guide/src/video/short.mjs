// One short, from its spec to an MP4, re-rendering only what changed.
//
// Three cached layers, each keyed by exactly what it is made from:
//
//   recording  the browser session, cuts applied, as a 1440x900 video plus the
//              marks, URLs and annotation checks. Keyed by the spec's actions,
//              the screens it visits (their source and catalogue entries), the
//              stack's data and the recorder's own code. NOT by caption text:
//              captions are not in the browser.
//   segment    one step, composited: the app in its window, the URL bar, the
//              caption burned in, and the step's hold. Keyed by the recording,
//              the step, its resolved caption text and (when voiced) the
//              length of its voice line.
//   voice line one caption spoken, keyed by its words (voice/tts.mjs).
//
// The final file is the segments joined without re-encoding, plus a freshly
// mixed soundtrack, which takes seconds. So editing one caption re-renders one
// segment and one voice line; changing a screen re-records the shorts that
// visit it and nothing else.
//
// The timing rule lives here: a caption stays on screen for at least
// words / 2.6 + 0.4 seconds (and, voiced, until its line has been spoken). A
// step shorter than that is held on the frame where its own content ends,
// annotation still drawn, before anything moves to the next screen.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cached, entry } from '../cache.mjs'
import { resolveCaption, expand, app } from '../catalog.mjs'
import { filesFingerprint, screen } from '../graph.mjs'
import { BRAND_KEY } from '../brand.mjs'
import { OUT } from '../paths.mjs'
import {
  assTime,
  captionMinimum,
  clock,
  duration,
  fileHash,
  hash,
  log,
  mkdirp,
  sh,
  srtTime,
} from '../util.mjs'
import { record } from '../record/session.mjs'
import { assColor, displayUrl, endCard, frame, phoneFrame, titleCard, urlBar } from './gfx.mjs'
import { musicFor, soundtrack } from '../voice/mix.mjs'
import { voiceLine } from '../voice/tts.mjs'

const FPS = 30
const INTRO = 1.5
const END = 2.0
const XF = 0.4
const ENC = [
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-r',
  String(FPS),
  '-g',
  '60',
  '-video_track_timescale',
  '15360',
]
const TOOL_FILES = ['recorder.mjs', 'annotate.mjs', 'browser.mjs']
  .map((f) => `tools/guide/src/record/${f}`)
  .concat(['tools/guide/src/video/frames.mjs', 'tools/guide/src/video/short.mjs'])
const COMPOSE_VERSION = 2

/** Everything a short's recording depends on, as a hash plus the parts (for `guide:stale`). */
export function recordingInputs(spec, specFile, stack) {
  const locale = spec.locale ?? 'en'
  const src = readFileSync(specFile, 'utf8')
  // `{app:key}` in a callout is drawn in the browser, so its text is part of the picture.
  const appKeys = [...new Set([...src.matchAll(/\{app:([\w.-]+)\}/g)].map((m) => m[1]))]
  const screens = (spec.routes ?? [spec.start]).map((r) => screen(r, locale))
  const parts = {
    spec: fileHash(specFile),
    screens: screens.map((s) => [s.route.url, s.fingerprint]),
    components: filesFingerprint(spec.components ?? []),
    appTexts: appKeys.map((k) => [k, app(k, locale)]),
    stack: stack.fingerprint(spec),
    tool: filesFingerprint(TOOL_FILES),
    brand: BRAND_KEY,
  }
  return { key: hash(parts), parts, screens, appKeys }
}

const escAss = (t) =>
  t.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N')

/** Composites one step into a finished 1920x1080 segment. */
async function composeSegment(seg, recDir, out, work) {
  const gfx = seg.phone ? await phoneFrame() : await frame()
  const bars = []
  if (!seg.phone) for (const u of seg.bars) if (!bars.includes(u.text)) bars.push(u.text)
  const barFiles = []
  for (const b of bars) barFiles.push(await urlBar(b))
  const back = await assColor()
  const lead = seg.first ? INTRO - XF : 0
  const ass = join(work, `${seg.index}.ass`)
  writeFileSync(
    ass,
    `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter SemiBold,40,&H00FFFFFF,&H00FFFFFF,${back},${back},0,0,0,0,100,100,0,0,3,14,0,2,200,200,34,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assTime(lead + 0.03)},${assTime(lead + seg.dur - 0.03)},Cap,,0,0,0,,${escAss(seg.caption)}
`,
  )
  const inputs = [
    '-loop',
    '1',
    '-i',
    gfx.bg,
    '-i',
    join(recDir, 'app.mp4'),
    '-loop',
    '1',
    '-i',
    gfx.shadow,
    '-loop',
    '1',
    '-i',
    gfx.mask,
    '-loop',
    '1',
    '-i',
    gfx.outline,
  ]
  for (const f of barFiles) inputs.push('-loop', '1', '-i', f)
  let k = 5 + barFiles.length
  const { a, h, b, freeze } = seg
  let f = ''
  if (b > h)
    f += `[1]split[s1][s2];[s1]trim=start_frame=${a}:end_frame=${h},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${freeze}[p1];[s2]trim=start_frame=${h}:end_frame=${b},setpts=PTS-STARTPTS[p2];[p1][p2]concat=n=2:v=1[raw];`
  else
    f += `[1]trim=start_frame=${a}:end_frame=${h},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${freeze}[raw];`
  const [aw, ah, ax, ay] = seg.phone ? [416, 900, 752, 40] : [1440, 900, 240, 68]
  f += `[raw]scale=${aw}:${ah}:flags=lanczos,format=rgba[app];[3]format=gray,scale=${aw}:${ah}[m];[app][m]alphamerge[appm];[0]format=rgba[bg];[bg][2]overlay[b1];[b1][appm]overlay=${ax}:${ay}[b2];`
  let last = 'b2'
  if (!seg.phone)
    seg.bars.forEach((u, i) => {
      const e = i + 1 < seg.bars.length ? seg.bars[i + 1].t : seg.dur + 1
      f += `[${last}][${5 + bars.indexOf(u.text)}]overlay=240:24:enable='between(t,${u.t.toFixed(3)},${e.toFixed(3)})'[u${i}];`
      last = `u${i}`
    })
  f += `[${last}][4]overlay,trim=end_frame=${seg.frames},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[main];`
  let body = 'main'
  if (seg.first) {
    inputs.push(
      '-loop',
      '1',
      '-t',
      String(INTRO),
      '-i',
      await titleCard(seg.kicker, seg.title, seg.sub),
    )
    f += `[${k++}]fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.4,settb=AVTB[tc];[main]settb=AVTB[mm];[tc][mm]xfade=transition=fade:duration=${XF}:offset=${(INTRO - XF).toFixed(3)}[wt];`
    body = 'wt'
  }
  if (seg.last) {
    inputs.push('-loop', '1', '-t', String(END), '-i', await endCard())
    const len = lead + seg.dur
    f += `[${k++}]fps=${FPS},format=yuv420p,fade=t=out:st=${END - 0.5}:d=0.5,settb=AVTB[ec];[${body}]settb=AVTB[bb];[bb][ec]xfade=transition=fade:duration=${XF}:offset=${(len - XF).toFixed(3)}[we];`
    body = 'we'
  }
  f += `[${body}]ass=${ass},format=yuv420p[v]`
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    f,
    '-map',
    '[v]',
    '-frames:v',
    String(seg.outFrames),
    ...ENC,
    '-f',
    'mp4',
    out,
  ])
}

/**
 * Builds a short. Returns timings and what was made or reused.
 * `opts.voice` builds the voiced cut (lines generated or taken from the cache).
 */
export async function buildShort(spec, specFile, stack, opts = {}) {
  const locale = spec.locale ?? 'en'
  const t0 = performance.now()
  const made = { recording: false, segments: [], voice: [] }
  const inputs = recordingInputs(spec, specFile, stack)
  const rec = await cached('rec', inputs.key, '', async (tmp) => {
    log(`${spec.id}: recording (${inputs.key})`)
    try {
      await record(spec, stack, tmp)
    } catch (e) {
      // A dev server that recompiles mid-take reloads the page under the
      // recorder. One more take, from the top, is cheaper than a human retry.
      log(`${spec.id}: take failed (${e.message.split('\n')[0]}); one more take`)
      await record(spec, stack, tmp)
    }
  })
  made.recording = !rec.hit
  const meta = JSON.parse(readFileSync(join(rec.path, 'meta.json'), 'utf8'))
  const totalFrames = Math.round(meta.end * FPS)
  const work = mkdirp(join(entry('work', spec.id)))

  const steps = spec.steps.map((s, i) => {
    const cap = resolveCaption(s.caption, locale)
    const start = meta.marks[i].t
    const next = i + 1 < meta.marks.length ? meta.marks[i + 1].t : meta.end
    return { s, i, cap, start, next, hold: meta.holds[i]?.t ?? next }
  })

  // Voice lines first: a voiced step is held until its line is done.
  const voices = []
  for (const st of steps) {
    if (!opts.voice) {
      voices.push(null)
      continue
    }
    const had = (await import('../voice/tts.mjs')).haveLine(st.cap.text)
    const wav = await voiceLine(st.cap.text, { allowGenerate: opts.generate !== false })
    if (!had) made.voice.push(st.s.id)
    voices.push({ wav, dur: duration(wav) })
  }

  const segFiles = []
  const timeline = []
  let cursor = 0
  for (const st of steps) {
    const { i, s, cap } = st
    const a = Math.round(st.start * FPS)
    const b = i + 1 < steps.length ? Math.round(st.next * FPS) : totalFrames
    const h = Math.min(b, Math.max(a + 1, Math.round(st.hold * FPS)))
    const recorded = (b - a) / FPS
    const v = voices[i]
    const need = Math.max(captionMinimum(cap.text), v ? v.dur + 0.35 : 0, s.minDur ?? 0)
    const freeze = Math.max(0, Math.ceil((need - recorded) * FPS))
    const frames = b - a + freeze
    const dur = frames / FPS
    const first = i === 0
    const last = i === steps.length - 1
    const lead = first ? INTRO - XF : 0
    // URL bars inside this segment, in segment time (after the hold point, shifted by the freeze).
    const local = (t) => {
      const fr = Math.round(t * FPS)
      return (fr < h ? fr - a : fr - a + freeze) / FPS
    }
    const bars = []
    const before = meta.urls.filter((u) => u.t <= st.start + 1e-6).pop() ?? meta.urls[0]
    bars.push({ t: 0, text: displayUrl(before.url) })
    for (const u of meta.urls) {
      if (u.t > st.start + 1e-6 && u.t < st.next) {
        const text = displayUrl(u.url)
        if (bars[bars.length - 1].text !== text) bars.push({ t: local(u.t), text })
      }
    }
    const outFrames = Math.round((lead + dur + (last ? END - XF : 0)) * FPS)
    const seg = {
      phone: meta.device === 'phone',
      index: i,
      a,
      h,
      b,
      freeze,
      frames,
      dur,
      outFrames,
      first,
      last,
      caption: cap.text,
      bars,
      title: expand(spec.title).text,
      sub: spec.sub ? expand(spec.sub).text : '',
      kicker: spec.kicker ?? `${expand('{brand}').text.toUpperCase()} IN ONE MINUTE`,
    }
    const key = hash({
      v: COMPOSE_VERSION,
      rec: inputs.key,
      seg: { ...seg, index: undefined },
      brand: BRAND_KEY,
    })
    const out = await cached('seg', key, '.mp4', (tmp) => composeSegment(seg, rec.path, tmp, work))
    if (!out.hit) made.segments.push(s.id)
    segFiles.push(out.path)
    const segStart = cursor
    cursor += outFrames / FPS
    timeline.push({
      id: s.id,
      text: cap.text,
      captionKey: cap.captionKey,
      start: segStart + lead + 0.03,
      end: segStart + lead + dur - 0.03,
      mark: st.start,
      segStart: segStart + lead,
      a,
      h,
      freeze,
      voice: v,
    })
  }

  // Join without re-encoding, then lay the soundtrack under it.
  const outDir = mkdirp(join(OUT, opts.voice ? 'shorts-voiced' : 'shorts'))
  const list = join(work, 'concat.txt')
  writeFileSync(list, segFiles.map((p) => `file '${p}'`).join('\n') + '\n')
  const joined = join(work, 'video.mp4')
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    joined,
  ])
  const total = duration(joined)
  const music = await musicFor(spec.music ?? spec.id, total)
  const audio = join(work, 'audio.wav')
  const spans = soundtrack({
    total,
    music,
    out: audio,
    work,
    lines: opts.voice
      ? timeline.map((t) => ({ wav: t.voice.wav, start: t.start, end: t.end }))
      : [],
  })
  const file = join(outDir, `${spec.id}.mp4`)
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    joined,
    '-i',
    audio,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    file,
  ])

  writeFileSync(
    join(outDir, `${spec.id}.srt`),
    timeline
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join('\n'),
  )
  writeFileSync(
    join(outDir, `${spec.id}-script.md`),
    `# ${spec.id}: script lines and timestamps

Generated by \`pnpm guide:build\`; edit the captions in \`docs/guide/captions/en.json\`, not here.
Times are in the final video. The step label changes on the same frame as the caption. Each
caption is held for at least words / 2.6 + 0.4 seconds.

| # | Step | Start | End | Line |
|---|---|---|---|---|
${timeline.map((c, i) => `| ${i + 1} | ${c.id} | ${clock(c.start)} | ${clock(c.end)} | ${c.text} |`).join('\n')}

Intro card 0:00.0 to 0:${INTRO.toFixed(1).padStart(4, '0')} ("${expand(spec.title).text}"), end card the last ${END} seconds.
`,
  )
  if (opts.voice) {
    // Where each line was placed against its caption, for anyone checking the sync.
    const { lineRecord } = await import('../voice/tts.mjs')
    writeFileSync(
      join(outDir, `${spec.id}-voice.json`),
      JSON.stringify(
        timeline.map((c, i) => ({
          step: c.id,
          text: c.text,
          captionStart: c.start,
          captionEnd: c.end,
          voiceStart: spans[i]?.[0],
          voiceEnd: spans[i]?.[1],
          check: lineRecord(c.text),
        })),
        null,
        1,
      ),
    )
  }
  const report = checkReport(meta, timeline)
  writeFileSync(join(outDir, `${spec.id}-check.txt`), report.text)
  if (opts.sheet) contactSheet(file, join(outDir, `${spec.id}-sheet`))
  const seconds = (performance.now() - t0) / 1000
  log(
    `${spec.id}: ${total.toFixed(1)}s video in ${seconds.toFixed(1)}s; recording ${made.recording ? 'made' : 'cached'}, segments made: ${made.segments.join(', ') || 'none'}${opts.voice ? `, voice made: ${made.voice.join(', ') || 'none'}` : ''}; annotation problems: ${report.problems}`,
  )
  return {
    id: spec.id,
    file,
    total,
    seconds,
    made,
    problems: report.problems,
    recordingKey: inputs.key,
  }
}

/** Annotation-vs-element measurements, with times in the final video. */
function checkReport(meta, timeline) {
  const at = (t) => {
    let i = 0
    while (i + 1 < timeline.length && timeline[i + 1].mark <= t + 1e-6) i++
    const seg = timeline[i]
    const fr = Math.round(t * FPS)
    const local = (fr < seg.h ? fr - seg.a : fr - seg.a + seg.freeze) / FPS
    return seg.segStart + local
  }
  const bad = meta.checks.filter(
    (c) =>
      c.boxErr > 3 ||
      (typeof c.endErr === 'number' && c.endErr > 3) ||
      c.endErr === 'gone' ||
      c.elementOffFrame ||
      c.calloutOffFrame,
  )
  const lines = meta.checks.map(
    (c) =>
      `${clock(at(c.t))}  box ${c.boxErr}px  end ${c.endErr}px  el(${c.el.x},${c.el.y},${c.el.w}x${c.el.h})  elOff ${c.elementOffFrame}  callOff ${c.calloutOffFrame}  side ${c.calloutSide ?? '-'}  ${c.label}`,
  )
  return { problems: bad.length, text: `${lines.join('\n')}\n\nPROBLEMS: ${bad.length}\n` }
}

/** A still every second with its timestamp, 20 to a sheet. */
export function contactSheet(video, prefix) {
  const dir = mkdirp(`${prefix}-frames`)
  sh('ffmpeg', [
    '-y',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    "fps=1,scale=640:360,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6",
    join(dir, '%03d.png'),
  ])
  sh('bash', [
    '-c',
    `cd '${dir}' && ls *.png | xargs -n 20 | { i=0; while read -a f; do montage "\${f[@]}" -tile 4x -geometry +2+2 '${prefix}'-$i.jpg; i=$((i+1)); done; }`,
  ])
  rmSync(dir, { recursive: true, force: true })
}
