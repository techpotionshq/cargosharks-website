/**
 * CargoSharks — the product's own brand, and the default.
 *
 * This is the identity a demo, a preview deployment or an unconfigured
 * environment wears. It exists because the alternative was worse: the default
 * used to be a real client's live identity, so every screenshot, every sample
 * PDF and every screen-share carried Al-Qabandi's name and red into rooms that
 * had nothing to do with them. Naming a reference customer needs written
 * permission; defaulting to one needs it too, and did not have it.
 *
 * The palette is the four colours in the supplied brand manual and nothing
 * else:
 *
 *   - **Blue `#1F6FEB`** — `oklch(0.569 0.202 260)`, the corporate colour.
 *   - **Navy `#0B2545`** — `oklch(0.264 0.068 255)`, the chrome and the
 *     letterhead ground.
 *   - **Light blue `#79B0FF`** — `oklch(0.752 0.129 257)`, which the primary
 *     ramp reaches on its own at the 300 stop; it is not a third ramp.
 *   - White.
 *
 * Two decisions worth stating, because both look like mistakes from outside:
 *
 * **The peak chroma is 0.175, not the measured 0.202.** Blue is the one hue
 * where sRGB is generous at mid lightness and mean everywhere else. At 0.202
 * the 600–950 stops fall outside the gamut and the browser maps them back —
 * unevenly, so the ramp goes flat across exactly the four stops the sidebar,
 * the pressed state and the dark theme are cut from. At 0.175 every stop from
 * 500 down is reachable. The 50–400 tints still sit outside and are mapped;
 * that is unavoidable for any real blue and harmless, because tints only have
 * to stay distinct from one another, and they do.
 *
 * **Primary and accent are eleven degrees apart, which is not a typo.** A
 * brand with one hue does not get a second one invented for it. The separation
 * that matters here is chroma, not hue: the primary is a saturated blue at
 * 0.175 and the accent is the navy at 0.105, so `accent` reads as ink with
 * blue in it and `brand` reads as a colour. Charts do not touch either — see
 * `DEFAULT_CHART_SLOTS`, which stays clear of the brand hue on purpose.
 *
 * Unlike `qabandi`, the chrome *is* cut from the accent for the ordinary
 * reason rather than a defensive one: the navy is simply the darker of the two
 * and the blue is wanted for actions.
 */

import { defineBrand } from '../define'
import { CARGOSHARKS_MARK_SVG } from './cargosharks-mark'

export const cargosharksBrand = defineBrand({
  identity: {
    key: 'cargosharks',
    nameEn: 'CargoSharks',
    nameAr: 'كارجو شاركس',
    legalNameEn: 'CargoSharks Freight Technologies',
    legalNameAr: 'كارجو شاركس لتقنيات الشحن',
    shortName: 'CS',
    taglineEn: 'Freight, end to end',
    taglineAr: 'الشحن من البداية إلى النهاية',
    established: '2026',
  },

  contact: {
    // Placeholders until the domain is actually held — the marketing site says
    // the same thing in its own words. A demo deployment shows these on the
    // tracking page and on every PDF, so they have to be shaped like real
    // values; they are not real values.
    websiteUrl: 'https://cargosharks.com',
    portalUrl: 'https://portal.cargosharks.com',
    /** Moment 1 is demonstrated here, and the domain is half of why it lands. */
    trackingUrl: 'https://track.cargosharks.com',
    supportEmail: 'hello@cargosharks.com',
    supportPhone: '+965 2200 0000',
    addressEn: 'Kuwait City, Kuwait',
    addressAr: 'مدينة الكويت، الكويت',
  },

  documents: {
    // Deliberately empty of registration numbers. A demo tenant that prints a
    // plausible-looking commercial registration on a quotation is putting a
    // false registration into the world, and somebody will screenshot it.
    registrations: [],
    registrationNoteEn: 'Demonstration environment — not a trading entity',
    registrationNoteAr: 'بيئة عرض توضيحي — ليست كياناً تجارياً',
    footerEn: 'All business is transacted under our Standard Trading Conditions.',
    footerAr: 'تخضع جميع المعاملات لشروط التعامل القياسية لدينا.',
    tradingConditionsEn:
      'Subject to the Standard Trading Conditions of the Kuwait International Freight Forwarders Association.',
    tradingConditionsAr: 'تخضع لشروط التعامل القياسية لجمعية وكلاء الشحن الدولي الكويتية.',
  },

  /** The corporate blue. Drifts cooler as it darkens, into the brand's navy. */
  primary: { hue: 261, chroma: 0.175, hueShift: -6 },
  /** The navy — ink with blue in it, not a second brand colour. */
  accent: { hue: 256, chroma: 0.105, hueShift: -5 },

  chromeRamp: 'accent',
  neutralHue: 257,

  logo: {
    kind: 'custom',
    customSvg: CARGOSHARKS_MARK_SVG,
    monogramLetter: 'C',
    showWaves: false,
    favicon: '🦈',
  },

  typography: {
    /**
     * Manrope for the display face, because the supplied wordmark *is* Manrope
     * ExtraBold converted to outlines. Anything else puts the company name in
     * one typeface and the mark beside it in another, at the one size where
     * both are read together.
     */
    display: "'Manrope', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    /** ExtraBold, to match the outlines rather than approach them. */
    wordmarkWeight: 800,
    wordmarkTracking: '-0.01em',
  },
})
