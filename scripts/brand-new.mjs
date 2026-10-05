#!/usr/bin/env node
/**
 * Scaffold a client's brand — `pnpm brand:new`.
 *
 * `pnpm tenant:new --brand acme` sets `BRAND=acme` and stops. Writing
 * `brands/acme.ts` was the step left to a human, and it is the step a human
 * skips: until `resolveBrand` learned to refuse an unregistered key, a
 * deployment with no brand file started, worked, and wore the supplier's
 * identity on every screen and every PDF the client sent a customer.
 *
 * So this writes the file. What it cannot write — an Arabic legal name, a
 * commercial registration number, artwork — it writes as a marked placeholder
 * and then names in its own output, because the failure this area keeps
 * producing is a value nobody knew was still a default.
 *
 *     pnpm brand:new --key acme --name-en "Acme Logistics LLC" \
 *                    --primary "#0b5fff" --accent "#12203a"
 *
 * A plain `.mjs` like every other script here: no build step, and it does no
 * colour arithmetic of its own. The generated file calls `hexRamp` and
 * `chromeRampFor` at import time, so the maths stays in `packages/brand` where
 * it is unit-tested, and the file keeps the hex the client actually supplied.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BRANDS_DIR = 'packages/brand/src/brands'
const RESOLVE = 'packages/brand/src/resolve.ts'

/**
 * Prettier's own entry point, run through this Node rather than through
 * `pnpm exec`.
 *
 * A shelled-out `pnpm` on Windows needs `shell: true`, which Node now warns
 * about on every run — and the warning is the last thing printed, so it lands
 * under the list of placeholders that is the actual point of the output.
 */
const PRETTIER = 'node_modules/prettier/bin/prettier.cjs'

// --- arguments -------------------------------------------------------------

function parseArgs(argv) {
  const get = (flag) => {
    const index = argv.indexOf(`--${flag}`)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const key = get('key')
  const nameEn = get('name-en')
  const primary = get('primary')

  if (!key || !nameEn || !primary) {
    throw new Error(
      [
        'Usage: pnpm brand:new --key <key> --name-en "<name>" --primary "#rrggbb"',
        '',
        'Optional:',
        '  --accent "#rrggbb"   the second brand colour; the chrome is cut from it',
        '  --name-ar, --legal-en, --legal-ar, --tagline-en, --tagline-ar',
        '  --short <ABC>        collapsed sidebar and favicon text',
        '  --established <year>',
        '  --website, --portal, --tracking, --support-email, --support-phone',
        '  --address-en, --address-ar',
        '  --monogram <letter>  drawn in the tile when there is no artwork',
        '  --favicon <emoji>',
        '  --logo-svg <path>    the client’s own mark; replaces the monogram',
        '  --radius <px>        corner radius; 14 unless the brand says otherwise',
        '  --force              overwrite an existing brand file',
      ].join('\n'),
    )
  }

  if (!/^[a-z][a-z0-9-]*$/.test(key)) {
    // The key is an environment value, a file name and an identifier stem.
    // Constraining it here beats discovering the constraint when `BRAND=Acme
    // Logistics` fails to resolve on a deployment nobody is watching.
    throw new Error(`--key must be lower-case letters, digits and hyphens: got "${key}"`)
  }

  for (const [flag, value] of [
    ['primary', primary],
    ['accent', get('accent')],
  ]) {
    if (value !== undefined && !/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) {
      throw new Error(`--${flag} must be a hex colour such as #0b5fff: got "${value}"`)
    }
  }

  return {
    key,
    nameEn,
    primary,
    accent: get('accent'),
    nameAr: get('name-ar'),
    legalEn: get('legal-en'),
    legalAr: get('legal-ar'),
    taglineEn: get('tagline-en'),
    taglineAr: get('tagline-ar'),
    short: get('short'),
    established: get('established'),
    website: get('website'),
    portal: get('portal'),
    tracking: get('tracking'),
    supportEmail: get('support-email'),
    supportPhone: get('support-phone'),
    addressEn: get('address-en'),
    addressAr: get('address-ar'),
    monogram: get('monogram'),
    favicon: get('favicon'),
    logoSvg: get('logo-svg'),
    radius: get('radius'),
    force: argv.includes('--force'),
  }
}

// --- derivations -----------------------------------------------------------

/** `acme-logistics` becomes `acmeLogistics`. */
const camel = (key) => key.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase())

/** `acme-logistics` becomes `ACME_LOGISTICS`. */
const constant = (key) => key.toUpperCase().replace(/-/g, '_')

/**
 * The words that identify a company's legal form rather than the company.
 *
 * Dropped before taking initials, because every forwarder in the Gulf is a Co.
 * or a W.L.L. and `ALW` distinguishes nobody from anybody.
 */
const LEGAL_FORMS = new Set([
  'and',
  'co',
  'co.',
  'company',
  'corp',
  'corp.',
  'est',
  'est.',
  'gmbh',
  'inc',
  'inc.',
  'llc',
  'l.l.c',
  'ltd',
  'ltd.',
  'plc',
  'pvt',
  'sa',
  'srl',
  'wll',
  'w.l.l',
])

/** Two or three characters for the collapsed sidebar and the favicon. */
function initials(nameEn) {
  const letters = nameEn
    .split(/[\s&,]+/)
    .filter(Boolean)
    .filter((word) => !LEGAL_FORMS.has(word.toLowerCase()))
    .flatMap((word) => word.split('-'))
    .map((word) => word[0])
    .filter((letter) => /[A-Za-z]/.test(letter ?? ''))
    .slice(0, 3)
    .join('')
    .toUpperCase()

  return letters || nameEn.slice(0, 3).toUpperCase()
}

/** `https://www.acme.com` becomes `acme.com`; RFC 2606 when there is nothing. */
function mailDomain(website) {
  if (!website) return 'example.com'
  try {
    return new URL(website).hostname.replace(/^www\./, '')
  } catch {
    return 'example.com'
  }
}

/** A single-quoted TypeScript string literal. */
function quote(value) {
  const escaped = String(value).split('\\').join('\\\\').split("'").join("\\'")
  return `'${escaped}'`
}

// --- what is still a default, and therefore worth saying out loud ----------

function placeholderNotes(options, hasArtwork) {
  const notes = []
  if (!options.nameAr) {
    notes.push('identity.nameAr and legalNameAr — the English text stands in')
  }
  if (!options.taglineAr && options.taglineEn) {
    notes.push('identity.taglineAr — the English tagline stands in')
  }
  if (!options.established) {
    notes.push('identity.established — empty, so no founding year prints')
  }
  if (!options.website) {
    notes.push('contact.websiteUrl, portalUrl and trackingUrl — a reserved domain')
  }
  if (!options.supportEmail) {
    notes.push(
      options.website
        ? 'contact.supportEmail — guessed from the website, so confirm it exists'
        : 'contact.supportEmail — a reserved domain',
    )
  }
  if (!options.supportPhone) notes.push('contact.supportPhone — empty')
  if (!options.addressEn) notes.push('contact.addressEn and addressAr — empty')
  notes.push('documents.registrations — the CR and customs licence numbers (empty prints nothing)')
  if (!hasArtwork) {
    notes.push('logo — a generated monogram tile, not the client’s own mark')
  }
  return notes
}

// --- the generated files ---------------------------------------------------

function markFile(options, svg) {
  const flattened = svg.replace(/\s*\n\s*/g, ' ').trim()

  return `/**
 * ${options.nameEn}'s mark, as the client supplied it.
 *
 * Not hand-authored, and not ours to tidy: the fills are theirs. If it does
 * not hold up at 20px in the collapsed sidebar, or inverted on the dark
 * chrome, ask for the version their designer would put on a dark background
 * rather than editing this one.
 */

export const ${constant(options.key)}_MARK_SVG =
  ${quote(flattened)}
`
}

function accentDeclaration(options) {
  if (options.accent) return `const accent = hexRamp(${quote(options.accent)})`

  return `/*
  One colour was supplied, so the accent is the same ramp.

  Give it a real second colour as soon as the brand manual has one. The
  navigation chrome, the chart accents and every highlight in the product are
  cut from the accent, and a brand whose accent *is* its primary spends its
  loudest colour on its most permanent furniture.
*/
const accent = primary`
}

function logoBlock(options, hasArtwork) {
  const letter = quote(options.monogram ?? options.nameEn[0].toUpperCase())

  if (hasArtwork) {
    return `    kind: 'custom',
    customSvg: ${constant(options.key)}_MARK_SVG,
    monogramLetter: ${letter},
    showWaves: false,`
  }

  return `    kind: 'monogram',
    monogramLetter: ${letter},
    showWaves: true,`
}

function brandFile(options, hasArtwork) {
  const domain = mailDomain(options.website)
  const notes = placeholderNotes(options, hasArtwork)
  const markImport = hasArtwork
    ? `\nimport { ${constant(options.key)}_MARK_SVG } from './${options.key}-mark'`
    : ''

  return `/**
 * ${options.nameEn} — a client, reached with \`BRAND=${options.key}\`.
 *
 * Generated by \`pnpm brand:new\`. **The values below are placeholders, and
 * each one prints on a customer-facing document exactly as it stands:**
 *
${notes.map((note) => ` *   - ${note}`).join('\n')}
 *
 * The colours are not placeholders. \`hexRamp\` converts the hex the client
 * supplied and lowers its peak chroma to the most an eleven-stop ramp can
 * carry before a stop clips — the judgement \`brands/qabandi.ts\` records in
 * prose, done arithmetically. Keeping the hex here rather than the OKLCH it
 * resolves to is deliberate: a hex can be checked against a brand manual and
 * three decimals cannot.
 */

import { defineBrand } from '../define'
import { chromeRampFor, hexRamp, neutralHueFor } from '../palette'${markImport}

const primary = hexRamp(${quote(options.primary)})
${accentDeclaration(options)}

export const ${camel(options.key)}Brand = defineBrand({
  identity: {
    key: ${quote(options.key)},
    nameEn: ${quote(options.nameEn)},
    nameAr: ${quote(options.nameAr ?? options.nameEn)},
    legalNameEn: ${quote(options.legalEn ?? options.nameEn)},
    legalNameAr: ${quote(options.legalAr ?? options.nameAr ?? options.nameEn)},
    shortName: ${quote(options.short ?? initials(options.nameEn))},
    taglineEn: ${quote(options.taglineEn ?? '')},
    taglineAr: ${quote(options.taglineAr ?? options.taglineEn ?? '')},
    established: ${quote(options.established ?? '')},
  },

  contact: {
    websiteUrl: ${quote(options.website ?? `https://${domain}`)},
    portalUrl: ${quote(options.portal ?? `https://portal.${domain}`)},
    trackingUrl: ${quote(options.tracking ?? `https://track.${domain}`)},
    supportEmail: ${quote(options.supportEmail ?? `info@${domain}`)},
    supportPhone: ${quote(options.supportPhone ?? '')},
    addressEn: ${quote(options.addressEn ?? '')},
    addressAr: ${quote(options.addressAr ?? options.addressEn ?? '')},
  },

  documents: {
    // The client's to supply. Inventing plausible numbers would put a false
    // registration on every quotation this deployment prints; an empty value
    // prints nothing, label included.
    registrations: [
      { labelEn: 'Commercial Registration', labelAr: 'السجل التجاري', value: '' },
      { labelEn: 'Customs Licence', labelAr: 'رخصة جمركية', value: '' },
    ],
    registrationNoteEn: '',
    registrationNoteAr: '',
    footerEn: 'All business is transacted under our Standard Trading Conditions.',
    footerAr:
      'تخضع جميع المعاملات لشروط التعامل القياسية لدينا.',
    tradingConditionsEn: 'Subject to our Standard Trading Conditions.',
    tradingConditionsAr:
      'تخضع لشروط التعامل القياسية لدينا.',
  },

  primary,
  accent,

  /*
    Derived rather than chosen. The rule is written down and the reasoning is
    worth keeping: a brand hue that sits on \`critical\` is not what a
    permanent sidebar should be cut from, or a real customs hold has nothing
    left to interrupt with. \`neutralHue\` is the value that tints the
    rail today — \`chromeRampFor\` says which of them decides what.
  */
  chromeRamp: chromeRampFor(primary.hue, accent.hue),
  neutralHue: neutralHueFor(primary.hue, accent.hue),

  logo: {
${logoBlock(options, hasArtwork)}
    favicon: ${quote(options.favicon ?? '⚓')},
  },${options.radius ? `\n\n  shape: { radius: ${Number(options.radius)} },` : ''}
})
`
}

// --- registration ----------------------------------------------------------

/**
 * Adds the import and the `BRANDS` entry.
 *
 * Text manipulation on one known file rather than a parser: the shape of
 * `resolve.ts` is four lines long and stable, and a mis-edit is caught by the
 * typecheck and by `resolve.test.ts` the moment either runs.
 */
function register(key) {
  const source = readFileSync(RESOLVE, 'utf8')
  const name = `${camel(key)}Brand`

  if (source.includes(`from './brands/${key}'`)) {
    console.log(`   ${RESOLVE} already registers ${key}; leaving it alone`)
    return
  }

  const imports = [...source.matchAll(/^import \{ \w+ \} from '\.\/brands\/[\w-]+'$/gm)]
  const last = imports.at(-1)
  if (!last) throw new Error(`No brand imports found in ${RESOLVE}`)

  const block = /export const BRANDS: Record<string, Brand> = \{\n([\s\S]*?)\n\}/.exec(source)
  if (!block) throw new Error(`No BRANDS object found in ${RESOLVE}`)

  const property = /^[a-z][a-zA-Z0-9]*$/.test(key) ? key : `'${key}'`
  const entries = [...block[1].split('\n'), `  ${property}: ${name},`].sort((a, b) =>
    a.trim().localeCompare(b.trim()),
  )

  const updated = source
    .replace(block[0], `export const BRANDS: Record<string, Brand> = {\n${entries.join('\n')}\n}`)
    .replace(last[0], `${last[0]}\nimport { ${name} } from './brands/${key}'`)

  writeFileSync(RESOLVE, updated)
  console.log(`   registered ${key} in ${RESOLVE}`)
}

// --- main ------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2))
  const path = `${BRANDS_DIR}/${options.key}.ts`

  if (existsSync(path) && !options.force) {
    throw new Error(`${path} exists. Edit it, or pass --force to overwrite it.`)
  }

  let svg
  if (options.logoSvg) {
    if (!existsSync(options.logoSvg)) throw new Error(`No such file: ${options.logoSvg}`)
    svg = readFileSync(options.logoSvg, 'utf8')
    if (!svg.includes('<svg')) throw new Error(`${options.logoSvg} is not an SVG`)
  }

  console.log(`\nScaffolding ${options.nameEn} (${options.key})\n`)

  if (svg) {
    writeFileSync(`${BRANDS_DIR}/${options.key}-mark.ts`, markFile(options, svg))
    console.log(`   wrote ${BRANDS_DIR}/${options.key}-mark.ts`)
  }

  writeFileSync(path, brandFile(options, Boolean(svg)))
  console.log(`   wrote ${path}`)

  register(options.key)

  /*
    Formatted here rather than left to whoever next runs `pnpm format`, so a
    generated file never turns up as unrelated noise in somebody's diff.
  */
  spawnSync(
    process.execPath,
    [PRETTIER, '--write', '--log-level', 'warn', `${BRANDS_DIR}/${options.key}*.ts`, RESOLVE],
    { stdio: 'inherit' },
  )

  const notes = placeholderNotes(options, Boolean(svg))
  console.log(
    [
      '',
      `── ${options.nameEn} is registered. BRAND=${options.key} now resolves.`,
      '',
      '   Still a placeholder, and each one prints on a customer-facing document:',
      '',
      ...notes.map((note) => `     · ${note}`),
      '',
      `   Check it: BRAND=${options.key} pnpm dev, then Settings › Brand, which`,
      '   lists every resolved value beside the variable that overrides it.',
      '',
    ].join('\n'),
  )

  if (svg) {
    const box = /viewBox="([\d.\s-]+)"/.exec(svg)
    const numbers = box ? box[1].trim().split(/\s+/).map(Number) : []
    const [width, height] = [numbers[2], numbers[3]]
    if (width && height && Math.abs(width - height) / Math.max(width, height) > 0.05) {
      console.log(
        `   Note: the mark's viewBox is ${width}×${height}, not square. It will\n` +
          '   still render — check it collapsed in the sidebar and as the favicon.\n',
      )
    }
  }
}

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
