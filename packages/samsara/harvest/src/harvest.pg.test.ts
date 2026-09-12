import { randomUUID } from "node:crypto"
import { personas, samsaraSchema, sessions } from "@samsara/db"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { PostgresHarvestRunStore, PostgresRawItemStore } from "./postgres.js"
import type { RawItemRow } from "./store.js"

/**
 * The harvest stores against a real Postgres.
 *
 * What needs a real database here is not concurrency — a harvest run is owned by
 * one session and nothing races it — but the **foreign keys**, which are the
 * constraints doing the actual design work. `harvest_runs.persona_id` is
 * `ON DELETE restrict` and `raw_items.harvest_run_id` is `ON DELETE cascade`, and
 * those two opposite choices encode a rule no in-memory Map can hold: a persona
 * that produced evidence may not be deleted out from under it, while the items of
 * a discarded run go with the run. A fake would let both happen.
 *
 * Runs whenever `DATABASE_URL` is set, and **fails loudly when it is not** unless
 * `SAMSARA_NO_DB=1` says the omission is deliberate. See `jobs.pg.test.ts`.
 */

const url = process.env.DATABASE_URL
const hasDb = typeof url === "string" && url.length > 0
const optedOut = process.env.SAMSARA_NO_DB === "1"

if (!hasDb && !optedOut) {
  describe("harvest, against Postgres", () => {
    it("has a database to run against", () => {
      expect.fail(
        "DATABASE_URL is not set, so the foreign-key tests would have skipped and " +
          "this run would have reported green while testing nothing. Run `pnpm db:up` " +
          "and retry, or set SAMSARA_NO_DB=1 to skip on purpose.",
      )
    })
  })
}

const client = hasDb ? postgres(url as string, { max: 4, onnotice: () => {} }) : null
const db = client ? drizzle(client, { schema: samsaraSchema }) : null

afterAll(async () => {
  await client?.end({ timeout: 5 })
})

const capturedAt = new Date("2026-09-12T10:00:00.000Z")

describe.runIf(hasDb)("harvest, against Postgres", () => {
  const d = () => db as NonNullable<typeof db>
  const runs = () => new PostgresHarvestRunStore(d())
  const items = () => new PostgresRawItemStore(d())

  let personaId: string
  let sessionId: string

  beforeEach(async () => {
    await d().execute(
      sql`truncate table raw_items, harvest_runs, sessions, personas restart identity cascade`,
    )
    personaId = randomUUID()
    await d().insert(personas).values({
      id: personaId,
      name: "regular",
      locality: "District 1",
      country: "sg",
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      tier: "anon",
    })
    const [session] = await d()
      .insert(sessions)
      .values({ purpose: "harvest", personaId, country: "sg", outcome: "ok", minutes: 0.5 })
      .returning({ id: sessions.id })
    sessionId = session?.id as string
  })

  const startRun = async (id = randomUUID()) => {
    await runs().start({
      id,
      domainId: "atlas",
      personaId,
      sourceId: "fake.search",
      query: "xin chào thế giới",
      sessionId,
      startedAt: capturedAt,
    })
    return id
  }

  const item = (runId: string, over: Partial<RawItemRow> = {}): RawItemRow => ({
    id: randomUUID(),
    harvestRunId: runId,
    sourceId: "fake.search",
    url: "https://fake.test/a",
    title: "A",
    text: "xin chào",
    languageGuess: "th",
    mediaRefs: [],
    engagement: null,
    capturedAt,
    rawRef: `captures/fake.search/${runId}/1.json`,
    ...over,
  })

  it("stores a run and reads it back, query text in its own script", async () => {
    const id = await startRun()
    const read = await runs().byId(id)
    expect(read?.outcome).toBe("running")
    expect(read?.endedAt).toBeNull()
    // The query is the dominant signal P1.0 measured. Storing it mangled would
    // make every later comparison of "what did we ask" meaningless.
    expect(read?.query).toBe("xin chào thế giới")
  })

  it("finishes a run in one write", async () => {
    const id = await startRun()
    const endedAt = new Date("2026-09-12T10:01:00.000Z")
    await runs().finish(id, "ok", 3, endedAt)
    const read = await runs().byId(id)
    expect(read?.outcome).toBe("ok")
    expect(read?.itemCount).toBe(3)
    expect(read?.endedAt?.toISOString()).toBe(endedAt.toISOString())
  })

  it("writes a batch of items in one statement", async () => {
    const id = await startRun()
    await items().insertMany([item(id), item(id, { url: "https://fake.test/b" })])
    const rows = await d().execute(sql`select count(*)::int as n from raw_items`)
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(2)
  })

  it("accepts an empty batch without asking the database anything", async () => {
    const id = await startRun()
    // Ordinary, not exceptional: a source can answer honestly with nothing.
    await expect(items().insertMany([])).resolves.toBeUndefined()
    expect((await runs().byId(id))?.itemCount).toBe(0)
  })

  it("keeps zero and unknown engagement apart through the database", async () => {
    const id = await startRun()
    await items().insertMany([
      item(id, { engagement: { views: 0, likes: null, comments: null } }),
      item(id, { url: "https://fake.test/b", engagement: null }),
    ])
    const rows = (await d().execute(
      sql`select engagement_views from raw_items order by url`,
    )) as unknown as { engagement_views: number | null }[]
    // Zero views is a measurement. No views is an absence. A column that collapses
    // them makes every unmeasured item look unpopular.
    expect(rows.map((r) => r.engagement_views)).toEqual([0, null])
  })

  it("refuses to delete a persona that produced a run", async () => {
    await startRun()
    // `ON DELETE restrict`. Evidence has to keep pointing at whose eyes saw it, or
    // a scored result can no longer explain itself.
    await expect(d().execute(sql`delete from personas where id = ${personaId}`)).rejects.toThrow()
  })

  it("takes a run's items with it when the run is deleted", async () => {
    const id = await startRun()
    await items().insertMany([item(id), item(id, { url: "https://fake.test/b" })])
    // `ON DELETE cascade`, the opposite call to the one above and for the opposite
    // reason: items without their run are unattributable, not precious.
    await d().execute(sql`delete from harvest_runs where id = ${id}`)
    const rows = await d().execute(sql`select count(*)::int as n from raw_items`)
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(0)
  })

  it("refuses an item whose run does not exist", async () => {
    await expect(items().insertMany([item(randomUUID())])).rejects.toThrow()
  })

  it("lists by source and by persona, which is how a rerun finds its history", async () => {
    const a = await startRun()
    await runs().finish(a, "ok", 1, new Date())
    await startRun()

    expect(await runs().list({ sourceId: "fake.search" })).toHaveLength(2)
    expect(await runs().list({ personaId })).toHaveLength(2)
    expect(await runs().list({ sourceId: "other.source" })).toHaveLength(0)
    expect(await runs().list()).toHaveLength(2)
  })
})
