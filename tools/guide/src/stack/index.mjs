// The two stacks a guide page or short can be recorded on.
//
//   fixtures  the web app alone on the pilot fixtures. Read-only, no database,
//             starts in seconds, and the data is the same on every build. Every
//             manual screenshot and every read-only short uses it.
//   seeded    PostgreSQL restored from a story snapshot, the service, the web
//             app and local stand-ins for WhatsApp, mail and the model. For the
//             shorts that press buttons and need the press to stick.
const stacks = new Map()

export async function getStack(kind = 'fixtures') {
  if (stacks.has(kind)) return stacks.get(kind)
  let stack
  if (kind === 'fixtures') {
    const fx = await import('./fixtures.mjs')
    const s = await fx.start()
    stack = {
      id: `fixtures-${fx.PORT}`,
      kind,
      ...s,
      // The fixture data itself is part of every screen's import closure, so
      // all the stack adds is the pinned moment.
      fingerprint: () => `fixtures@${s.now}`,
      stop: fx.stop,
    }
  } else if (kind === 'seeded') {
    const sd = await import('./seeded.mjs')
    stack = await sd.start()
  } else throw new Error(`unknown stack "${kind}"`)
  stacks.set(kind, stack)
  return stack
}

export async function stopAll() {
  for (const s of stacks.values()) await s.stop?.()
  stacks.clear()
}
