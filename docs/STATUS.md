# STATUS

Phase: 0 — **complete, pending the gate.**
Last completed: **P0.8** (the acceptance run): Phase 0's own three acceptance criteria executed
literally for the first time. Criterion 3 held. **Criteria 1 and 2 were both false and had been
for days, with no symptoms.** A fresh clone following the README produced `67 passed | 14
skipped`, exit 0, testing none of the job store; and the `@live` test had never written a
session row to Postgres at all, because it used a memory store for both session and counters.
Both fixed, both re-verified from a clean clone: **31 seconds** to a green `pnpm check` against
a 10-minute budget, 148 tests including all 13 Postgres ones, `pnpm dev` verified end to end in
the clone, `@live` green with row `e9330835` in `sessions`, seam ok at 65 files with **zero
allows of five**. A third finding fell out of the live run — `Asia/Ho_Chi_Minh` and
`Asia/Saigon` are one zone under two spellings and ICU answers with the older one, so the
viewpoint check was reporting a false negative. Before that, **P0.7** (the seam check),
**P0.6** (dev ergonomics) and **P0.5** (the queue and the two runtimes); all three were
committed this session, having lived only in the working tree until now.
NEXT: **the Phase 0 gate** (see below), then P1.0.
Branch: main
Known breakage: none. (The 0003/0004 gap from last session is closed — Docker was started, all six
migrations are recorded, and `places.external_ref`/`resolved_tier` are live.)

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

- 2026-09-12 (Claude Code) — session 4
  - **Migrations 0003/0004 applied**, plus a new **0005** for the queue. Six recorded, `places` has
    `external_ref` and `resolved_tier`, `places_google_id_idx` and `google_place_id` are gone.
  - **P0.5 done.** The queue is `jobs` + `job_events`. The claim is **one statement** — a CTE that
    selects `FOR UPDATE SKIP LOCKED` and updates in the same round trip — never a select followed by
    an update, which is the shape that hands one row to two runners.
  - **The design decision underneath it: a cancelled runner is routine, not an incident.** GitHub can
    cancel a scheduled run at any moment, so every claim carries a `lease_until`. An expired lease is
    reclaimable by the next runner, which means the *default* recovery path needs no operator and no
    dead-letter queue. Shutdown is the fast path on top of that, not the only path.
  - **A real bug that came out of writing the shutdown path:** `runOne` was routing a SIGTERM-aborted
    handler through `classify()` into `fail()`, so a cancelled job consumed an attempt and got backoff
    applied. Three unlucky cancellations would retire a job that had never actually been tried. Also,
    with `batchSize > 1`, rows 2..n of an aborted batch were claimed but never released. Both fixed:
    every claimed row is held from the instant it is claimed, and cancellation returns `"released"`,
    a third outcome next to succeeded and failed. **Cancellation is not failure** is now a type.
  - **ADR-0016 acceptance criterion 1 — CPU per request.** Measured with `process.cpuUsage()` over 500
    real requests through the real handlers (`apps/api/src/cpu.test.ts`), against the free plan's
    **10 ms** ceiling:

    | route                      | CPU per request | share of ceiling |
    | -------------------------- | --------------- | ---------------- |
    | `POST /jobs`               | **0.067 ms**    | 0.7%             |
    | `GET /jobs/:id/events` (1 tick) | **0.057 ms** | 0.6%            |
    | `GET /health`              | **0.016 ms**    | 0.2%             |

    Stated honestly: this is a **proxy**. Workers meters CPU rather than wall clock, and it freezes
    `Date.now()`/`performance.now()` between I/O precisely so that a Worker cannot time itself — so
    the authoritative number comes from the Cloudflare dashboard after deploy. This test's job is to
    catch a regression in CI two orders of magnitude before the ceiling. The assertion is set at half
    the ceiling, not at it.
  - **ADR-0016 acceptance criterion 2 — bounded stream queries.** A stream held its entire 15-minute
    lifetime across a job that never finishes costs **76 Hyperdrive queries**, against **900** for the
    flat one-second poll ADR-0016 rejected. The bound is asserted against `maxStreamQueries()`, which
    is computed by walking `streamPollIntervalMs` — the same function the handler calls — so editing
    the schedule cannot leave the test passing against a number that is no longer true. A finished job
    costs exactly one query.
  - `wrangler.toml` (Hyperdrive binding, `nodejs_compat`), `.github/workflows/worker.yml`
    (`schedule` + `workflow_dispatch` with a `jobId` input, `concurrency: worker`,
    `cancel-in-progress: false`), and the new `.env.example` entries — names only, no values.
  - **ADR-0019** records this session's two structural decisions and why the alternatives lose.

  - **P0.6 done, and the dev loop was verified end to end rather than assumed.** `pnpm dev` brings
    up Postgres, then three persistent turbo tasks: Vite on :5173, `wrangler dev` on :8788, and the
    runner on a 3-second timer. Checked by hand: `/health` through Vite's proxy into workerd returns
    `{"ok":true,"service":"api"}`, and the runner picked up and drained a leftover `noop` row
    (attempt 2, `reclaimed: 1` — lease expiry reclaiming a row in reality, not in a test).
  - **Verified the risky unknown: postgres-js works inside workerd.** A throwaway probe worker
    enqueued a job through Hyperdrive's local connection string and read its event back. The whole
    chain — workerd → `nodejs_compat` → postgres-js → drizzle → Postgres 17 — is confirmed locally,
    which is the part that would otherwise have been discovered on deploy day.
  - **A real defect the first `wrangler dev` found:** workerd refuses to start if the entrypoint
    module has a named export that is not a handler (`Incorrect type for map entry 'PACKAGE'`). P0.1's
    "every package exports its own name" convention is correct for libraries and wrong for an
    entrypoint. `apps/api/src/index.ts` now exports only the default handler; the other modules are
    reachable through subpath exports, with the reason written above the code.
  - **Second defect, found by reasoning rather than by a crash:** the Supabase verifier was built at
    isolate boot, so `SUPABASE_URL` was required before `/health` — an unauthenticated route — could
    answer. Now built on first authenticated use. A clean checkout with nothing but Docker running is
    enough for `pnpm dev`.
  - **Third, small and real:** `main()` registered SIGTERM/SIGINT handlers with `once` and never
    removed them. `once` only unregisters a listener that fires, so calling `main()` repeatedly (the
    dev loop; tests) leaked one per call and would have announced itself as a
    MaxListenersExceededWarning on the eleventh drain. Removed in the `finally`.
  - **The dev worker is a loop around the real `main()`, not a daemon.** Production has no long-lived
    worker, so dev must not invent one — a persistent dev worker hides every bug that only appears
    because the process *ends* between jobs.
  - `apps/web` is now a real Vite app (React 19, Tailwind v4, TanStack Query). One page, which calls
    `/health` and shows a dot. It is deliberately not a hello-world: a page that renders without
    touching the proxy, the Worker and the database would let the whole chain break and still look
    green, which is the failure P0.6 exists to remove.


- 2026-09-12 (Claude Code) — session 5

  - **P0.8 is not in the plan.** Phase 0's task list ends at P0.7. What was left was the phase's
    own **acceptance criteria and gate**, which is what this session did. Worth recording
    because the result argues for making that a numbered task everywhere: two of the three
    criteria were false, both had been false for days, and neither had produced a symptom.

  - **P0.5, P0.6 and P0.7 are committed.** They had lived only in the working tree — 69 files,
    HEAD still at P0.4. Four commits, scoped by concern, plus the P0.8 fixes. They were split
    out of one tree at the end, so each is coherent but was not built in isolation; the commit
    that says so says so.

  - **Criterion 1 — a fresh clone reaches `pnpm dev` in under 10 minutes. Now true: 31 seconds.**
    Measured by cloning into an empty directory and following the README verbatim. install 4 s
    (17 s with a cold pnpm store, measured separately), `db:up` 4 s, migrate+seed 5 s, `pnpm
    check` 18 s. 148 tests. Then `pnpm dev` in the clone: `/api/health` through Vite's proxy
    into workerd returned `{"ok":true,"service":"api"}` and the runner logged
    `claimed:1 succeeded:1 reclaimed:1`. The one unmeasured piece is the `postgres:17-alpine`
    pull on a machine that has never had it; labelled rather than estimated.

  - **The first run of that criterion failed, and it is the same bug P0.7 already fixed.**
    Following the README exactly produced **`67 passed | 14 skipped`, exit 0** — none of the
    job store tested. P0.7 found Turbo 2's strict env mode filtering `DATABASE_URL` and declared
    it on the `test` task. That was correct and insufficient: turbo forwards a variable it can
    see, and **nothing ever put this one in turbo's environment, because nothing loads `.env`.**
    Every layer behaved correctly and the run tested nothing. I had never seen it because I
    always ran `DATABASE_URL=... pnpm check` out of habit.
    - Root `test` script now loads `.env` via `node --env-file-if-exists`, which moves the Node
      floor to **22.9** — cheaper than a dotenv dependency in a repo that has refused every
      gratuitous one.
    - **The durable half: `jobs.pg.test.ts` now fails without a database rather than skipping**,
      unless `SAMSARA_NO_DB=1` says the omission is deliberate. Plumbing fixes hold until the
      next layer appears above them; the actual defect is the silent skip, because a green run
      that means nothing never gets investigated. The opt-out stays, because forbidding it just
      moves people to commenting the test out — it only has to be said out loud, which is the
      bargain `// seam:allow` already strikes.

  - **Criterion 2 — `@live` passes and its session row appears in Postgres. The row half had
    never been implemented.** The test used `MemorySessionStore` *and* `MemoryCounterStore` and
    asserted against the in-memory logger; no row had ever appeared, and it had passed since
    P0.4. The reason it was written that way is good and was applied one noun too far: counters
    must stay in memory or CI spends the demo's allowance on itself, but **a counter is money
    already spent and a session row is a record of something that happened.** The test now
    writes to Postgres when `DATABASE_URL` is set and reads the row back **through SQL**, not
    through the store that wrote it — a store asserting its own return value proves nothing
    about what landed. Budget stays isolated either way.

  - **A real defect the live run found: `Asia/Ho_Chi_Minh` and `Asia/Saigon` are one zone.**
    The test failed on `expected 'Asia/Saigon' to be 'Asia/Ho_Chi_Minh'`. The first is IANA's
    canonical id since 2016, the second the older name kept as a link, and **ICU — what every
    browser and every Node build resolves through — answers with the older one.** The viewpoint
    had landed perfectly: egress `103.252.202.21`, `navigator.language` `vi-VN`, offset −420.
    The assertion was wrong.
    - Not a test nit. **"Did the viewpoint reach the page" is a check every adapter after P1.0
      has to make**, and it decides whether an Observation is interpretable. A false negative is
      the expensive direction — it discards good data and sends someone hunting a proxy bug that
      does not exist. `Asia/Calcutta`/`Asia/Kolkata` is the same trap.
    - `packages/samsara/kernel/src/timezone.ts`: `canonicalTimezoneId` and `sameTimezone`,
      canonicalising **through `Intl` rather than a table we maintain** — aliases move with the
      tzdb and a hand-written map goes stale in silence. 4 tests, including that two zones
      sharing an offset (`Asia/Singapore` vs `Australia/Perth`) stay distinct.
    - **The `sessions` row still stores what we asked for**, which is correct: it records the
      viewpoint requested. What the page reported is a separate fact, and **P1.1 is where a
      persona starts carrying both** — the gap between them is why an Observation can be read.
    - Note the chain: P0.7 moved the engine's fixtures off `Asia/Bangkok` (no alias) onto
      `Asia/Ho_Chi_Minh` (has one) to get the product's first city out of the engine's
      vocabulary. **The seam fix is what exposed this bug.**

  - **Criterion 3 — held, verified both ways again.** Clean tree: `seam ok — 65 files under
    packages/samsara, no travel vocabulary, no travel dependencies.` With `export const
    hotelName` planted in `@samsara/core`: exit 1, naming file, line, the matched word, and the
    three remedies. **Zero allows of five.**

  - **Live spend: 0.1048 minutes across two sessions** (`6596664d` 0.0549, the run that failed
    on the assertion; `e9330835` 0.0499, green). Cumulative across the project: **0.204 of
    4,000 minutes**, 0.005%.

  - **One placeholder closed, one deliberately not.** `GITHUB_REPOSITORY` is now
    `AswinBehera/solari-TravelOS`. The Hyperdrive id is issued by `wrangler hyperdrive create`
    and cannot be invented, so it stays — now with a comment saying it is the one line that must
    change on deploy day, and that nothing local needs it.

  - **Not fixed, recorded: the Postgres tests share a database with `pnpm dev`.**
    `jobs.pg.test.ts` truncates `jobs` before each test, against the same
    `localhost:5432/doen_thang` the dev runner drains. Running `pnpm test` while `pnpm dev` is up
    truncates the dev queue out from under a live worker. Harmless today (the only job type is
    `noop`) and the fix is a separate test database, which is more moving parts than P0.8 should
    add. **Architect's call before P1.2, when harvest jobs start carrying state worth keeping.**

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

- **The queue port lives in `@samsara/kernel`** rather than a tenth package, because section 2.1 fixes
  the nine and both apps need it from opposite ends. ADR-0019.
- **The kernel is subdivided by runtime, not by layer**: `./node` holds the only `process`-touching
  file, `./jobs` is runtime-free, and `apps/api` imports those subpaths and never the barrel. Found
  the hard way — source-only packages mean the Workers typechecker compiles the kernel's Node source.
  ADR-0019.
- **`apps/api` typechecks twice** (`tsconfig.json` with `@cloudflare/workers-types` over the source,
  `tsconfig.test.json` with Node's types over the tests), because the source runs on Workers and the
  tests must run on Node to measure CPU at all.
- **`workerd`'s postinstall is allowed to run** (`allowBuilds` in `pnpm-workspace.yaml`). It is
  Cloudflare's own runtime binary and wrangler cannot start without it. Flagging it because allowing a
  postinstall script is a supply-chain decision, not a config tweak.
- **There is no `claimed` state.** A state nobody can act on differently is not a state, it is a
  comment. `running` plus `lease_until` carries the same information and is self-healing.
- **`jobs.type` is free text, not an enum.** An enum here would mean the engine's queue knows the
  product's job names, which is the seam.

- **The API listens on 8788, not wrangler's default 8787**, which is commonly occupied by other local
  tooling. Vite's proxy targets `127.0.0.1` rather than `localhost`, because on macOS `localhost`
  resolves to `::1` first, Vite listens on `::1`, and wrangler listens on IPv4 — naming the family
  turns an intermittent proxy failure into a non-event.
- **`apps/api`'s entrypoint exports only its default handler.** A workerd startup rule, not a style
  choice. See the session note above.
- **`apps/web` has no router yet.** ADR-0002 names TanStack Router and it will land with the second
  route (P1.7, the Persona Lab). A router over one route is a dependency with no decision behind it.
- **Hyperdrive's `localConnectionString` is committed in `wrangler.toml`**, pointing at the
  docker-compose database. Those are throwaway credentials, and a dev setup that needs a secret
  before it will start is a dev setup people work around.

- 2026-09-12 (Claude Code) — session 4c

  - **P0.7 done. `tools/check-seam.ts` + `pnpm check:seam` + `.github/workflows/ci.yml`.** 20 tests
    for the tool itself; the real tree passes; a planted `export const hotelName` fails it end to
    end. `turbo run check:seam test:tools` are root tasks with declared `inputs`, so the check
    re-runs only when the engine or the checker changes. `pnpm check` now runs lint, typecheck
    (which gained `tsc -p tools/tsconfig.json`), seam, tool tests, then the workspace tests.

  - **The check found 44 breaches on its first run, against an allowance ceiling of five.** That is
    the finding, not a detail: ADR-0009's ceiling was set before anyone tried to enforce it. Fixing
    it by writing forty `seam:allow` comments would have been switching the check off with extra
    steps. So the rule changed as well as the code — see the P0.7 amendment appended to ADR-0009.

  - **Executor decision: the lexicon is split by ambiguity, not by comment-versus-code.**
    `bangkok`, `tokyo`, `postcard`, `itinerary`, `tourist`, `hotel`, `restaurant` are scanned
    everywhere including comments; `travel`, `trip`, `place`, `flight`, `booking` are scanned in
    code and string literals only. Blanking comments wholesale was the obvious design and it is
    wrong: the worst breach found was `countries.ts` quoting *"plan section 1.4 names Bangkok as the
    first city"* in a comment. String literals stay in scope for both tiers because a prompt is
    code.

  - **Executor decision: a third check the plan did not specify.** The lexicon cannot see
    `import { db } from "@dt/db"` (no forbidden word), and the `package.json` check cannot either
    (source-only packages resolve workspace imports that were never declared). `check-seam.ts`
    scans engine source for `@dt/*` import statements directly. Without it the engine could import
    the whole product with a clean report.

  - **Executor decision: matching is by identifier segment, not word boundary.** `\btravel\b`
    misses `travelPack` and `Asia/Bangkok`; substring matching flags `replace`. Identifiers split
    on case changes and separators, one plural fold, deliberately not a stemmer.

  - **Executor decision: an unused `seam:allow` is an error, and a reason is mandatory.** Otherwise
    allows survive the rename that made them unnecessary and the count against the ceiling stops
    describing anything.

  - **Engine fixtures moved off the product's first city.** `country: "sg"` / `locale: "th-TH"` /
    `timezoneId: "Asia/Bangkok"` became `vn` / `vi-VN` / `Asia/Ho_Chi_Minh` across
    `core/src/fixtures.ts`, `kernel/src/{kernel,registry,live}.test.ts`. Chosen because
    `countries.ts` maps `vn` to the same substitute egress (`sg`) as `th`, so the
    unsupported-country path, the substitution and the viewpoint/egress disagreement are all still
    under test. `idempotencyKey: "trip-42"` -> `"dupe-42"`; the IANA example in `kernel.ts`'s error
    message is no longer a product city; engine comments now name markets by ISO code. 80 kernel
    tests pass against a real Postgres 17 after the rewrite.

  - **The per-package `seam.test.ts` files stay.** They check things the central tool does not
    (exact dependency lists, the provider SDK reachable from exactly one file), and they fail in the
    package that broke the rule. Their `importsTravelScope` identifier was itself a lexicon breach
    and is now `importsProductScope`.

  - **Latent bug found while writing CI: `pnpm test` was silently skipping every Postgres test.**
    Turbo 2 runs tasks in strict env mode, so `DATABASE_URL` never reached vitest no matter what
    the shell exported, and `jobs.pg.test.ts` skipped itself and reported green — 67 passed, 13
    skipped, exit 0. The CI workflow written this session would have claimed to test the job
    store, which is the one component with real concurrency in it, while testing none of it.
    Fixed by declaring `"env": ["DATABASE_URL", "SOLARI_LIVE"]` on the `test` task in
    `turbo.json`. `pnpm test` now runs 80 kernel tests, not 67.

  - **First CI workflow.** `ci.yml`: Postgres 17 service, `pnpm db:migrate`, then lint / typecheck /
    seam / tool tests / tests as **separate named steps**, because the step name is what the PR page
    shows — "seam" failing tells a reader the engine learned a travel word.

  - **Supabase credentials were not needed for P0.7.** They are needed for two things only: running
    an authenticated request against the real JWT path locally (`SUPABASE_URL`), and deploy.

Open for architect before P0.8:
- **Closed 11 September 2026 — ADR-0017. Google is out of the stack.** The quota-cap obligation is
  closed by deletion rather than by doing it: no Google API key is created, so there is nothing to
  cap, and **no vendor in the system can now bill Aswin's card without someone deciding to spend.**
  Resolution is tiered instead — coordinates already in the harvested artifact, then an OSM
  named-POI extract in our own Postgres, then a free-tier hosted geocoder (LocationIQ or Geoapify),
  then `unresolvable`. Not the public Nominatim server: its usage policy caps recurring scripts at
  4 req/min and names systematic querying as grounds for a ban, so the interim plan section 8 was
  carrying was never a safe harbour. Geocoding's ~$5 allocation returns to the reserve, which grows
  to ~$9 and stays reserve. ADR-0018 finishes the job on the map side: the basemap is a Protomaps
  `.pmtiles` extract we host, so there is no tile vendor either.
- **Worth asking Solari: is `th` residential egress on the roadmap?** ADR-0015 works without it, but
  the answer turns a design question back into a scheduling one.
- Section 10 questions 4, 5, 6, 7, 8 are unanswered. None of them block P0.5.
- **P0.5 is unblocked.** Questions 1 and 3 are both answered.
- **Answered: the repository is public.** So Actions minutes are unmetered, section 8 stays at
  three meters, and the Actions log is public — which is why the kernel's logger has no free-form
  field. Question 1 is fully closed.
- **Solari is not under maintenance.** The live call reached them and came back with a structured
  400, which is a healthy provider disagreeing with us.
- **Closed 11 September 2026 — ADR-0016.** The demo topology proposal (GitHub Actions cron + inline
  SSE, deleting BullMQ/Redis/the always-on box) was reviewed cold by Gemini 3.1 Pro via `agy` and
  two holes survived verification: a once-per-second poll behind SSE spends 86,400 of the free
  plan's 100,000 daily Hyperdrive queries **per open tab, account-wide**, and the 5-minute cron
  floor leaves a user-triggered harvest looking dead. Progress is now pushed on state change with a
  bounded backing-off stream; foreground jobs are dispatched via `workflow_dispatch`. Consequence
  for P0.5: the API gains an `actions:write` GitHub token as a Worker secret, and acceptance gains
  a case asserting a bounded query count for a stream held open across a real harvest.

---

## The Phase 0 gate

Per PLAN §5: *"Aswin reviews the kernel interface, the `DomainPack` contract, and ADRs 0009 to
0014. Nothing else."* All three acceptance criteria are met and measured above. What follows is
what the gate needs to look at, and the three places where the executor deviated or stopped
short on purpose.

**1. The kernel interface** — `packages/samsara/kernel/src/{ports,kernel,result}.ts`.
`withBrowser(purpose, viewpoint, fn)` refuses on the budget guard before anything opens, races a
hard deadline, force-closes on overrun, closes in a `finally`, and meters the minutes actually
taken whether or not the operation succeeded. Failures are classified
`budget | blocked | timeout | upstream | config | internal`; only `upstream` and `internal`
retry. `ports.ts` defines `BrowserLauncher`/`SandboxLauncher` and `solari.ts` is the only file
in the repository that imports the provider SDK. **The question for the gate:** the viewpoint is
`{ country, locale, timezoneId }` today. P1.1 adds stored preferences and a warmed profile.
Is `Viewpoint` the right name and the right shape to grow, or should it be a persona reference
from the start?

**2. The `DomainPack` contract** — `packages/samsara/refine/src/pack.ts`. **Only the identity
half exists** (`id`, `version`) plus `PackRegistry`, and this is the deviation most worth
overruling if it is wrong. PLAN §2.5 specifies `extract`, `entity`, `resolve`, `dedupKeys`,
`score`, `sources`, `queries`; writing those now would mean inventing `RawItem` batching,
`EntityRepo` and `ScoreSet` plumbing against no caller, and the first real pack would be shaped
by guesses rather than correcting them. What P0.5 needed was narrower and is real: a typed
registry the worker holds at boot with **zero packs in it** — the assertion that the runner has
no vertical compiled into it. `DomainPack` is already the exported name, so widening it at P2.2
is one file rather than every consumer. **The question:** accept the deferral, or is there a
member whose shape must be fixed now because something in P1 will otherwise be built against
the wrong assumption?

**3. ADRs 0009 to 0014**, plus the four written since:
- **0009 seam** — with the P0.7 amendment: the allowance ceiling was set before anyone tried to
  enforce it; 44 breaches, all fixed by rewriting, zero allows used.
- **0010 domain pack** — see the deferral above.
- **0011 OS is product language**, **0012 OpenRouter**, **0013 Supabase Auth** (no RLS in v1),
  **0014 Cloudflare + GitHub Actions** (the one that deleted BullMQ, Redis and the always-on box).
- Since: **0015 viewpoint over egress**, **0016 progress streaming and job dispatch**,
  **0017 place resolution without Google**, **0018 Protomaps basemap**, **0019 kernel owns the
  queue and splits by runtime**.

**Open questions that block P1**, unchanged from last session and now the only things standing
between here and P1.0:
- Section 10 questions 4, 5, 6, 7, 8 are unanswered.
- Whether to ask Solari about `th` residential egress on their roadmap. ADR-0015 works without
  it; the answer turns a design question back into a scheduling one.
- The shared test/dev database, noted above.

**Nothing is deployed, and nothing can be until two things exist:** a Cloudflare account (for the
Hyperdrive id) and Supabase credentials (`SUPABASE_URL` for the real JWT path). Neither blocks
any local work.
