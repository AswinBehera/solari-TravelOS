import type { PersonaHealth, SessionOutcome } from "@samsara/core"

/**
 * Ban detection (plan section P1.1), as a pure function of what the sessions
 * table already says.
 *
 * No streak counter is stored on the persona row, and that is the design rather
 * than an omission. A stored counter is a second copy of a fact the `sessions`
 * rows already hold, it drifts the first time a write is missed, and — the part
 * that matters here — it freezes the *rule* into the data. Deriving instead means
 * a change to the thresholds below is retroactive: every persona is re-judged by
 * the new rule against the same evidence, rather than carrying a health state
 * assigned months ago by a rule nobody can reconstruct.
 */

/** Two refusals in a row is a pattern. One is a Tuesday. */
export const BLOCKS_TO_DEGRADE = 2
/** Three is the identity, not the weather. */
export const BLOCKS_TO_BAN = 3
/**
 * Recovery is slower than decline, deliberately. A single clean session after a
 * refusal is very often the surface's own flakiness rather than our rehabilitation,
 * and flapping between `healthy` and `degraded` destroys the one signal the state
 * is for — noticing a trend early enough to stop spending on it.
 */
export const CLEAN_TO_RECOVER = 2

/**
 * Only two outcomes are verdicts about the identity.
 *
 * `blocked` is the surface refusing *us*. `ok` is it not refusing us. Everything
 * else — `timeout` (our deadline), `error` (our code or the provider's),
 * `orphaned` (a cancelled runner), `running` (not finished) — says nothing about
 * what the surface thinks, so it is skipped rather than counted as either. That
 * choice matters: treating a timeout as evidence of health would let a persona
 * launder three refusals through three slow pages, and treating it as evidence of
 * blocking would ban identities for a deploy of ours.
 */
const isVerdict = (o: SessionOutcome): o is "ok" | "blocked" => o === "ok" || o === "blocked"

export interface HealthAssessment {
  health: PersonaHealth
  changed: boolean
  /** Leading run of refusals, in verdicts only. */
  blockStreak: number
  /** Leading run of clean sessions, in verdicts only. */
  cleanStreak: number
  /** Kernel-safe: counts and state names, never page text. */
  reason: string
}

/**
 * @param recent Outcomes newest first — the order `ORDER BY started_at DESC` gives.
 *   Passing them oldest-first silently inverts every streak, so the argument name
 *   and this sentence are the whole defence; `health.test.ts` asserts the direction.
 */
export function assess(
  current: PersonaHealth,
  recent: readonly SessionOutcome[],
): HealthAssessment {
  const verdicts = recent.filter(isVerdict)
  let blockStreak = 0
  let cleanStreak = 0
  for (const v of verdicts) {
    if (v === "blocked") blockStreak += 1
    else break
  }
  for (const v of verdicts) {
    if (v === "ok") cleanStreak += 1
    else break
  }

  const settle = (health: PersonaHealth, reason: string): HealthAssessment => ({
    health,
    changed: health !== current,
    blockStreak,
    cleanStreak,
    reason,
  })

  // Both are absorbing, for different reasons. `retired` is our own decision and
  // evidence does not overturn a decision. `banned` is the profile's cookies being
  // burned: a later clean session means the surface is inconsistent, not that the
  // identity recovered, and the cheap, correct move is a new persona rather than
  // more minutes spent testing whether this one is forgiven.
  if (current === "retired") return settle("retired", "retired is a decision, not an observation")
  if (current === "banned") return settle("banned", "banned is terminal; create a new persona")

  if (blockStreak >= BLOCKS_TO_BAN) {
    return settle("banned", `${blockStreak} consecutive blocked sessions`)
  }
  if (blockStreak >= BLOCKS_TO_DEGRADE) {
    return settle("degraded", `${blockStreak} consecutive blocked sessions`)
  }
  if (current === "degraded" && cleanStreak >= CLEAN_TO_RECOVER) {
    return settle("healthy", `${cleanStreak} consecutive clean sessions`)
  }
  return settle(current, `${verdicts.length} verdicts, no threshold crossed`)
}

/**
 * How many *verdicts* the assessment needs to be able to reach every threshold.
 *
 * Not the same as how many rows to read: non-verdicts are skipped, so a persona
 * that just survived four timeouts has four rows and zero evidence. Callers scan
 * further back (see `SESSION_SCAN_DEPTH`) and let the filter do the work. Reading
 * too few rows makes a ban unreachable, which is the direction that costs money.
 */
export const VERDICTS_NEEDED = Math.max(BLOCKS_TO_BAN, CLEAN_TO_RECOVER)

/**
 * How many session rows to read to find them. The multiplier is a guess at how
 * often a session ends without a verdict, and it is deliberately generous: the
 * query is indexed and bounded, and being wrong upward costs a few rows while
 * being wrong downward costs a persona that can never be banned.
 */
export const SESSION_SCAN_DEPTH = VERDICTS_NEEDED * 4
