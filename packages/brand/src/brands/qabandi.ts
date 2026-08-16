/**
 * AL-QABANDI & PARTNERS — the default brand.
 *
 * **Status: provisional.** The client's own logo files, colour references and
 * a letterhead sample are Pilot §5 item 4, due on day 2. Everything here is a
 * defensible stand-in chosen to survive that arrival cheaply: when the real
 * values land, this file changes and nothing else does. That is the entire
 * argument for the package — Pilot §3.1 item 1 calls branding "non-negotiable
 * for the illusion to hold", and an illusion that takes a sprint to correct
 * would not survive day 3.
 *
 * The provisional choices, and why:
 *
 *   - **Marine navy** as the corporate colour. A thirty-four-year-old Kuwaiti
 *     shipping and forwarding house is not a startup, and the palette should
 *     not read as one. Navy also survives the transition to a white
 *     quotation letterhead, which a mid-tone brand colour does not.
 *   - **Brass** as the accent. Warm against the navy, legible as a small
 *     highlight on both themes, and it does not collide with any of the five
 *     status colours — an accent that reads as "success" or "overdue" makes
 *     the ops board lie.
 */

import { defineBrand } from '../define'

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
    websiteUrl: 'https://qabandi.com',
    portalUrl: 'https://portal.qabandi.com',
    /** Moment 1 is demonstrated here, and the domain is half of why it lands. */
    trackingUrl: 'https://track.qabandi.com',
    supportEmail: 'operations@qabandi.com',
    supportPhone: '+965 2483 0000',
    addressEn: 'Shuwaikh Port Road, Kuwait City, State of Kuwait',
    addressAr: 'طريق ميناء الشويخ، مدينة الكويت، دولة الكويت',
  },

  documents: {
    registrationLineEn: 'Commercial Registration 00000 · Customs Licence 000/00',
    registrationLineAr: 'السجل التجاري ٠٠٠٠٠ · رخصة جمركية ٠٠٠/٠٠',
    footerEn: 'All business is transacted under our Standard Trading Conditions.',
    footerAr: 'تخضع جميع المعاملات لشروط التعامل القياسية لدينا.',
    tradingConditionsEn:
      'Subject to the Standard Trading Conditions of the Kuwait International Freight Forwarders Association.',
    tradingConditionsAr:
      'تخضع لشروط التعامل القياسية لجمعية وكلاء الشحن الدولي الكويتية.',
  },

  /** Marine navy. The hue also tints every neutral and every shadow. */
  primary: { hue: 251, chroma: 0.118, hueShift: -8 },
  /** Brass, drifting redder as it darkens the way a real metallic does. */
  accent: { hue: 79, chroma: 0.125, hueShift: -12 },

  logo: {
    kind: 'monogram',
    monogramLetter: 'Q',
    showWaves: true,
    favicon: '⚓',
  },
})
