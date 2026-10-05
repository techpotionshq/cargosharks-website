// The two stacks a guide page or short can be recorded on.
//
//   fixtures  the web app alone on the pilot fixtures. Read-only, no database,
//             starts in seconds, and the data is the same on every build. Every
//             manual screenshot and every read-only short uses it.
//   seeded    PostgreSQL restored from a story snapshot, the service, the web
//             app and local stand-ins for WhatsApp, mail and the model. For the
//             shorts that press buttons and need the press to stick.
//
// A stack is described before it is started: its fingerprint (what its data
// is) goes into every cache key, and `ensure()` starts it only when something
// actually has to be shot or recorded. A build where everything is cached
// never starts a server at all.
const descriptors = new Map()

export function stackFor(kind = 'fixtures') {
  if (descriptors.has(kind)) return descriptors.get(kind)
  let running
  let mod
  const load = async () =>
    (mod ??= await import(kind === 'seeded' ? './seeded.mjs' : './fixtures.mjs'))
  const desc = {
    kind,
    fingerprint: (spec = {}) => {
      if (kind === 'fixtures')
        return `fixtures@${process.env.GUIDE_NOW ?? '2026-10-14T09:30:00+03:00'}`
      if (!mod) throw new Error('seeded stack: call prime() first')
      return mod.fingerprint(spec)
    },
    /** Loads the module so `fingerprint` can run (the seeded stack reads its story to hash it). */
    prime: load,
    ensure: async () => {
      if (running) return running
      const m = await load()
      const s = await m.start()
      running = { id: `${kind}-${m.PORT ?? ''}`, kind, ...s, fingerprint: desc.fingerprint }
      return running
    },
    stop: async () => {
      if (mod) await mod.stop()
      running = undefined
    },
  }
  if (!['fixtures', 'seeded'].includes(kind)) throw new Error(`unknown stack "${kind}"`)
  descriptors.set(kind, desc)
  return desc
}

/** Kept for callers that want a running stack straight away. */
export const getStack = (kind) => stackFor(kind).ensure()

export async function stopAll() {
  for (const d of descriptors.values()) await d.stop()
}
