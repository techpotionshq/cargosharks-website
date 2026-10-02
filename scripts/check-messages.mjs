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
 *
 * A binding name maps to a *set* of namespaces, not to one.
 *
 * This is a file-level scan with no notion of function scope, and `const t =`
 * is the conventional name — so a file with three server actions has three
 * bindings called `t` against three different namespaces. Keeping only the
 * last one made the check wrong in both directions: it reported keys as
 * undefined when they were defined under the namespace actually in scope, and
 * it would pass a genuinely missing key that happened to exist under one of
 * the others.
 *
 * Resolving against any namespace the name is bound to in the file removes the
 * false positives outright. It leaves a narrow false negative — a key defined
 * under the wrong one of two namespaces in the same file — which is the same
 * limit a scan without scope analysis has always had, and far cheaper than
 * parsing TypeScript here to close it.
 */
const BIND =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g

/**
 * The *other* way this codebase binds a namespace, and the reason this file
 * once passed a screen that threw `MISSING_MESSAGE` on every render:
 *
 *   const [options, t, tc] = await Promise.all([
 *     loadOptions(actor),
 *     getTranslations('branchForm'),
 *     getTranslations('common'),
 *   ])
 *
 * `BIND` cannot match that — the binding is a destructuring pattern, not a
 * name — so the file registered *no* namespaces at all and the scan below
 * skipped it whole. Thirty-two files went unchecked that way, and they were
 * disproportionately the dialogs: every create-and-edit form in the product.
 * `BranchDialog` read twelve keys that live under `branches.*` through the
 * `branchForm` namespace, and nothing failed until the dialog was opened.
 *
 * Pairing is positional, so the array has to be split on *top-level* commas —
 * a nested `f(a, b)` argument is not an element boundary.
 */
const DESTRUCTURED =
  /(?:const|let)\s*\[([^\]]+)\]\s*=\s*(?:await\s+)?Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g
const NAMESPACE_ARG = /^(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)$/

/**
 * Splits an array literal's body on commas that are not inside brackets.
 *
 * Comments come out first, and that is not tidiness: the arrays this runs over
 * are heavily commented in the house style, and prose commas are indis-
 * tinguishable from element boundaries once you are counting brackets. One
 * comment in `payables/[id]` shifted every element one place right and bound
 * `tc` to `payables` instead of `common`, which reported a key that was never
 * missing.
 */
function topLevelElements(body) {
  const source = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      out.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(source.slice(start).trim())
  return out
}

/**
 * The third binding: a translator handed *in*, as a parameter declaring its
 * namespace in the type — `(tv: Translate<'customersValidation'>) => z.object(…)`.
 *
 * Validation schemas that carry catalogue messages are factories of the
 * translator, and some live in a pure `schema.ts` that never calls
 * `getTranslations` itself. With neither of the two forms above in the file it
 * registered no namespace and was skipped whole — its keys went unchecked. The
 * type argument is the declaration; this reads it.
 */
const TYPED_PARAM = /\b(\w+)\s*:\s*Translate<\s*'([^']+)'\s*>/g

/**
 * The source with its comments blanked, strings left intact.
 *
 * The scans below are regular expressions over text, and this codebase writes
 * long comments — some of which quote a call to explain it. A comment reading
 * like a call was reported as an undefined key, and the workaround was to write
 * worse comments. A regex cannot strip comments safely (`'https://…'` is not a
 * comment), so this walks the characters and skips string and template bodies.
 * Blanking rather than deleting keeps offsets, which nothing needs today but
 * costs nothing.
 */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch
      i++
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        // A newline ends an unterminated quote — a stray apostrophe in JSX
        // text must not swallow the rest of the file.
        if (source[i] === '\n' && ch !== '`') break
        out += source[i]
        i++
      }
      if (i < source.length) {
        out += source[i]
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

const CALL = /\b(\w+)\(\s*'([^']+)'/g
const DYNAMIC = /\b(\w+)\(\s*`/g

const used = new Map() // key -> file
const dynamic = []

for (const file of globSync('apps/web/src/**/*.{ts,tsx}')) {
  const source = stripComments(readFileSync(file, 'utf8'))

  const namespaces = new Map()
  const bind = (name, namespace) => {
    if (!namespaces.has(name)) namespaces.set(name, new Set())
    namespaces.get(name).add(namespace)
  }

  for (const match of source.matchAll(BIND)) bind(match[1], match[2])
  for (const match of source.matchAll(TYPED_PARAM)) bind(match[1], match[2])

  for (const match of source.matchAll(DESTRUCTURED)) {
    const names = match[1].split(',').map((name) => name.trim())
    topLevelElements(match[2]).forEach((element, index) => {
      const namespace = element.match(NAMESPACE_ARG)?.[1]
      if (namespace && names[index]) bind(names[index], namespace)
    })
  }

  if (!namespaces.size) continue

  for (const match of source.matchAll(CALL)) {
    const bound = namespaces.get(match[1])
    if (!bound) continue

    const candidates = [...bound].map((namespace) => `${namespace}.${match[2]}`)
    // Defined under any of them is defined; otherwise report the first, which
    // is the one a reader will look for.
    const resolved = candidates.find((key) => defined.en.has(key))
    used.set(resolved ?? candidates[0], file)
  }
  for (const match of source.matchAll(DYNAMIC)) {
    const bound = namespaces.get(match[1])
    if (bound) for (const namespace of bound) dynamic.push(`${file}: ${namespace}.\`…\``)
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

// --- 3a. every audited table has a name ------------------------------------

/**
 * The audit log names the table a write landed in, and used to print it raw —
 * `free_time_clocks`, `principal_branch_roles` — in both languages. Every table
 * the `0003` trigger loop audits is a `pgTable` in the schema (the same three
 * exclusions apply), so each is required to have a label under `audit.tables`,
 * and a new table cannot reach the log as a bare identifier.
 */
const auditedTables = [
  ...new Set([...schemaSource.matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map((match) => match[1])),
].filter(
  (name) =>
    !name.startsWith('auth_') &&
    !['audit_log', 'rate_limit_buckets', 'inbound_webhook_events'].includes(name),
)
for (const language of ['en', 'ar']) {
  const missing = auditedTables.filter((name) => !defined[language].has(`audit.tables.${name}`))
  if (missing.length) {
    console.error(`\naudit.tables (${language}) has no name for: ${missing.join(', ')}`)
    failures += missing.length
  }
}

// --- 3a'. one set of digits ------------------------------------------------

/**
 * Every figure in the product is Latin-digit — `formatNumber` and the money
 * formatters force `nu-latn` — so a catalogue string that types "٣٠" puts one
 * Arabic-Indic number on a screen of Western ones (the rates tile did, beside
 * four tiles of Latin digits).
 */
function walkStrings(node, path, visit) {
  if (typeof node === 'string') return visit(path, node)
  for (const [key, value] of Object.entries(node))
    walkStrings(value, path ? `${path}.${key}` : key, visit)
}
walkStrings(catalogues.ar, '', (path, text) => {
  if (/[\u0660-\u0669\u06f0-\u06f9]/.test(text)) {
    console.error(`\n${path} (ar) uses Arabic-Indic digits; the product writes 0–9: ${text}`)
    failures++
  }
})

// --- 3b. every notification event has a label ------------------------------

/**
 * The keys a static scan cannot see, part three.
 *
 * `settings/notifications` labels each event through `t(`events.${key}`)`, and
 * the events are `NOTIFICATION_EVENTS` in `packages/core/src/notifications.ts`.
 * `enquiry.received` was added there with a template and no label, and the
 * settings page showed `notificationTemplates.events.enquiry.received` in both
 * languages until a QA crawl read it off the screen.
 *
 * Every `key: 'a.b'` in that file is an event — it is a literal list, and the
 * only `key:` entries in it.
 */
const notificationSource = readFileSync('packages/core/src/notifications.ts', 'utf8')
const notificationEvents = [...notificationSource.matchAll(/\bkey:\s*'([a-z_]+\.[a-z_]+)'/g)].map(
  (match) => match[1],
)
if (notificationEvents.length === 0) {
  console.error(
    '\nno notification events found in packages/core/src/notifications.ts — update this check.',
  )
  failures++
}
for (const language of ['en', 'ar']) {
  const missing = notificationEvents.filter(
    (event) => !defined[language].has(`notificationTemplates.events.${event}`),
  )
  if (missing.length) {
    console.error(
      `\nnotificationTemplates.events (${language}) has no label for ${missing.length} ` +
        `event(s): ${missing.join(', ')}`,
    )
    failures += missing.length
  }
}

// --- 4. the integration catalogue's groups agree with each other ----------

/**
 * The keys a static scan cannot see, part two.
 *
 * `settings/integrations` renders every label through an interpolated call —
 * `t(`fields.${integration.key}.${field.name}`)` — because the form is
 * generated from `INTEGRATIONS` rather than written out ten times. That is the
 * right shape for the screen and it is invisible to the scan above, so the
 * gap shows up the way `partners.types.terminal` did: as a raw key path in the
 * middle of a settings page.
 *
 * The enum check above reads the schema, because the enum is the authority
 * there. Here the authority is a TypeScript literal built partly by a helper
 * function, and a regex over it would be a check that breaks when somebody
 * refactors the file rather than when they break the thing it protects.
 *
 * So this checks the five groups against *each other*. Every integration named
 * in `keys` must have a description, a field group and a secret group — which
 * is the drift that actually happens, because adding an integration means
 * touching all of them and there is no reason a person would remember which.
 * An integration added to the catalogue and to none of these is caught by the
 * page rendering its key path, one screen away.
 */
const integrations = catalogues.en.integrations
if (!integrations?.keys) {
  console.error('\nthe `integrations` message group is missing its `keys` block.')
  failures++
} else {
  const declared = Object.keys(integrations.keys)

  for (const language of ['en', 'ar']) {
    const group = catalogues[language].integrations ?? {}

    for (const key of declared) {
      // A description, and a group for the fields and secrets — even an empty
      // one, because "this integration has no settings" is a fact worth being
      // written down rather than inferred from an absence.
      for (const section of ['descriptions', 'fields', 'secrets']) {
        if (group[section]?.[key] === undefined) {
          console.error(
            `\nintegrations.${section}.${key} (${language}) is missing — ` +
              'every key in `integrations.keys` needs one.',
          )
          failures++
        }
      }
    }

    // The reverse direction: a label for an integration nobody declares is a
    // rename that was done in four places out of five.
    for (const section of ['descriptions', 'fields', 'secrets', 'drivers']) {
      for (const key of Object.keys(group[section] ?? {})) {
        if (!declared.includes(key)) {
          console.error(
            `\nintegrations.${section}.${key} (${language}) names an integration ` +
              'that `integrations.keys` does not.',
          )
          failures++
        }
      }
    }
  }
}

const uniqueDynamic = [...new Set(dynamic)]
console.log(
  `\nchecked ${used.size} static key(s) against ${defined.en.size} defined, ` +
    `plus ${Object.keys(ENUM_GROUPS).length} enum-backed group(s) ` +
    `and ${Object.keys(catalogues.en.integrations?.keys ?? {}).length} integration(s); ` +
    `${uniqueDynamic.length} interpolated call site(s) remain unverifiable.`,
)

if (failures) {
  console.error(`\n${failures} message problem(s).`)
  process.exit(1)
}
console.log('messages: en and ar agree, and every static key resolves — ok')
