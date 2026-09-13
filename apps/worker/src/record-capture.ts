import { resolve } from "node:path"
import {
  type Capture,
  createTikTokAdapter,
  createYouTubeAdapter,
  harvest,
  type SourceAdapter,
} from "@samsara/sources"
import { writeFixture } from "@samsara/sources/fixture"
import { boot } from "./boot.js"

/**
 * Record one real capture and write it to disk as a fixture. **This spends.**
 *
 * It exists because of the claim `@samsara/sources` is built around: a parser test
 * runs against the same bytes the archive holds, so it cannot drift into a
 * hand-written approximation that agrees with the parser because the same person
 * wrote both. That claim is worth nothing until somebody pays for one session and
 * checks the result in. This is that session.
 *
 * Two entry points, like P1.0's runner: `record:plan` prints what it would do and
 * opens nothing, `record` does it. The cost of a capture is visible before it is
 * paid, because a cost that is only visible afterwards is one nobody gets to
 * approve.
 *
 * The meters are the real ones — it boots the same object graph the runner does,
 * against Postgres — for the reason the lab's runner gives: this *is* the
 * allowance being spent, and a meter that cannot see it is a meter that lies.
 *
 * Usage:
 *   pnpm --filter @dt/worker record:plan -- --query="xin chào" --country=sg --locale=vi-VN
 *   pnpm --filter @dt/worker record      -- --source=tiktok.search --query="bánh mì" --locale=vi-VN
 */

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const found = args.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}
const dryRun = args.includes("--dry-run")

/**
 * `--source` names an adapter the same way a `harvest.run` payload does, because
 * a recorder that addresses sources differently from the queue is a recorder that
 * can produce a fixture for a source the queue cannot run.
 */
const SOURCES: Record<string, () => SourceAdapter<unknown>> = {
  "youtube.search": () => createYouTubeAdapter("search") as SourceAdapter<unknown>,
  "youtube.trending": () => createYouTubeAdapter("trending") as SourceAdapter<unknown>,
  "tiktok.search": () => createTikTokAdapter("search") as SourceAdapter<unknown>,
  "tiktok.explore": () => createTikTokAdapter("explore") as SourceAdapter<unknown>,
}

const sourceId = flag("source", "youtube.search")
const make = SOURCES[sourceId]
if (!make) {
  console.error(`unknown --source=${sourceId}; one of ${Object.keys(SOURCES).join(", ")}`)
  process.exit(2)
}
// A surface that takes no question — trending, explore — must not be refused for
// not having one, and a search that has none must not open a session to ask it.
const needsQuery = sourceId.endsWith(".search")
const query = flag("query", "")
const persona = {
  id: flag("persona", "record-cli"),
  country: flag("country", "sg"),
  locale: flag("locale", "vi-VN"),
  timezoneId: flag("tz", "Asia/Ho_Chi_Minh"),
}
const name = flag(
  "name",
  `${sourceId.replace(".", "-")}-${persona.locale}-${new Date().toISOString().slice(0, 10)}`,
)
// Next to the adapter it belongs to, not in one shared folder: a fixture is read
// by exactly one parser's test, and a `__fixtures__` directory holding four
// sources' captures is one more thing to keep sorted by hand.
const folder = sourceId.split(".")[0]
const outDir = resolve(
  process.cwd(),
  flag("out", `../../packages/samsara/sources/src/${folder}/__fixtures__`),
)

if (needsQuery && !query) {
  console.error("--query is required for a search capture; a session with no question is a bill")
  process.exit(2)
}

const adapter = make()

console.log(
  [
    "",
    `  source    ${adapter.id}`,
    `  query     ${query || "(none — this surface takes no question)"}`,
    `  viewpoint ${persona.country} / ${persona.locale} / ${persona.timezoneId}`,
    `  fixture   ${outDir}/${name}.capture.json`,
    "",
    dryRun
      ? "  --dry-run: nothing will be opened and nothing will be spent."
      : "  This opens one browser session and bills for it.",
    "",
  ].join("\n"),
)

if (dryRun) process.exit(0)

const app = boot()

try {
  const result = await app.kernel.withBrowser(
    // `SessionPurpose` is a closed union (P0.2), and recording a fixture is not a
    // new kind of work — it is a harvest whose output happens to go to a file
    // instead of a table. Widening an engine schema for a developer tool would be
    // the wrong direction of change, and the closed union is the thing that made
    // that obvious rather than optional.
    "harvest",
    {
      country: persona.country,
      locale: persona.locale,
      timezoneId: persona.timezoneId,
      attempts: 1,
    },
    async (page, signal) => {
      const { capture, items } = await harvest(
        adapter,
        { page, persona, logger: app.logger, signal },
        query,
      )
      return { capture, count: items.length }
    },
  )

  if (!result.ok) {
    console.error(`\n  failed (${result.error.kind}): ${result.error.message}\n`)
    process.exit(1)
  }

  const { capture, count } = result.value as { capture: Capture<unknown>; count: number }
  const path = writeFixture(outDir, name, capture)
  const bytes = JSON.stringify(capture).length

  console.log(
    [
      "",
      `  wrote     ${path}`,
      `  size      ${(bytes / 1024).toFixed(0)} KB`,
      `  parsed    ${count} item(s)`,
      capture.refusedBy ? `  REFUSED   ${capture.refusedBy}` : "  refused   no",
      "",
      "  Read the file before committing it. It is going into a public repository,",
      "  and the redaction in capture.ts is a list of key names, not a guarantee.",
      "",
    ].join("\n"),
  )
} finally {
  await app.close()
}
