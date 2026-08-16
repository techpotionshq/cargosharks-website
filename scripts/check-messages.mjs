/**
 * Message-catalogue check.
 *
 * Two failures this catches, both of which reach production as visible text
 * rather than as an error:
 *
 *   1. **A key used in code that neither catalogue defines.** `next-intl`
 *      renders the raw key path — an operator sees `partners.types.terminal`
 *      in the middle of a table and reasonably concludes the software is
 *      broken.
 *   2. **A key present in English and missing in Arabic** (or the reverse).
 *      Half a screen silently falls back to the other language, which is worse
 *      than either language alone because it looks deliberate.
 *
 * Static `t('literal')` calls only — a template-interpolated key cannot be
 * resolved without running the code, so those are reported separately as
 * unverifiable rather than silently passed.
 */

import { globSync, readFileSync } from 'node:fs'

const catalogues = {
  en: JSON.parse(readFileSync('apps/web/messages/en.json', 'utf8')),
  ar: JSON.parse(readFileSync('apps/web/messages/ar.json', 'utf8')),
}

/** Flattens `{a: {b: 1}}` to the set `{"a.b"}`. */
function keysOf(node, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) keysOf(value, path, out)
    else out.add(path)
  }
  return out
}

const defined = { en: keysOf(catalogues.en), ar: keysOf(catalogues.ar) }

// --- 1. every key defined in one language exists in the other -------------

let failures = 0
for (const [have, want] of [
  ['en', 'ar'],
  ['ar', 'en'],
]) {
  const missing = [...defined[have]].filter((key) => !defined[want].has(key)).sort()
  if (missing.length) {
    console.error(`\n${missing.length} key(s) in ${have} but not in ${want}:`)
    for (const key of missing.slice(0, 40)) console.error(`  ${key}`)
    if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`)
    failures += missing.length
  }
}

// --- 2. every key used in code is defined ---------------------------------

/**
 * `getTranslations('ns')` / `useTranslations('ns')` bind a namespace to a
 * local name; `t('key')` then resolves against it. Both are tracked per file,
 * because one file routinely holds six.
 */
const BIND =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g
const CALL = /\b(\w+)\(\s*'([^']+)'/g
const DYNAMIC = /\b(\w+)\(\s*`/g

const used = new Map() // key -> file
const dynamic = []

for (const file of globSync('apps/web/src/**/*.{ts,tsx}')) {
  const source = readFileSync(file, 'utf8')

  const namespaces = new Map()
  for (const match of source.matchAll(BIND)) namespaces.set(match[1], match[2])
  if (!namespaces.size) continue

  for (const match of source.matchAll(CALL)) {
    const namespace = namespaces.get(match[1])
    if (namespace) used.set(`${namespace}.${match[2]}`, file)
  }
  for (const match of source.matchAll(DYNAMIC)) {
    if (namespaces.has(match[1])) dynamic.push(`${file}: ${namespaces.get(match[1])}.\`…\``)
  }
}

const undefinedKeys = [...used].filter(([key]) => !defined.en.has(key)).sort()
if (undefinedKeys.length) {
  console.error(`\n${undefinedKeys.length} key(s) used in code but not defined:`)
  for (const [key, file] of undefinedKeys) console.error(`  ${key}\n    ${file}`)
  failures += undefinedKeys.length
}

// --- 3. enum-backed groups cover every value the enum can hold ------------

/**
 * The keys a static scan cannot see.
 *
 * `t(\`types.${row.type}\`)` resolves at run time from a database enum, so the
 * check above passes it over and the gap only shows up as a raw key path in
 * the middle of a table — which is exactly how `partners.types.terminal`
 * reached a screen.
 *
 * The enum is the authority, so it is read from the schema and every value is
 * required to have a label. `pgEnum('name', [...])` is a literal array, so
 * this needs no database connection.
 */
const ENUM_GROUPS = {
  partner_type: ['partners.types'],
  transport_mode: ['mode'],
  trade_direction: ['direction'],
  job_status: ['job.statuses'],
  enquiry_status: ['enquiry.statuses'],
  quote_status: ['quotes.statuses'],
  invoice_status: ['invoices.statuses'],
  customs_status: ['customs.statuses', 'customsForm.statuses'],
  exception_severity: ['job.severities', 'exceptionForm.severities', 'referenceForm.severities'],
  charge_basis: ['referenceForm.bases'],
}

const schemaSource = globSync('packages/db/src/schema/*.ts')
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

const enumValues = new Map()
for (const match of schemaSource.matchAll(/pgEnum\(\s*'([a-z_]+)'\s*,\s*\[([^\]]*)\]/g)) {
  enumValues.set(
    match[1],
    [...match[2].matchAll(/'([^']+)'/g)].map((v) => v[1]),
  )
}

for (const [enumName, groups] of Object.entries(ENUM_GROUPS)) {
  const values = enumValues.get(enumName)
  if (!values) {
    console.error(`\nenum ${enumName} not found in the schema — update ENUM_GROUPS.`)
    failures++
    continue
  }
  for (const group of groups) {
    for (const language of ['en', 'ar']) {
      const missing = values.filter((value) => !defined[language].has(`${group}.${value}`))
      if (missing.length) {
        console.error(
          `\n${group} (${language}) is missing ${missing.length} of ${values.length} ` +
            `${enumName} value(s): ${missing.join(', ')}`,
        )
        failures += missing.length
      }
    }
  }
}

const uniqueDynamic = [...new Set(dynamic)]
console.log(
  `\nchecked ${used.size} static key(s) against ${defined.en.size} defined, ` +
    `plus ${Object.keys(ENUM_GROUPS).length} enum-backed group(s); ` +
    `${uniqueDynamic.length} interpolated call site(s) remain unverifiable.`,
)

if (failures) {
  console.error(`\n${failures} message problem(s).`)
  process.exit(1)
}
console.log('messages: en and ar agree, and every static key resolves — ok')
