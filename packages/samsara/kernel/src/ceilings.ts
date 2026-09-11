import { type MeterId, meterId } from "@samsara/core"
import { z } from "zod"

/**
 * The ceilings, in one file, as plan section 8 requires.
 *
 * Every number here is a **count**, never a price. Rates drift, currencies move,
 * and a guard that converts at runtime is a guard that can be wrong about whether
 * it is allowed to spend. The rate each count was derived from is in the comment
 * beside it, with the date it was read, so re-deriving is a two-minute job rather
 * than an archaeology project.
 *
 * Derived 11 September 2026 against a hard $20 total (section 8).
 */
export const DEFAULT_CEILINGS: Record<MeterId, number> = {
  /** ~$8 at ~$0.002/browser-minute (Starter calculator, 11 Sep 2026). Loose on
   *  purpose: a disciplined demo needs ~1,000, and this is the cheap meter. */
  "solari.minutes": 4_000,
  /** ~$3 total for input+output combined, split below. Rate depends on the routed
   *  model (ADR-0012) and must be read at P2.1, not assumed — the ceiling is set so
   *  that even a bad model choice cannot exhaust the budget silently. */
  "llm.input.tokens": 20_000_000,
  "llm.output.tokens": 4_000_000,
  /** ~$5. The wildcard. Google's current rate and whether the monthly free credit
   *  applies must both be checked before Phase 2 starts; this is the one meter that
   *  could blow the ceiling on its own. */
  "geocode.calls": 800,
}

/** Env var name per meter. Keeps the mapping in one place rather than inline. */
const ENV_VAR: Record<MeterId, string> = {
  "solari.minutes": "BUDGET_SOLARI_MINUTES",
  "llm.input.tokens": "BUDGET_LLM_INPUT_TOKENS",
  "llm.output.tokens": "BUDGET_LLM_OUTPUT_TOKENS",
  "geocode.calls": "BUDGET_GEOCODE_CALLS",
}

const ceilingValue = z.coerce.number().positive().finite()

/**
 * Read ceilings from the environment, falling back to the derived defaults.
 *
 * A present-but-unparseable value throws rather than falling back. Silently
 * ignoring `BUDGET_GEOCODE_CALLS=eight hundred` and running on the default is
 * exactly the failure a budget guard exists to prevent.
 */
export function loadCeilings(
  env: Record<string, string | undefined> = process.env,
): Record<MeterId, number> {
  const out = { ...DEFAULT_CEILINGS }
  for (const meter of meterId.options) {
    const raw = env[ENV_VAR[meter]]
    if (raw === undefined || raw === "") continue
    const parsed = ceilingValue.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`${ENV_VAR[meter]} must be a positive number, got ${JSON.stringify(raw)}`)
    }
    out[meter] = parsed.data
  }
  return out
}
