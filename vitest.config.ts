import { defineConfig } from 'vitest/config'

/**
 * One coverage report across every package — `pnpm coverage`.
 *
 * The per-package configs stay where they are and keep working on their own;
 * this composes them so the number CI enforces is a number for the *product*
 * rather than four numbers nobody adds up. Running them separately hid the
 * shape of the gap: the domain engines are exhaustively tested and the code
 * that writes money to the database was not, and two healthy-looking reports
 * side by side never said so.
 *
 * `pnpm test:db` and the mutation suites need a database and skip without one,
 * so a coverage run on a machine with no `TEST_DATABASE_URL` reports several
 * points below the truth. The thresholds below are set against a run *with* a
 * database, which is what CI does — see the `database` job. Locally, either
 * export the two `TEST_*` URLs or read the report for gaps rather than as a
 * gate.
 */
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/db', 'apps/web', 'apps/service'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',

      /*
        Measure the code we write, not the code we generate or configure.
        Migrations are SQL, fixtures are data, and a seed script is exercised
        by `test:db` running it rather than by asserting on its internals.
      */
      /*
        `.ts` only, deliberately — no `.tsx`.

        React components are exercised by Playwright (`pnpm test:e2e`), which
        reports separately and does not feed this number. Counting them here
        would put ninety untested-by-this-suite files in the denominator and
        make the figure say "the product is untested" when what it means is
        "components are tested by the other runner". The v8 provider also
        cannot parse JSX when it walks uncovered files, so including them emits
        a parse error per component on every run.
      */
      include: [
        'packages/core/src/**/*.ts',
        'packages/db/src/**/*.ts',
        'apps/web/src/**/*.ts',
        'apps/service/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/.next/**',
        // Data and scaffolding, not logic.
        'packages/db/src/seed*.ts',
        'packages/db/src/schema/**',
        'apps/web/src/lib/pilot/fixtures.ts',
        'apps/web/src/features/imports/descriptors.ts',
        /*
          Operator tooling and process wiring: verified by running it.

          The `verify-*` scripts are themselves verification — they stand up a
          real chain and print what came out, which is why they exist alongside
          the unit tests rather than instead of them. Counting them as
          production code to be covered would mean writing tests for the test
          harness.

          `workers/index.ts` and `service/src/index.ts` are registration and
          boot: a list of job names bound to handlers, and the handlers are
          where the behaviour is.
        */
        'packages/db/src/fleet*.ts',
        'packages/db/src/provision.ts',
        'packages/db/src/create-*.ts',
        'packages/db/src/tenant-new.ts',
        'packages/db/src/migrate.ts',
        '**/verify-*.ts',
        'apps/service/src/index.ts',
        'apps/service/src/workers/index.ts',
      ],

      /*
        A floor, not a target.

        Set just under what the suite achieves today, so the gate catches a
        regression rather than blocking work on the day it lands. Raise it when
        coverage rises — a threshold that is never raised is a threshold that
        stops meaning anything.
      */
      thresholds: {
        lines: 81,
        functions: 78,
        branches: 69,
        statements: 79,
      },
    },
  },
})
