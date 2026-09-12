// @samsara/harvest — Run orchestration: identity x source x query -> RawItem[].
//
// What exists today is the measurement half: a factorial design over viewpoint
// signals (`matrix.ts`) and the comparison of what each cell returned
// (`overlap.ts`). Both are pure and network-free, which is the point — the
// expensive part of an experiment is the sessions, and none of the arithmetic
// that reads them should need one.
//
// The adapter orchestration proper lands in P1.2.

export * from "./matrix.js"
export * from "./overlap.js"

export const PACKAGE = "@samsara/harvest" as const
