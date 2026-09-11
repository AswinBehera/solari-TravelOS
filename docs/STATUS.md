# STATUS

Phase: 0
Last completed: **P0.4** (`@samsara/kernel`: withBrowser/withSandbox, registry, deadlines, retry,
three-metered budget guard, typed logs, viewpoints). 67 tests green, plus two live runs against
Solari. Migration 0002 applied.
NEXT: P0.5
Branch: main
Known breakage: none

Last session notes:
- 2026-09-11 (Claude Code) — session 2
  - **Budget.** Aswin set a hard **$20 ceiling** for the whole demo. Section 8 rewritten around it:
    three meters (Solari minutes, LLM tokens, geocoding calls), each with a ceiling expressed as a
    **count** rather than dollars, because rates drift and counts do not. Section 2.4's budget guard
    is now three-metered, and P0.4 gained an acceptance criterion that drives each meter past its
    ceiling and asserts the refusal. The guard is no longer a Phase 8 concern.
  - **ADR-0012: OpenRouter is the LLM gateway.** Amends ADR-0006. One key, many models; the model
    for each task is an env var, never a literal. The point is not the markup — it is that the
    extraction model gets chosen at P2.1 by measurement, and replaying stored RawItems costs
    nothing on the Solari meter, so the bake-off is affordable. Known cost: the Anthropic Batch
    API's 50% discount is not reachable through OpenRouter. Accepted.
  - **P0.1 done.** pnpm workspaces + Turborepo 2 + Biome 2 + Vitest 3 + TS 5.9. 16 workspace
    projects: 9 under `packages/samsara/`, 4 under `packages/travel/`, 3 apps. Every package is a
    stub exporting its own name. `pnpm check` (lint, typecheck, test) is green.
  - `.env` holds a real `SOLARI_API_KEY`, is gitignored (verified with `git check-ignore`), and was
    written with `umask 077`. `.env.example` created with every variable the plan implies so far,
    including the four budget ceilings.
  - Cookbook `examples/` untouched, as P0.1 requires. Biome explicitly excludes them.

  - **P0.2 done.** `@samsara/core` has schemas for all nine engine entities; `@dt/core` has the
    five travel ones. 25 tests: every schema parses a fixture, plus the constraints that are
    actually load-bearing (country must be lowercase, `SessionPurpose` stays closed, confidence is
    bounded, every score carries its `because`). `@samsara/core` depends on zod and nothing else.
  - **The seam bit back immediately, which is a good sign.** The first draft of the engine's
    fixtures used travel vocabulary — Bangkok, a restaurant query, agoda as a source — to make the
    examples readable. That would have failed P0.7's lexicon check, correctly: if the engine's own
    fixtures need a vertical's words to be legible, the schemas are not agnostic. Rewritten around
    a made-up domain called `atlas`. Worth knowing before P0.7 lands, because it means the check
    will find real things, not just typos.
  - `packages/samsara/core/src/seam.test.ts` is a narrow, package-local version of the seam check:
    no `@dt/*` import statement, no `@dt/*` dependency, and nothing but zod in `dependencies`.
    P0.7 generalises it; this one stays, because it fails in the package that broke the rule.

  - **Q3 answered: Supabase Auth** (ADR-0013). The API verifies the JWT and passes `sub` down as an
    opaque `ownerId`; the travel `users` table keys on that id rather than generating its own. No
    RLS in v1 — the worker writes rows for users who are not present, which RLS fights, and
    authorisation lives in the API layer, the only place that has the request identity. This
    decision touched nothing under `packages/samsara/`, which is a small test of the seam passing.
  - **P0.3 done, verified against a live Postgres.** 14 tables (9 engine, 5 travel), 12 enum types,
    one migration (`0000_lying_menace.sql`), seed runs and is idempotent. `docker-compose.yml` at
    the root brings up Postgres 17 and Redis 7 with healthchecks; `pnpm db:up`, `db:migrate`,
    `db:seed`, `db:reset` wrap it.
  - **The seam holds at the database level, and this is now checked two ways.** Queried live:
    zero foreign keys from any engine table into any travel table. Also asserted structurally in
    `packages/travel/db/src/schema.test.ts`, so CI catches a regression without needing Postgres.
    The check is not vacuous — the same logic finds all 14 real foreign keys.

  - **Q1 answered: Cloudflare** (ADR-0014) — and it forced a bigger change than the question asked.
    Free Workers meter **CPU, not wall clock**, at 10 ms per invocation. `apps/web` and `apps/api`
    fit; `apps/worker` cannot, because parsing a harvested page is computation, not I/O. So the
    worker is a **scheduled GitHub Actions job**, and once the consumer is a job that wakes,
    drains, and exits, the queue is a Postgres table — **BullMQ and Redis are both gone**, along
    with the always-on box and its monthly fee. Section 2.2 rewritten; ADR-0004 superseded; Redis
    removed from `docker-compose.yml` and `.env.example`.
  - The kernel's budget counters move from Redis keys to Postgres rows keyed by meter and window.
    This is more correct regardless: a guard that forgets what it spent when a runner exits is not
    a guard.

- 2026-09-11 (Claude Code) — session 3
  - **P0.4 done, and a live session actually opened.** `@samsara/kernel` is nine source files plus
    two store backends. `withBrowser` refuses on the guard, opens, registers, races a hard deadline,
    force-closes on overrun, closes in a `finally`, and meters the minutes the session really took.
    62 tests, none of which need a key or spend anything: `ports.ts` defines `BrowserLauncher` and
    `SandboxLauncher`, and `solari.ts` is the only file in the repository that imports the SDK.
  - **First real number for the minutes meter: 0.042 minutes** for a probe session that opened a
    residential-proxied browser, loaded ipify, and closed. Against a 4,000-minute ceiling, a probe
    costs about 0.001% of the demo's Solari budget. Solari is up, not in maintenance.
  - **The live test found a product blocker, not a bug: Solari has no Thai residential egress.**
    `country: "th"` returns `400 Unsupported proxy country` with the pool inlined — 15 countries,
    no `th`. Section 1.4 names Bangkok as the first city. Recorded in
    `packages/samsara/kernel/src/countries.ts`, flagged in section 1.4, and asked as section 10
    question 9. The kernel refuses `th` locally and names `sg` as the nearest available, but does
    not substitute it: a silent country swap changes what a persona sees, which is the one variable
    the Persona Lab exists to hold still. **This needs Aswin's call before P1.**
  - The same 400 exposed a real defect on the way: `classify` had no 4xx branch, so it called the
    provider's "you asked for something that does not exist" `internal` and then retried it twice.
    Now 4xx is `config`, and `config` is not retryable.
  - **Q1's answer changed the logger's type, not just a config value.** The repository is public, so
    the Actions log is public. `KernelEvent` is a closed discriminated union with **no free-form
    `payload` or `meta` field anywhere** — logging a secret does not typecheck. `registry.test.ts`
    asserts every emitted key against an allowlist, so adding one fails the build. A redaction
    denylist would have been the obvious design and the wrong one; denylists leak by omission.

  - **Q2 answered, and it tightens everything: the $20 IS the usage credit.** No free runtime
    underneath it; overage bills Aswin's card, which is not acceptable. Section 8 rewritten. Three
    consequences, all in code: the ceiling is a stop and not a warning; the ~$4 unallocated is
    **reserve against our own undercount** (a killed runner leaves a VM billing while our counter
    records nothing — routine under ADR-0014) and must not be allocated; and **the one remaining
    card exposure is Google Places**, which auto-bills once its free credit runs out. Places needs a
    hard daily **quota cap** (not a budget alert — alerts only send mail) before Phase 2. Until then
    geocoding runs on Nominatim only.
  - **ADR-0015: a viewpoint is a stack of signals, and the IP is the weakest one.** This answers
    question 9 and keeps Bangkok as the first city. Platforms rank by account region, query
    language, stored region preference, browser locale/timezone, engagement history, and only then
    egress IP. A Thai IP asking in English gets the global viral feed; a `th-TH` browser on
    `Asia/Bangkok` asking in Thai does not.
  - **A real bug fell out of writing that down: Solari sets neither locale nor timezone.**
    `browser.newPage()` returns the pool's default context — `en-US` on UTC. Every session the
    kernel had opened was claiming to be an American on a Singapore IP: wrong for the product and a
    conspicuous mismatch for the anti-bot surfaces. The kernel now builds its own context, carrying
    the profile's `storageState` across by hand (`newContext()` opens an *empty* one — losing a
    warmed profile that way would have been silent).
  - **Verified live:** egress `121.7.135.149` (Singapore residential), page reports
    `navigator.language = th-TH`, `Intl` zone `Asia/Bangkok`, offset −420. 0.057 minutes.
  - **`sessions` records both halves** (`locale`, `timezone_id`, migration 0002), and so does the
    `session.open` log event. An Observation cannot be read without the viewpoint that produced it,
    and "which signals were present" is the independent variable of every Phase 1 experiment.
  - **New task P1.0, ahead of the adapters:** a signal-matrix experiment — one query across egress x
    locale x query-language x stored-preference, measuring pairwise URL overlap. Under 10 browser
    minutes. It turns "we can't get a Thai IP" into a measured table of what actually matters, and
    the adapters get built against measured weights instead of assumed ones.
  - ADRs 0001 to 0008 written, so 0001 to 0015 all exist.

Decisions taken by the executor, for the architect to overrule if wrong:
- Packages are **source-only**: `exports` points at `./src/index.ts`, there is no build step, and
  consumers compile through Vite/tsx. Removes a whole class of stale-dist bug. Revisit if a package
  is ever published.
- `moduleResolution: "Bundler"` with `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, and
  `noUncheckedIndexedAccess` on. The strict flags are cheap now and expensive to add later.
- **`ScoreSet` and `Explanation` live in `@samsara/core`, not `@samsara/refine`.** Section 2.5 puts
  them with the `DomainPack` contract, but `@dt/core`'s `Place.scores` needs them, and making a
  schema package depend on a pipeline package is the wrong shape. `@samsara/refine` will re-export
  them as part of the contract. Flagging because it is a small, deliberate deviation from the plan.
- Nullable over optional throughout, to match what Drizzle returns from Postgres and to keep
  `exactOptionalPropertyTypes` from turning every row read into a conditional.
- **Postgres enums are derived from the Zod enums**, not retyped: `pgEnum("persona_tier",
  personaTier.options)`. A schema and its database type cannot drift if only one of them is
  written down. Costs one `as unknown as` cast at each site, which is worth it.
- **Nested objects are flattened into columns**, not stored as JSON: `stats` becomes
  `stat_sessions`/`stat_minutes`/`stat_blocks`, `engagement` becomes three nullable integers, `geo`
  becomes `lat`/`lng`. These are queried and aggregated; JSON columns would make the budget
  dashboard and the map slower for no gain. Genuinely opaque payloads stay `jsonb`.
- **`@dt/db/src/schema.ts` star-re-exports the engine tables.** Not stylistic: drizzle-kit reads a
  schema file's top-level exports, so exporting only the composed object generated an empty
  migration. Worth knowing before someone "tidies" it.
- **No RLS policies in the migration**, per ADR-0013.
- **No logging library.** pino is the default choice and would have brought a free-form `.info(obj)`
  with it. The logger is ~60 lines of typed events instead, and the public Actions log is the reason.
- **`budget_counters` is a tenth engine table**, not in section 3.1 as written. Section 3.1 has been
  amended. A guard whose counts live in memory forgets them between Worker invocations.
- **The ports pattern**: the kernel depends on `BrowserLauncher`/`SandboxLauncher` interfaces, and
  the SDK is behind `@samsara/kernel/solari`. Every test but the live one runs without a key.
- **Ceilings carry their derivation rate in a comment, never in code** (section 8's rule). Four
  counters for three meters: LLM input and output are priced differently, so they are counted apart.

Open for architect before P0.5:
- **Google Places needs a quota cap before Phase 2.** It is the only vendor here that can bill
  Aswin's card without anyone deciding to spend. A daily quota cap in the Google Cloud console is
  the hard stop; a budget alert is not. Also re-derive the 800-call ceiling from the current rate.
- **Worth asking Solari: is `th` residential egress on the roadmap?** ADR-0015 works without it, but
  the answer turns a design question back into a scheduling one.
- Section 10 questions 4, 5, 6, 7, 8 are unanswered. None of them block P0.5.
- **P0.5 is unblocked.** Questions 1 and 3 are both answered.
- **Answered: the repository is public.** So Actions minutes are unmetered, section 8 stays at
  three meters, and the Actions log is public — which is why the kernel's logger has no free-form
  field. Question 1 is fully closed.
- **Solari is not under maintenance.** The live call reached them and came back with a structured
  400, which is a healthy provider disagreeing with us.
- The demo topology proposal (GitHub Actions cron + inline SSE, deleting BullMQ/Redis/the always-on
  box) deviates from section 2.2 and needs a call plus an ADR before P0.5.
