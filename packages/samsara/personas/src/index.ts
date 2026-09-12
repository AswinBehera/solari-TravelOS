// @samsara/personas — Persona lifecycle: create, keepalive, health, ban detection.
//
// No vertical vocabulary appears here. In particular `keepalive` takes its pages
// as an argument: which pages an identity ordinarily reads is a fact about a
// vertical, and `pnpm check:seam` fails the build if this package learns one.
//
// `./postgres` is a separate entry point, like the kernel's, so importing the
// package does not drag a database driver into a runtime that cannot load one.

export * from "./create.js"
export * from "./health.js"
export * from "./keepalive.js"
export * from "./lifecycle.js"
export * from "./store.js"

export const PACKAGE = "@samsara/personas" as const
