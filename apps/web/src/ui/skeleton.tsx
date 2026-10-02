/**
 * The shape of a screen before its data arrives.
 *
 * Two shapes, because the operations shell has exactly two kinds of screen: a
 * register (header, a strip of figures, filters, a table) and a record (header
 * with its actions, a hero card, a column of panels beside a wider one). Each
 * `loading.tsx` under `(ops)` renders one of these, so a click on a row or a
 * nav item answers inside a frame instead of after the query — and the page
 * that lands does not jump, because it lands in the layout it was promised.
 *
 * `qb-skeleton` (globals.css) is an opacity pulse, not a travelling shimmer,
 * and stops under reduced motion. The whole block is `aria-hidden` with one
 * `role="status"` line in front of it: a screen reader should hear "loading"
 * once, not forty unlabelled shapes.
 */

function Bar({ className }: { readonly className: string }) {
  return <div className={`qb-skeleton ${className}`} />
}

function Header({ actions }: { readonly actions: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2.5">
        <Bar className="h-2.5 w-24" />
        <Bar className="h-7 w-56 max-w-full" />
        <Bar className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, index) => (
          <Bar key={index} className="h-9 w-28" />
        ))}
      </div>
    </div>
  )
}

export function RegisterSkeleton({ label }: { readonly label: string }) {
  return (
    <div>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden>
        <Header actions={1} />
        <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2 border-b border-line pb-4">
          {['w-28', 'w-20', 'w-24', 'w-16'].map((width) => (
            <Bar key={width} className={`h-4 ${width}`} />
          ))}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {['w-16', 'w-20', 'w-18'].map((width) => (
            <Bar key={width} className={`h-9 rounded-full ${width}`} />
          ))}
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="border-b border-line px-3 py-3">
            <Bar className="h-2.5 w-2/3" />
          </div>
          {Array.from({ length: 8 }, (_, row) => (
            <div key={row} className="flex items-center gap-6 border-b border-line px-3 py-3.5">
              <Bar className="h-3 w-24 shrink-0" />
              <Bar className="h-3 flex-1" />
              <Bar className="h-5 w-16 shrink-0 rounded-full" />
              <Bar className="hidden h-3 w-20 shrink-0 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DetailSkeleton({ label }: { readonly label: string }) {
  return (
    <div>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden>
        <Header actions={2} />
        <div className="mb-4 rounded-card border border-line bg-surface p-5">
          <div className="grid grid-cols-2 gap-6 @xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, cell) => (
              <div key={cell} className="flex flex-col gap-2">
                <Bar className="h-2.5 w-16" />
                <Bar className="h-4 w-28 max-w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-12">
          <div className="flex flex-col gap-4 @4xl:col-span-8">
            {[6, 4].map((rows, panel) => (
              <div key={panel} className="rounded-card border border-line bg-surface p-5">
                <Bar className="mb-5 h-4 w-40" />
                {Array.from({ length: rows }, (_, row) => (
                  <Bar key={row} className="mb-3 h-3 w-full last:mb-0" />
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4 @4xl:col-span-4">
            {[5, 3].map((rows, panel) => (
              <div key={panel} className="rounded-card border border-line bg-surface p-5">
                <Bar className="mb-5 h-4 w-32" />
                {Array.from({ length: rows }, (_, row) => (
                  <Bar key={row} className="mb-3 h-3 w-4/5 last:mb-0" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
