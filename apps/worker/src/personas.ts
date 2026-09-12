import type { ProfileStore } from "@samsara/kernel"
import { keepalive, type PersonaStore } from "@samsara/personas"
import type { JobHandler } from "./handlers.js"

/**
 * The `persona.keepalive` job type, bound to its stores at boot.
 *
 * A factory rather than a bare handler because `JobContext` deliberately carries
 * only what *every* handler needs — kernel, packs, logger, signal, heartbeat. A
 * persona store is not that, and widening the context for the second handler in
 * the tree would mean widening it for the tenth.
 *
 * **The URLs come from the payload.** `@samsara/personas` cannot know which pages
 * an identity ordinarily reads without acquiring a vertical's vocabulary, so it
 * takes them as an argument; this file is on the travel side of the seam and is
 * where an answer is allowed to live. Today the answer is "whatever enqueued the
 * job said", which keeps the decision with the caller that has a reason for it.
 */

export interface KeepalivePayload {
  personaId: string
  urls: string[]
  dwellMs?: number
}

/**
 * Payload validation, in the handler rather than at enqueue time.
 *
 * The queue column is `jsonb` and a row can be inserted by anything with the
 * connection string — a migration, a backfill script, a future API route. Trusting
 * its shape here would turn a typo in an operator's `INSERT` into a browser session
 * pointed at `undefined`, billed at the usual rate.
 */
function parsePayload(raw: unknown): KeepalivePayload {
  const p = (raw ?? {}) as Partial<KeepalivePayload>
  if (typeof p.personaId !== "string" || p.personaId.length === 0) {
    throw new Error("persona.keepalive: payload.personaId must be a non-empty string")
  }
  if (!Array.isArray(p.urls) || p.urls.length === 0) {
    throw new Error("persona.keepalive: payload.urls must be a non-empty array")
  }
  for (const url of p.urls) {
    if (typeof url !== "string") {
      throw new Error("persona.keepalive: every payload.urls entry must be a string")
    }
    // Rejected here rather than at `goto`, because by then a session is open and
    // the minutes are already being spent.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`persona.keepalive: payload.urls contains a non-absolute url`)
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`persona.keepalive: payload.urls contains a non-http url`)
    }
  }
  if (p.dwellMs !== undefined && (typeof p.dwellMs !== "number" || p.dwellMs < 0)) {
    throw new Error("persona.keepalive: payload.dwellMs must be a non-negative number")
  }
  return {
    personaId: p.personaId,
    urls: p.urls,
    ...(p.dwellMs === undefined ? {} : { dwellMs: p.dwellMs }),
  }
}

export function createKeepaliveHandler(deps: {
  store: PersonaStore
  profiles?: ProfileStore
}): JobHandler {
  return async (ctx) => {
    const input = parsePayload(ctx.job.payload)
    await ctx.heartbeat(`keepalive ${input.personaId}`)

    const result = await keepalive(
      {
        kernel: ctx.kernel,
        store: deps.store,
        logger: ctx.logger,
        ...(deps.profiles ? { profiles: deps.profiles } : {}),
      },
      input,
    )

    // Thrown, not returned: the runner's `classify` is what decides whether a
    // failure is retried, and `retry.ts` refuses to retry `blocked` on purpose.
    // Swallowing it here would mark the job succeeded and hide a banned identity
    // behind a green row.
    if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)

    const report = result.value
    await ctx.heartbeat(
      `visited ${report.visited.length}, saved ${report.saved}, health ${report.health}`,
    )
  }
}
