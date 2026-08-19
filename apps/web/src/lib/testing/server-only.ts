/**
 * A stand-in for the `server-only` package under Vitest.
 *
 * `server-only` exists to make a build fail when a server module is pulled
 * into a client bundle: its published entry point throws on import from a
 * client context. Vitest is neither, so importing the real thing fails with
 * "This module cannot be imported from a Client Component module" and takes
 * the whole suite with it — the guard firing on a build that is not happening.
 *
 * Aliased in `vitest.config.ts`. Empty on purpose: the marker has no runtime
 * behaviour worth reproducing.
 */

export {}
