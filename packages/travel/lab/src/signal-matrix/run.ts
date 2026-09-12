import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { samsaraSchema } from "@samsara/db"
import {
  BudgetGuard,
  Kernel,
  loadCeilings,
  SessionRegistry,
  type SessionSpend,
} from "@samsara/kernel"
import { jsonLogger } from "@samsara/kernel/node"
import { PostgresCounterStore, PostgresSessionStore } from "@samsara/kernel/postgres"
import { createSolariBrowserLauncher, solariCredentials } from "@samsara/kernel/solari"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { FACTORS, MINUTES_PER_CELL, QUERIES, requestFor, runPlan, TOP_K } from "./design.js"
import type { CellResult, RunFile } from "./results.js"
import { type PageLike, youtubeSearch } from "./surface.js"

/**
 * P1.0's runner. **This spends real browser minutes.**
 *
 * `--dry-run` prints the plan — every cell, in execution order, with the arithmetic
 * — and opens nothing. That is the default entry point (`pnpm signal-matrix:plan`),
 * because an experiment whose cost is only visible after it has been paid is an
 * experiment nobody gets to approve.
 *
 * The counters are the real ones. Unlike the `@live` kernel test, which keeps its
 * meters in memory so CI cannot spend the demo's allowance on itself, this run *is*
 * the allowance being spent, and a meter that does not see it is a meter that lies.
 * So it refuses to run without a database rather than silently metering into RAM.
 */

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const noReplicates = args.has("--no-replicates")
const seedArg = process.argv.find((a) => a.startsWith("--seed="))
const seed = seedArg ? Number(seedArg.slice("--seed=".length)) : 20260912

/**
 * What one cell cost, summed from the kernel's own `onSession` reports.
 *
 * **Summed, not last-wins.** A cell that fails and retries opens two sessions, and
 * the first is a real session that really consumed minutes — the budget guard
 * meters it, because the guard meters measurement rather than success. The first
 * run of this experiment read only the last one and attributed 3.25 minutes to a
 * run that had actually spent 4.79: a **32% under-report**, in the cheap-looking
 * direction, for a number whose entire job is to be trusted against a hard ceiling.
 * It was caught by disagreeing with `budget_counters`, which is luck.
 *
 * This used to be a `TeeLogger` that scraped `session.close` events out of the log
 * stream on their way to stdout. That class is gone: `withBrowser` now reports each
 * attempt's spend directly (`onSession`), which exists precisely because two
 * callers in a row needed this number and the scraper got it wrong. The array is
 * per-cell and never outlives the cell, so the old "read and clear" step — the one
 * that had to be called twice per iteration, once defensively — is not merely
 * unnecessary but unwritable.
 */
function tally(spends: readonly SessionSpend[]): {
  sessionId: string | null
  minutes: number
  attempts: number
} {
  return {
    // The last attempt is the one that produced the items.
    sessionId: spends[spends.length - 1]?.sessionId ?? null,
    minutes: spends.reduce((sum, spend) => sum + spend.minutes, 0),
    attempts: spends.length,
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, "../../results")

async function main(): Promise<void> {
  const plan = runPlan(seed, !noReplicates)
  const surface = youtubeSearch

  console.log(`signal-matrix — ${surface.id}, top ${TOP_K}, seed ${plan.seed}`)
  console.log(
    `${plan.cells} cells + ${plan.replicates} replicates = ${plan.order.length} sessions, ` +
      `~${plan.estimatedMinutes.toFixed(1)} browser-minutes at ${MINUTES_PER_CELL}/session`,
  )
  console.log("")
  for (const [index, assignment] of plan.order.entries()) {
    const request = requestFor(assignment, (r) => surface.buildUrl(r))
    console.log(
      `${String(index + 1).padStart(2)}. egress=${request.country} locale=${request.locale} ` +
        `tz=${request.timezoneId} q="${request.query}" hints=${request.url.includes("gl=") ? "set" : "unset"}`,
    )
  }
  console.log("")

  if (dryRun) {
    console.log("--dry-run: nothing opened, nothing spent.")
    return
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    // Loud, for the reason in the file header: a run that meters into memory
    // spends the allowance and reports the budget untouched.
    throw new Error(
      "DATABASE_URL is not set. This run spends real minutes and the counters must " +
        "be the real ones. Run `pnpm db:up` and retry.",
    )
  }

  const client = postgres(dbUrl, { max: 4 })
  const db = drizzle(client, { schema: samsaraSchema })
  // Prints every event as the kernel emits it: the run is ten minutes long, and a
  // silent one is a run nobody can tell has stalled. Per-cell accounting no longer
  // rides on this stream — see `tally`.
  const logger = jsonLogger
  const kernel = new Kernel({
    registry: new SessionRegistry(new PostgresSessionStore(db), logger),
    guard: new BudgetGuard({ store: new PostgresCounterStore(db), ceilings: loadCeilings() }),
    browser: createSolariBrowserLauncher(solariCredentials()),
    logger,
  })

  const startedAt = new Date().toISOString()
  const cells: CellResult[] = []
  const seen = new Map<string, number>()
  let minutesSpent = 0

  for (const [index, assignment] of plan.order.entries()) {
    const request = requestFor(assignment, (r) => surface.buildUrl(r))
    const key = JSON.stringify(assignment)
    const replicate = seen.get(key) ?? 0
    seen.set(key, replicate + 1)

    const cellStartedAt = new Date().toISOString()
    const spends: SessionSpend[] = []

    const result = await kernel.withBrowser(
      "harvest",
      {
        country: request.country,
        locale: request.locale,
        timezoneId: request.timezoneId,
        deadlineMs: 90_000,
        attempts: 2,
        onSession: (spend) => spends.push(spend),
      },
      async (page) => {
        const p = page as PageLike
        await p.goto(request.url, { waitUntil: "domcontentloaded", timeout: 45_000 })
        return surface.readTop(p, TOP_K)
      },
    )

    // Metered by the kernel whether the cell succeeded or not, and summed across
    // retries, which is the number that matters against the ceiling.
    const { sessionId, minutes, attempts } = tally(spends)
    minutesSpent += minutes

    cells.push(
      result.ok
        ? {
            assignment,
            replicate,
            url: request.url,
            startedAt: cellStartedAt,
            items: result.value.items,
            minutes,
            attempts,
            sessionId,
            ...(result.value.refusedBy ? { refusedBy: result.value.refusedBy } : {}),
          }
        : {
            assignment,
            replicate,
            url: request.url,
            startedAt: cellStartedAt,
            items: [],
            minutes,
            attempts,
            sessionId,
            error: { kind: result.error.kind, message: result.error.message },
          },
    )

    const last = cells[cells.length - 1]
    console.log(
      `[${index + 1}/${plan.order.length}] ${request.country} ${request.locale} ` +
        `${request.query.slice(0, 16)} -> ${last?.items.length ?? 0} items` +
        (last?.error ? ` (${last.error.kind}: ${last.error.message})` : "") +
        (last?.refusedBy ? ` (refused: ${last.refusedBy})` : "") +
        ` | ${minutesSpent.toFixed(2)} min so far`,
    )
  }

  await kernel.shutdown()
  await client.end({ timeout: 5 })

  const file: RunFile = {
    experiment: "signal-matrix",
    surface: surface.id,
    topK: TOP_K,
    seed: plan.seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    factors: FACTORS,
    queries: QUERIES,
    minutesSpent,
    cells,
  }
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `${startedAt.slice(0, 19).replace(/[:]/g, "")}-${surface.id}.json`)
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`\nwrote ${path}\nspent ${minutesSpent.toFixed(2)} browser-minutes`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
