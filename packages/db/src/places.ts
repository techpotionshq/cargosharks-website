/**
 * The canonical places every deployment holds — reference data, not demo data.
 *
 * Ports, airports and land borders a Gulf forwarder routes through, by
 * UN/LOCODE. These belong in `db:seed`, not `db:seed-demo`: the engines resolve
 * a lane to one of these rows — an enquiry, a rate card and a job every one
 * reference a location — so a fresh customer instance with none could take no
 * lane at all, and the import and cutover suites that assert `KWSWK` exists were
 * quietly relying on a seed that had stopped creating it.
 *
 * `db:seed-demo` builds its shipments on top of exactly this list rather than
 * carrying its own, so the two can never disagree about which port `KWSWK` is —
 * a divergence `locations_unlocode_idx` would turn into a silent conflict on one
 * side or the other.
 *
 * Columns: UN/LOCODE, English name, Arabic name, ISO country, kind, latitude,
 * longitude.
 */
export const PLACES = [
  ['KWSWK', 'Shuwaikh Port', 'ميناء الشويخ', 'KW', 'seaport', 29.35, 47.93],
  ['KWSAA', 'Shuaiba Port', 'ميناء الشعيبة', 'KW', 'seaport', 29.03, 48.15],
  ['KWDOH', 'Doha Port', 'ميناء الدوحة', 'KW', 'seaport', 29.36, 47.81],
  ['KWKWI', 'Kuwait International Airport', 'مطار الكويت الدولي', 'KW', 'airport', 29.23, 47.97],
  ['AEJEA', 'Jebel Ali', 'جبل علي', 'AE', 'seaport', 25.01, 55.06],
  ['AEDXB', 'Dubai International Airport', 'مطار دبي الدولي', 'AE', 'airport', 25.25, 55.36],
  ['AESHJ', 'Sharjah Port', 'ميناء الشارقة', 'AE', 'seaport', 25.36, 55.39],
  ['CNSHA', 'Shanghai', 'شنغهاي', 'CN', 'seaport', 31.23, 121.47],
  ['CNNGB', 'Ningbo', 'نينغبو', 'CN', 'seaport', 29.87, 121.55],
  ['CNSZX', 'Shenzhen', 'شنتشن', 'CN', 'seaport', 22.54, 114.06],
  ['SGSIN', 'Singapore', 'سنغافورة', 'SG', 'seaport', 1.29, 103.85],
  ['INNSA', 'Nhava Sheva', 'نهافا شيفا', 'IN', 'seaport', 18.95, 72.95],
  ['NLRTM', 'Rotterdam', 'روتردام', 'NL', 'seaport', 51.92, 4.48],
  ['DEHAM', 'Hamburg', 'هامبورغ', 'DE', 'seaport', 53.55, 9.99],
  ['TRMER', 'Mersin', 'مرسين', 'TR', 'seaport', 36.8, 34.63],
  ['SAJED', 'Jeddah Islamic Port', 'ميناء جدة الإسلامي', 'SA', 'seaport', 21.48, 39.18],
  ['SADMM', 'Dammam', 'الدمام', 'SA', 'seaport', 26.5, 50.2],
  ['QADOH', 'Hamad Port', 'ميناء حمد', 'QA', 'seaport', 25.02, 51.6],
  ['USNYC', 'New York', 'نيويورك', 'US', 'seaport', 40.69, -74.04],
  ['GBFXT', 'Felixstowe', 'فيليكستو', 'GB', 'seaport', 51.95, 1.31],
  ['KWABD', 'Abdali Border', 'منفذ العبدلي', 'KW', 'border', 30.05, 47.7],
  ['KWNWS', 'Nuwaiseeb Border', 'منفذ النويصيب', 'KW', 'border', 28.55, 48.4],
] as const

/** The places, in the shape a `locations` insert takes — used by both seeds. */
export function locationSeedRows(): {
  unlocode: string
  nameEn: string
  nameAr: string
  countryCode: string
  kind: 'seaport' | 'airport' | 'border'
  latitude: string
  longitude: string
}[] {
  return PLACES.map(([unlocode, nameEn, nameAr, country, kind, lat, lon]) => ({
    unlocode,
    nameEn,
    nameAr,
    countryCode: country,
    kind,
    latitude: String(lat),
    longitude: String(lon),
  }))
}
