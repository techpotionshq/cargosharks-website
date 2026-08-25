/**
 * AL-QABANDI & PARTNERS — a client, reached with `BRAND=qabandi`.
 *
 * It was the default until the product had a name of its own, which is the
 * only reason it is worth saying it is not one now: a supplier's demo wearing
 * a client's identity is a permissions problem, not a styling choice. It is
 * kept registered because it is the worked example — a real brand, arrived at
 * without touching `apps/web`, and the case that forced every rule below.
 *
 * **Status: taken from the client's live identity**, not guessed. Every value
 * below traces to qabandi.com: the laurel wreath is their own artwork, the red
 * is the exact colour it is drawn in, and the navy, the greys and the contact
 * block are lifted from the same stylesheet and page furniture.
 *
 *   - **Red `#da2726`** — `oklch(0.574 0.213 27)`, measured off the mark itself
 *     and confirmed as the dominant value in their stylesheet (94 uses).
 *   - **Navy `#1d2143`** — `oklch(0.264 0.063 276)`, their dark sections.
 *   - Their muted grey sits at hue 283, so the neutral ramp follows the navy
 *     rather than the red. Tinting a whole interface with a red brand hue
 *     turns every card and rule faintly pink.
 *
 * The one real design decision here, and it is worth stating plainly: **the
 * chrome is cut from the navy, not from the red.** Hue 27 is also where
 * `critical` lives, and a product cannot spend its alarm colour on four hundred
 * pixels of permanent sidebar and still have a customs hold jump off the board.
 * So red is rationed — the mark, a primary action, and things that are actually
 * wrong — and the navy carries the furniture. The charts go further and exclude
 * red altogether; see `DEFAULT_CHART_SLOTS`.
 */

import { defineBrand } from '../define'
import { QABANDI_MARK_SVG } from './qabandi-mark'

export const qabandiBrand = defineBrand({
  identity: {
    key: 'qabandi',
    nameEn: 'Al-Qabandi & Partners',
    nameAr: 'القبندي وشركاه',
    legalNameEn: 'AL-QABANDI & PARTNERS Co. — Shipping & Forwarding',
    legalNameAr: 'شركة القبندي وشركاه للشحن والتخليص',
    shortName: 'AQP',
    taglineEn: 'Shipping & Forwarding',
    taglineAr: 'للشحن والتخليص',
    established: '1992',
  },

  contact: {
    websiteUrl: 'https://www.qabandi.com',
    portalUrl: 'https://portal.qabandi.com',
    /** Moment 1 is demonstrated here, and the domain is half of why it lands. */
    trackingUrl: 'https://track.qabandi.com',
    supportEmail: 'info@qabandi.com',
    supportPhone: '+965 2240 6262',
    addressEn: 'Fahed Al-Salem Street, Al-Dawlia Commercial Center, Kuwait',
    addressAr: 'شارع فهد السالم، المركز التجاري الدولي، الكويت',
  },

  documents: {
    // Placeholders: the CR and customs-licence numbers are the client's to
    // supply, and inventing plausible ones would put a false registration on
    // every quotation the pilot prints.
    registrationLineEn: 'Commercial Registration — · Customs Licence —',
    registrationLineAr: 'السجل التجاري — · رخصة جمركية —',
    footerEn: 'All business is transacted under our Standard Trading Conditions.',
    footerAr: 'تخضع جميع المعاملات لشروط التعامل القياسية لدينا.',
    tradingConditionsEn:
      'Subject to the Standard Trading Conditions of the Kuwait International Freight Forwarders Association.',
    tradingConditionsAr: 'تخضع لشروط التعامل القياسية لجمعية وكلاء الشحن الدولي الكويتية.',
  },

  /**
   * The corporate red. Peak chroma is 0.19 rather than the measured 0.213
   * because 0.213 pushes the 700–950 stops outside sRGB, and a ramp that clips
   * at the dark end goes flat exactly where the interface needs separation.
   */
  primary: { hue: 27.4, chroma: 0.19, hueShift: 6 },
  /** The navy. Drifts cooler as it darkens, the way a real ink does. */
  accent: { hue: 276, chroma: 0.105, hueShift: -12 },

  chromeRamp: 'accent',
  neutralHue: 276,

  logo: {
    kind: 'custom',
    customSvg: QABANDI_MARK_SVG,
    monogramLetter: 'Q',
    showWaves: false,
    favicon: '🏛',
  },
})
