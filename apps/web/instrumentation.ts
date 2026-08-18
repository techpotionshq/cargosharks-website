/**
 * Telemetry registration — Next's `instrumentation` hook.
 *
 * Runs once per server process, before anything serves. Three decisions are
 * encoded here and each is worth stating, because the wrong one is expensive
 * to reverse:
 *
 * **1. OpenTelemetry, not a vendor SDK.** Instrumenting against a vendor means
 * re-instrumenting to leave them. OTel is the same abstraction the `ports` rule
 * in `apps/service/src/ports/index.ts` asks for — except it is an industry
 * standard rather than something we maintain, so switching backend is an
 * endpoint change rather than a project.
 *
 * **2. A tenant dimension on everything.** A fleet of single-tenant
 * deployments is unsupportable if telemetry cannot answer "which customer".
 * `QABANDI_TENANT` names the deployment; `packages/db/src/actor.ts` adds the
 * principal and branch to every span from the one place that knows them.
 *
 * **3. Silent when unconfigured.** No `OTEL_EXPORTER_OTLP_ENDPOINT`, no
 * exporter — the API degrades to no-ops. A developer without an account, and
 * the offline pilot laptop, both run unchanged.
 */

/**
 * Configuration that must be right before the process takes traffic.
 *
 * `register()` runs once at start-up, before anything is served — which makes
 * it the only place in a Next application where "refuse to start" is a thing
 * you can actually do.
 *
 * That distinction was learned the expensive way. This check lived at module
 * scope in `auth.ts` and threw while the auth chunk was being evaluated —
 * before React existed, so no error boundary could catch it, `global-error`
 * included. Every request answered a bare `Internal Server Error` whose only
 * clue was a stack trace naming a compiled chunk. It claimed to refuse to
 * start and in fact refused to *serve*, one request at a time.
 *
 * Failing here is louder and kinder: the deployment does not come up, the
 * platform's own health check catches it, and the message is in the boot log
 * where whoever deployed it is already looking.
 *
 * Only production. A developer with a fresh clone and no `.env` should still
 * get a running application.
 */
function requireProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return
  // `next build` also runs as production and needs none of these.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const problems: string[] = []

  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.includes('replace-me')) {
    problems.push(
      'BETTER_AUTH_SECRET is unset or still the .env.example placeholder. ' +
        'Better Auth would fall back to a shared default signing key, so a session ' +
        'minted against any deployment would be accepted by every other. ' +
        'Generate one per tenant: openssl rand -base64 32',
    )
  }

  /*
    Fixture mode is a legitimate production configuration — it is what the
    day-15 rehearsal runs — so a missing DATABASE_URL is only a problem when
    fixtures are off. `lib/pilot/source.ts` owns that predicate; this repeats
    the shape rather than importing it, because importing application code
    into the boot hook is how a boot hook grows a dependency on the thing it
    is supposed to validate.
  */
  if (!process.env.DATABASE_URL && process.env.QABANDI_PILOT_FIXTURES !== '1') {
    problems.push(
      'DATABASE_URL is unset and QABANDI_PILOT_FIXTURES is not 1. The application ' +
        'has no data source: set one, or run the pilot fixtures deliberately.',
    )
  }

  if (problems.length > 0) {
    throw new Error(
      [
        `Refusing to start — ${problems.length} configuration problem(s):`,
        '',
        ...problems.map((problem, index) => `  ${index + 1}. ${problem}`),
      ].join('\n'),
    )
  }
}

export async function register(): Promise<void> {
  // Instrumentation is Node-only. The edge runtime gets none of this, and
  // importing the SDK there fails the build rather than degrading.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  requireProductionConfig()

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  const { registerOTel } = await import('@vercel/otel')

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'qabandi-web',
    attributes: {
      /*
        Which deployment this is.

        The single most important attribute in a per-customer fleet: without
        it every dashboard aggregates fifteen operators into one meaningless
        average, and the first question of every incident — "is this everyone
        or is this one customer" — has no answer.

        Deliberately the tenant *key*, not the operator's legal name. The
        brand carries the name for display; telemetry needs a stable
        identifier that does not change when a customer rebrands.
      */
      'qabandi.tenant': process.env.QABANDI_TENANT ?? 'unknown',
      'qabandi.brand': process.env.BRAND ?? 'qabandi',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    },
  })
}

/**
 * Uncaught server errors, forwarded to whatever is configured.
 *
 * Next calls this for errors it would otherwise only log. Keeping it here
 * rather than in a vendor SDK's automatic patching means the tenant tag is
 * attached on the way out, which is what makes an error report actionable in a
 * fleet: "a 500 happened" is noise, "a 500 happened at Al-Qabandi on the
 * invoice register" is a ticket.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { trace } = await import('@opentelemetry/api')
  const span = trace.getActiveSpan()

  span?.recordException(error instanceof Error ? error : new Error(String(error)))
  span?.setAttribute('qabandi.tenant', process.env.QABANDI_TENANT ?? 'unknown')
  span?.setAttribute('http.route', request.path)

  // Always on stderr as well: the container's log stream is the one collector
  // that is always present, and an error visible only in a backend nobody has
  // configured yet is an error nobody sees.
  console.error(
    JSON.stringify({
      level: 'error',
      tenant: process.env.QABANDI_TENANT ?? 'unknown',
      method: request.method,
      path: request.path,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  )
}
