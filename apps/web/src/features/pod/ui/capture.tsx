'use client'

/**
 * The delivery capture form — the one screen in this product designed for a
 * phone held at a gate.
 *
 * A client component rather than a `RecordDialog`, because three of its
 * controls have no server-composed equivalent and all three are the point: a
 * canvas somebody signs with a finger, a file input that opens a camera, and a
 * location read from the device.
 *
 * ## The signature is a canvas, and the reasons are practical
 *
 * Pointer events rather than touch events, so the same code serves a finger, a
 * stylus and a warehouse manager's mouse. The canvas is sized from its own
 * layout box at mount and scaled by `devicePixelRatio`, because a canvas left
 * at its default 300×150 and stretched by CSS produces a signature that looks
 * like it was drawn through frosted glass — which is exactly what somebody
 * disputing it will say.
 *
 * `touch-action: none` on the element is load-bearing. Without it the browser
 * treats the first drag as a scroll and the signature comes out as a dot.
 *
 * ## Location is asked for, never waited on
 *
 * `getCurrentPosition` can hang indefinitely behind a permission prompt the
 * driver has already dismissed. It runs on mount, fills two hidden inputs if
 * it succeeds, and is never awaited by the submit path. A delivery with no
 * coordinates is a delivery; a form that will not submit until the phone
 * agrees to say where it is, is a driver reaching for WhatsApp.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field, FormError, Input, Select, Submit, Textarea } from '@/ui/form'
import { Icon } from '@/ui/icon'
import type { ActionState } from '@/lib/form-state'
import { localInputValue } from '@qabandi/core'

export interface PodCaptureProps {
  readonly action: (previous: ActionState, form: FormData) => Promise<ActionState>
  readonly jobId: string
  readonly equipment: readonly { value: string; label: string }[]
  /** Set when this capture replaces an earlier record. */
  readonly supersedesId?: string
  /** The job's branch zone — the one the action reads the time back in. */
  readonly timeZone: string
  readonly onDone?: () => void
}

/**
 * `datetime-local` wants wall-clock, not an ISO instant — and the branch's
 * wall-clock, because that is how the action reads it. The device's own
 * offset was used here, so a phone set to another zone pre-filled a time the
 * server then stored hours out.
 */
function localNow(timeZone: string): string {
  return localInputValue(new Date(), timeZone) ?? ''
}

export function PodCaptureForm({
  action,
  jobId,
  equipment,
  supersedesId,
  timeZone,
  onDone,
}: PodCaptureProps) {
  const t = useTranslations('pod')
  const [state, formAction] = useActionState<ActionState, FormData>(action, {})
  const [hasException, setHasException] = useState(false)
  const [signature, setSignature] = useState('')
  const [position, setPosition] = useState<{ lat: string; lon: string; acc: string } | null>(null)
  const [locationState, setLocationState] = useState<'asking' | 'got' | 'denied'>('asking')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    if (state.ok && onDone) onDone()
  }, [state.ok, onDone])

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationState('denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({
          lat: p.coords.latitude.toFixed(6),
          lon: p.coords.longitude.toFixed(6),
          acc: Math.round(p.coords.accuracy).toString(),
        })
        setLocationState('got')
      },
      () => setLocationState('denied'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [])

  /* Sized from its own box, scaled for the display. See the header. */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const box = canvas.getBoundingClientRect()
    canvas.width = box.width * ratio
    canvas.height = box.height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    /*
      The ink comes from the brand, but from the *neutral ramp* rather than
      `--qb-ink`, and the difference is the whole point. A canvas cannot hold a
      `var()`, so the element carries the colour and the context reads back
      what the browser resolved. What must not happen is the stroke following
      the theme: this pad produces a PNG that is filed against the delivery and
      later printed on white paper, so a driver signing at a gate at night
      would sign in near-white and hand over a blank page. The neutral stops
      are emitted once at `:root` and do not move between light and dark, so
      the signature stays dark and still carries the operator's neutral tint.
    */
    ctx.strokeStyle = getComputedStyle(canvas).color
  }, [])

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    // Capture, so a signature that runs off the edge of the pad keeps drawing
    // instead of ending mid-stroke.
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const { x, y } = pointAt(event)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointAt(event)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = useCallback(() => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) setSignature(canvas.toDataURL('image/png'))
  }, [])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignature('')
  }, [])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      {supersedesId ? <input type="hidden" name="supersedesId" value={supersedesId} /> : null}
      <input type="hidden" name="signature" value={signature} />
      {position ? (
        <>
          <input type="hidden" name="latitude" value={position.lat} />
          <input type="hidden" name="longitude" value={position.lon} />
          <input type="hidden" name="accuracyMetres" value={position.acc} />
        </>
      ) : null}

      <div className="grid grid-cols-12 gap-4">
        <Input
          name="deliveredAt"
          label={t('deliveredAt')}
          type="datetime-local"
          span={6}
          required
          defaultValue={state.values?.deliveredAt ?? localNow(timeZone)}
          error={state.errors?.deliveredAt}
          hint={t('deliveredAtHint')}
        />

        {equipment.length > 0 ? (
          <Select
            name="equipmentId"
            label={t('equipment')}
            span={6}
            options={equipment}
            placeholder={t('wholeShipment')}
            defaultValue={state.values?.equipmentId}
            error={state.errors?.equipmentId}
          />
        ) : null}

        <Input
          name="receivedByName"
          label={t('receivedByName')}
          span={6}
          required
          defaultValue={state.values?.receivedByName}
          error={state.errors?.receivedByName}
          hint={t('receivedByNameHint')}
        />
        <Input
          name="receivedByIdNumber"
          label={t('receivedByIdNumber')}
          span={6}
          mono
          defaultValue={state.values?.receivedByIdNumber}
          error={state.errors?.receivedByIdNumber}
        />
      </div>

      <Field name="signature-pad" label={t('signature')} span={12} hint={t('signatureHint')}>
        <div className="rounded-sm border border-line bg-surface">
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="block h-32 w-full touch-none rounded-sm"
            // The pen's colour, read back by the drawing effect. See there.
            style={{ color: 'var(--qb-neutral-900)' }}
            aria-label={t('signature')}
          />
        </div>
        <button
          type="button"
          onClick={clear}
          className="mt-1.5 inline-flex items-center gap-1 text-[0.75rem] font-medium text-ink-muted hover:text-ink"
        >
          <Icon name="close" size={12} />
          {t('clearSignature')}
        </button>
      </Field>

      <Field name="photos" label={t('photos')} span={12} hint={t('photosHint')}>
        {/*
          `capture="environment"` asks a phone for the rear camera directly.
          Desktop browsers ignore it and show a file picker, which is the right
          behaviour for a coordinator attaching a scan from a desk.
        */}
        <input
          type="file"
          name="photos"
          multiple
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="block w-full rounded-sm border border-line bg-surface px-3 py-2 text-[0.875rem] text-ink file:me-3 file:rounded-sm file:border-0 file:bg-surface-sunken file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-ink"
        />
      </Field>

      <label className="flex items-center gap-2 text-[0.875rem] text-ink">
        <input
          type="checkbox"
          name="hasException"
          checked={hasException}
          onChange={(e) => setHasException(e.target.checked)}
          className="size-4 rounded-sm border-line accent-[var(--color-critical)]"
        />
        {t('hasException')}
      </label>

      {hasException ? (
        <Textarea
          name="exceptionNotes"
          label={t('exceptionNotes')}
          span={12}
          rows={2}
          required
          defaultValue={state.values?.exceptionNotes}
          error={state.errors?.exceptionNotes}
          hint={t('exceptionNotesHint')}
        />
      ) : null}

      <Textarea
        name="notes"
        label={t('notes')}
        span={12}
        rows={2}
        defaultValue={state.values?.notes}
        error={state.errors?.notes}
      />

      <p className="text-[0.75rem] text-ink-subtle">
        {locationState === 'got'
          ? t('locationCaptured', { accuracy: position?.acc ?? '' })
          : locationState === 'denied'
            ? t('locationUnavailable')
            : t('locationAsking')}
      </p>

      <FormError message={state.message} />

      <div className="flex justify-end">
        <Submit pendingLabel={t('saving')}>{t('submit')}</Submit>
      </div>
    </form>
  )
}
