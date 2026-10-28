import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui's Table, with logical alignment (`text-start`) for the Arabic
 * pages. No JavaScript: it is a styled `<table>`, so it prerenders whole and
 * a crawler reads the same cells a visitor does. The wrapper scrolls
 * sideways on a phone rather than reflowing into cards, because a table
 * reflowed into cards loses the column a reader was comparing down.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom border-collapse text-small', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-border', className)} {...props} />
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-start align-middle text-label font-medium whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-3 align-top', className)} {...props} />
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-3 text-start text-small text-muted-foreground', className)}
      {...props}
    />
  )
}
