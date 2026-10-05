// Node preload (`--import`) that moves the server's clock to GUIDE_NOW.
//
// The pilot fixtures anchor every date to the moment they are read, so a demo
// never looks stale. That is right for a live demo and wrong for a manual: a
// screenshot taken on Tuesday and one taken on Friday would disagree about
// what is overdue, and the cache would call them the same picture. So the
// guide stack pins "now" to GUIDE_NOW, and lets time flow from there at the
// normal rate, measured from GUIDE_EPOCH, the real moment the stack started.
// Every process the stack starts shares that epoch, so the web server and its
// workers agree to the second.
//
// A Proxy rather than a subclass: replacing `Date` with a subclass breaks
// `x instanceof Date` for every Date that native code creates (fs.stat, the
// pg driver), and that fails in places nobody would think to look.
const target = Date.parse(process.env.GUIDE_NOW ?? '')
const epoch = Number(process.env.GUIDE_EPOCH ?? '')

if (Number.isFinite(target) && Number.isFinite(epoch) && epoch > 0) {
  const RealDate = Date
  const realNow = RealDate.now.bind(RealDate)
  const offset = target - epoch
  const now = () => realNow() + offset
  RealDate.now = now
  globalThis.Date = new Proxy(RealDate, {
    construct(t, args, newTarget) {
      return args.length
        ? Reflect.construct(t, args, newTarget)
        : Reflect.construct(t, [now()], newTarget)
    },
    apply() {
      return new RealDate(now()).toString()
    },
  })
}
