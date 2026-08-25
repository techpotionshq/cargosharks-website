import { resolveBrand } from '@qabandi/brand'

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
 * two colours — `cargo` in white, `sharks` in the brand blue — and
 * `brand.identity.nameEn` is `CargoSharks`, so the header of the marketing site
 * was quietly showing a different logo from the seven pages linked off it and
 * from the file the operator prints on their letterhead. A wordmark is artwork,
 * not a string, and the artwork wins.
 *
 * `-dark-transparent` because every surface it lands on here is navy. If a
 * light surface ever needs it, the supplier ships `-light-transparent` for
 * exactly that and the two are the same geometry.
 */
const LOCKUP = {
  src: '/cargosharks-logo/svg/cargosharks-logo-dark-transparent.svg',
  // The file's own viewBox, so a height is all a caller ever has to choose.
  width: 660,
  height: 130,
}

export function Wordmark({ height = 30 }: { height?: number }) {
  const brand = resolveBrand()

  return (
    <img
      src={LOCKUP.src}
      alt={brand.identity.nameEn}
      width={Math.round((LOCKUP.width / LOCKUP.height) * height)}
      height={height}
      style={{ height, width: 'auto' }}
      className="block"
    />
  )
}
