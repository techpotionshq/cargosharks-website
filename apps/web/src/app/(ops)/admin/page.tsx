/**
 * Administration — and, in this build, the whitelabel console.
 *
 * This page exists to make one claim inspectable: **every colour, name and
 * mark in the product resolves from tokens, and none of it is written into a
 * component.** `NFR-16` and `FR-CP-01` require the operator's identity
 * everywhere a customer can see, and the cheapest way to keep that true a year
 * from now is to be able to look at the resolved values and the environment
 * variable that overrides each one.
 *
 * It doubles as the handover artefact. Onboarding a second operator is: set
 * these variables, or add one file under `packages/brand/src/brands/`.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { markSvg } from '@qabandi/brand'
import { requireSession } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card, CardHeader } from '@/ui/card'
import { Field, Grid, PageHeader } from '@/ui/layout'
import { Logo } from '@/ui/logo'
import { Badge } from '@/ui/status'

const SCALE_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** The environment overrides, exactly as `resolveBrand` reads them. */
const ENV_OVERRIDES: readonly { variable: string; describe: (b: ReturnType<typeof getBrand>) => string }[] = [
  { variable: 'BRAND', describe: (b) => b.identity.key },
  { variable: 'BRAND_NAME_EN', describe: (b) => b.identity.nameEn },
  { variable: 'BRAND_NAME_AR', describe: (b) => b.identity.nameAr },
  { variable: 'BRAND_TAGLINE_EN', describe: (b) => b.identity.taglineEn },
  { variable: 'BRAND_SHORT_NAME', describe: (b) => b.identity.shortName },
  { variable: 'BRAND_PRIMARY_HUE', describe: (b) => b.palette.primary[500] },
  { variable: 'BRAND_ACCENT_HUE', describe: (b) => b.palette.accent[500] },
  { variable: 'BRAND_RADIUS', describe: (b) => `${b.shape.radius}px` },
  { variable: 'BRAND_MONOGRAM', describe: (b) => b.logo.monogramLetter },
  { variable: 'BRAND_LOGO_SVG', describe: (b) => (b.logo.kind === 'custom' ? 'custom' : '—') },
  { variable: 'BRAND_TRACKING_URL', describe: (b) => b.contact.trackingUrl },
  { variable: 'BRAND_SUPPORT_EMAIL', describe: (b) => b.contact.supportEmail },
]

function Swatch({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <div className="min-w-0">
      <div
        className="h-11 rounded-sm border border-line"
        style={{ backgroundColor: color }}
        title={color}
      />
      <p className="numeric mt-1 truncate text-[0.625rem] text-ink-subtle">{label}</p>
    </div>
  )
}

export default async function AdminPage() {
  await requireSession()
  const brand = getBrand()
  const t = await getTranslations('admin')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const semantic: readonly { name: string; value: string }[] = [
    { name: '--qb-canvas', value: 'var(--qb-canvas)' },
    { name: '--qb-surface', value: 'var(--qb-surface)' },
    { name: '--qb-surface-sunken', value: 'var(--qb-surface-sunken)' },
    { name: '--qb-chrome', value: 'var(--qb-chrome)' },
    { name: '--qb-ink', value: 'var(--qb-ink)' },
    { name: '--qb-ink-muted', value: 'var(--qb-ink-muted)' },
    { name: '--qb-line', value: 'var(--qb-line)' },
    { name: '--qb-brand', value: 'var(--qb-brand)' },
    { name: '--qb-accent', value: 'var(--qb-accent)' },
  ]

  const statuses: readonly { name: string; value: string }[] = [
    { name: '--qb-positive', value: 'var(--qb-positive)' },
    { name: '--qb-caution', value: 'var(--qb-caution)' },
    { name: '--qb-critical', value: 'var(--qb-critical)' },
    { name: '--qb-info', value: 'var(--qb-info)' },
    { name: '--qb-muted', value: 'var(--qb-muted)' },
  ]

  const series = [1, 2, 3, 4].map((n) => ({
    name: `--qb-chart-${n}`,
    value: `var(--qb-chart-${n})`,
  }))

  return (
    <>
      <PageHeader
        eyebrow={t('title')}
        title={t('brandTitle')}
        description={t('brandSubtitle')}
        actions={<Badge tone="brand">{brand.identity.key}</Badge>}
      />

      <Grid className="mb-4">
        {/* --- the mark, at the sizes it actually ships at -------------- */}
        <Card className="lg:col-span-5">
          <CardHeader icon="admin" eyebrow={t('identity')} title={t('logo')} />

          <div className="mt-5 flex flex-wrap items-end gap-6">
            {[48, 36, 28, 20].map((size) => (
              <span
                key={size}
                // eslint-disable-next-line react/no-danger -- generated from typed brand tokens
                dangerouslySetInnerHTML={{
                  __html: markSvg(brand, { size, idPrefix: `admin-${size}` }),
                }}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5">
            <Logo brand={brand} locale={locale} size="lg" />
            {/* The same lockup on the chrome, which is where it has to hold up. */}
            <div className="rounded-sm bg-chrome p-4">
              <Logo brand={brand} locale={locale} size="md" tone="chrome" />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5">
            <Field label={t('fields.nameEn')}>{brand.identity.nameEn}</Field>
            <Field label={t('fields.nameAr')}>{brand.identity.nameAr}</Field>
            <Field label={t('fields.shortName')}>{brand.identity.shortName}</Field>
            <Field label={t('fields.established')}>{brand.identity.established || '—'}</Field>
            <Field label={t('fields.trackingUrl')} mono>
              {brand.contact.trackingUrl}
            </Field>
            <Field label={t('fields.supportEmail')} mono>
              {brand.contact.supportEmail}
            </Field>
          </dl>
        </Card>

        {/* --- the ramps ------------------------------------------------ */}
        <Card className="lg:col-span-7">
          <CardHeader icon="rates" eyebrow={t('palette')} title={t('palette')} />

          <p className="eyebrow mt-5 mb-2">primary</p>
          <div className="grid grid-cols-11 gap-1">
            {SCALE_STOPS.map((stop) => (
              <Swatch key={stop} color={brand.palette.primary[stop]} label={String(stop)} />
            ))}
          </div>

          <p className="eyebrow mt-5 mb-2">accent</p>
          <div className="grid grid-cols-11 gap-1">
            {SCALE_STOPS.map((stop) => (
              <Swatch key={stop} color={brand.palette.accent[stop]} label={String(stop)} />
            ))}
          </div>

          <p className="eyebrow mt-5 mb-2">neutral</p>
          <div className="grid grid-cols-11 gap-1">
            {SCALE_STOPS.map((stop) => (
              <Swatch key={stop} color={brand.palette.neutral[stop]} label={String(stop)} />
            ))}
          </div>
        </Card>
      </Grid>

      <Grid className="mb-4">
        <Card className="lg:col-span-4">
          <CardHeader icon="dashboard" eyebrow={t('surfaces')} title={t('surfaces')} />
          <div className="mt-5 grid grid-cols-3 gap-2">
            {semantic.map((token) => (
              <Swatch key={token.name} color={token.value} label={token.name.replace('--qb-', '')} />
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader icon="alert" eyebrow={t('statusColours')} title={t('statusColours')} />
          <div className="mt-5 grid grid-cols-3 gap-2">
            {statuses.map((token) => (
              <Swatch key={token.name} color={token.value} label={token.name.replace('--qb-', '')} />
            ))}
          </div>
          <p className="mt-4 text-[0.75rem] text-ink-muted">
            Reserved for state. A chart series never wears one of these.
          </p>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader icon="trend" eyebrow={t('chartColours')} title={t('chartColours')} />
          <div className="mt-5 grid grid-cols-4 gap-2">
            {series.map((token) => (
              <Swatch key={token.name} color={token.value} label={token.name.replace('--qb-', '')} />
            ))}
          </div>
          <p className="mt-4 text-[0.75rem] text-ink-muted">
            Assigned in order, never cycled. Validated for colour-blind separation and surface
            contrast in both themes.
          </p>
        </Card>
      </Grid>

      <Grid>
        <Card className="lg:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="admin"
              eyebrow={t('variable')}
              title={t('overrides')}
              description={t('whitelabelNote')}
            />
          </div>
          <div className="w-full overflow-x-auto border-t border-line">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 text-start text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
                    {t('variable')}
                  </th>
                  <th className="px-5 py-2.5 text-start text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
                    {t('value')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ENV_OVERRIDES.map((row) => (
                  <tr key={row.variable} className="hover:bg-surface-sunken">
                    <td className="ref px-5 py-2 text-ink">{row.variable}</td>
                    <td className="numeric px-5 py-2 text-ink-muted">{row.describe(brand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon="document" eyebrow={t('typography')} title={t('typography')} />
          <dl className="mt-5 flex flex-col gap-4">
            <div>
              <dt className="eyebrow mb-1">sans</dt>
              <dd className="font-sans text-[1.125rem] text-ink">
                Shuwaikh → Jebel Ali · 1,284.500 KWD
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1">arabic</dt>
              <dd className="font-arabic text-[1.125rem] text-ink" lang="ar" dir="rtl">
                الشويخ ← جبل علي · التخليص الجمركي
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1">mono</dt>
              <dd className="ref numeric text-[1.125rem] text-ink">ONEU0413471 · KWI-2026-01041</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-2">{t('referenceData')}</p>
            <p className="text-[0.8125rem] text-ink-muted">{t('referenceDataHint')}</p>
          </div>
        </Card>
      </Grid>
    </>
  )
}
