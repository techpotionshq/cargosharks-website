/**
 * Telemetry for the service — imported first, before anything else.
 *
 * Ordering is the whole trick and it is easy to get wrong: OpenTelemetry's
 * automatic instrumentation works by patching modules as they are required, so
 * the SDK has to start before `fastify` or `pg` is imported. Anything loaded
 * ahead of it is invisible for the life of the process, and the symptom — a
 * trace with the HTTP span and no database spans underneath — looks like a
 * sampling problem rather than an import-order one.
 *
 * `apps/service/src/index.ts` imports this on its first line for that reason.
 *
 * Silent when unconfigured. Without `OTEL_EXPORTER_OTLP_ENDPOINT` nothing
 * starts, `@opentelemetry/api` degrades to no-ops, and the process runs
 * exactly as it did before — which is what keeps a developer's laptop and the
 * offline pilot environment free of a dependency on a collector.
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

let sdk: NodeSDK | undefined

/*
  Started at module scope, on purpose.

  `import` declarations are hoisted: a `startTelemetry()` call placed between
  two imports in `index.ts` would still run *after* both modules had been
  evaluated, and the patching would come too late for either. What does work is
  ordinary ES module evaluation order — a module is evaluated when it is first
  imported, in declaration order — so making this a side effect of the import
  and putting that import first is the only arrangement that actually holds.
*/
function start(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'qabandi-service',
      [ATTR_SERVICE_VERSION]: process.env.QABANDI_VERSION ?? '0.0.0',
      /*
        Which deployment this is — the attribute the whole fleet story rests
        on. Without it, fifteen operators average into one meaningless line and
        the first question of any incident ("everyone, or one customer?") is
        unanswerable.
      */
      'qabandi.tenant': process.env.QABANDI_TENANT ?? 'unknown',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        /*
          Filesystem spans are switched off deliberately. They are the single
          noisiest instrumentation in the set — every template read, every
          static asset — and on a usage-billed backend they are most of the
          bill for none of the insight.
        */
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })

  sdk.start()
}

start()

/**
 * Flush on the way out.
 *
 * A span batch that is still buffered when the process exits is a span batch
 * nobody sees, and the spans that matter most — the ones from the request that
 * crashed the worker — are exactly the ones still in the buffer.
 */
export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown().catch(() => {})
}
