import { resolveBrand } from '@/brand'

/**
 * The supplied lockup, as supplied.
 *
 * This started life as the mark from `@qabandi/brand` beside the name set live
 * in Manrope at the brand's own wordmark weight, on the reasoning that the
 * supplied wordmark *is* Manrope ExtraBold converted to outlines, so live text
 * would be identical and would scale, recolour and be selectable into the
 * bargain.
 *
 * It was not identical. The supplied wordmark sets the name lowercase and in
 * two colours — `cargo` in one, `sharks` in the brand blue — and
 * `brand.identity.nameEn` is `CargoSharks`, so the header of the marketing site
 * was quietly showing a different logo from the seven pages linked off it and
 * from the file the operator prints on their letterhead. A wordmark is artwork,
 * not a string, and the artwork wins.
 *
 * **Both files, now the page is light.** The supplier ships the same geometry
 * twice, inked for a light surface and for a dark one, and the site used to
 * need only the second because every surface on it was navy. It is paper now
 * with three dark bands in it, so the caller says which room it is standing in.
 * Naming the *surface* rather than the file — `tone="onDark"`, not
 * `variant="dark"` — because the file names are the supplier's and they read
 * backwards: `-dark-transparent` is the artwork *for* dark, drawn in white.
 */
const LOCKUP = {
  onPaper: '/cargosharks-logo/svg/cargosharks-logo-light-transparent.svg',
  onDark: '/cargosharks-logo/svg/cargosharks-logo-dark-transparent.svg',
  // The file's own viewBox, so a height is all a caller ever has to choose.
  width: 660,
  height: 130,
}

export function Wordmark({
  height = 28,
  tone = 'onPaper',
}: {
  height?: number
  tone?: 'onPaper' | 'onDark'
}) {
  const brand = resolveBrand()

  return (
    <img
      src={tone === 'onDark' ? LOCKUP.onDark : LOCKUP.onPaper}
      alt={brand.identity.nameEn}
      width={Math.round((LOCKUP.width / LOCKUP.height) * height)}
      height={height}
      style={{ height, width: 'auto' }}
      className="block"
    />
  )
}
