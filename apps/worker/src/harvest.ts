import type {
  CaptureArchive,
  HarvestRunStore,
  Pacer,
  PersonaSink,
  RawItemStore,
} from "@samsara/harvest"
import { runHarvest } from "@samsara/harvest"
import type { PersonaStore } from "@samsara/personas"
import type { SourceAdapter } from "@samsara/sources"
import type { JobHandler } from "./handlers.js"

/**
 * The `harvest.run` job type: one identity, one source, one question.
 *
 * **One handler for every domain**, which is the same rule that makes adapters
 * per-source rather than per-domain. The alternative — `harvest.run.travel` in the
 * queue — would be the seam breaking in the one place it is hardest to see, since
 * nothing about a job type is typechecked.
 *
 * The registry is a plain `Map` and is deliberately not a discovery mechanism.
 * Adapters are registered in `boot.ts` by name, so the set of sources a deployment
 * can harvest from is a line of code somebody wrote rather than whatever happened
 * to be on disk — which matters when each entry can spend money.
 */

export interface HarvestPayload {
  personaId: string
  sourceId: string
  query: string
  domainId: string
  deadlineMs?: number
  attempts?: number
}

/**
 * Payload validation, in the handler. Same reasoning as `persona.keepalive`: the
 * queue column is `jsonb` and anything with the connection string can write a row,
 * so a typo in an operator's `INSERT` must not become a browser session asking a
 * source about `undefined` at the usual rate.
 */
function parsePayload(raw: unknown): HarvestPayload {
  const p = (raw ?? {}) as Partial<HarvestPayload>
  const required = ["personaId", "sourceId", "query", "domainId"] as const
  for (const key of required) {
    const value = p[key]
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`harvest.run: payload.${key} must be a non-empty string`)
    }
  }
  for (const key of ["deadlineMs", "attempts"] as const) {
    const value = p[key]
    if (value !== undefined && (typeof value !== "number" || value <= 0)) {
      throw new Error(`harvest.run: payload.${key} must be a positive number`)
    }
  }
  return {
    personaId: p.personaId as string,
    sourceId: p.sourceId as string,
    query: p.query as string,
    domainId: p.domainId as string,
    ...(p.deadlineMs === undefined ? {} : { deadlineMs: p.deadlineMs }),
    ...(p.attempts === undefined ? {} : { attempts: p.attempts }),
  }
}

export interface HarvestHandlerDeps {
  sources: ReadonlyMap<string, SourceAdapter<unknown>>
  personas: PersonaStore
  runs: HarvestRunStore
  items: RawItemStore
  archive: CaptureArchive
  pacer?: Pacer
}

export function createHarvestHandler(deps: HarvestHandlerDeps): JobHandler {
  return async (ctx) => {
    const input = parsePayload(ctx.job.payload)

    const adapter = deps.sources.get(input.sourceId)
    if (!adapter) {
      // `config`, and therefore not retried: a source that is not registered will
      // not become registered by trying again in thirty seconds.
      throw new Error(`harvest.run: no adapter registered for source ${input.sourceId}`)
    }

    const persona = await deps.personas.byId(input.personaId)
    if (!persona) throw new Error(`harvest.run: no such persona: ${input.personaId}`)
    if (persona.health === "banned" || persona.health === "retired") {
      // Checked before the session opens, for the same reason `keepalive` checks it:
      // the point of the health state is that it stops spend.
      throw new Error(
        `harvest.run: persona ${persona.id} is ${persona.health}; harvesting would spend on a dead identity`,
      )
    }

    await ctx.heartbeat(`harvest ${input.sourceId} as ${persona.id}`)

    const result = await runHarvest(
      adapter,
      {
        kernel: ctx.kernel,
        runs: deps.runs,
        items: deps.items,
        archive: deps.archive,
        // Passed unconditionally, unlike in a test: a production harvest that does
        // not tell the persona what happened is a ban detector with no evidence.
        personas: deps.personas satisfies PersonaSink,
        logger: ctx.logger,
        ...(deps.pacer ? { pacer: deps.pacer } : {}),
      },
      {
        domainId: input.domainId,
        persona: {
          id: persona.id,
          country: persona.country,
          locale: persona.locale,
          timezoneId: persona.timezoneId,
        },
        query: input.query,
        proxySession: persona.proxySession,
        profileId: persona.solariProfileId,
        ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
        ...(input.attempts === undefined ? {} : { attempts: input.attempts }),
      },
    )

    if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)

    const report = result.value
    await ctx.heartbeat(
      `${report.outcome}: ${report.itemCount} item(s), ${report.minutes.toFixed(2)} min`,
    )
  }
}
