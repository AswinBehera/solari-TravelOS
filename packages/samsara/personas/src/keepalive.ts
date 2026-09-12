import type { PersonaHealth } from "@samsara/core"
import {
  Blocked,
  err,
  type Failure,
  failure,
  type Kernel,
  type Logger,
  now,
  ok,
  type ProfileStore,
  type Result,
  type SessionSpend,
  silentLogger,
} from "@samsara/kernel"
import { reassess } from "./lifecycle.js"
import type { PersonaStore } from "./store.js"

/**
 * The `keepalive` job (plan section P1.1): open the identity, read a couple of
 * ordinary pages, keep what the browser accumulated, write down that it is alive.
 *
 * **The pages are the caller's.** The engine has no idea which pages count as
 * ordinary for a given identity, and the moment it does, `@samsara/` contains a
 * vertical's vocabulary and `pnpm check:seam` fails the build. So `urls` is an
 * argument, and a pack — or a job payload — decides what a given identity reads
 * on a given Tuesday. (The first draft of this paragraph named a city as its
 * example, and `pnpm check:seam` failed on the sentence explaining why it would.)
 *
 * The line that actually matters is `profiles.save`. Attaching a profile does not
 * persist anything; the provider discards the session's cookies on release unless
 * someone asks it not to. A keepalive that forgets that call costs the same
 * minutes, writes the same `ok` row, moves `lastAliveAt` forward, and leaves the
 * identity exactly as naive as it was — which is the most expensive kind of bug
 * this package can have, because its symptom is *nothing*.
 */

/** Playwright's `Page`, as this file needs it. Its real type stays with the caller. */
export interface PageLike {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<{ status(): number } | null>
  context(): { storageState(): Promise<unknown> }
}

export interface KeepaliveDeps {
  kernel: Kernel
  store: PersonaStore
  profiles?: ProfileStore
  logger?: Logger
  clock?: () => Date
}

export interface KeepaliveInput {
  personaId: string
  /** Ordinary pages for this identity. Supplied by the caller; see the note above. */
  urls: readonly string[]
  /** How long to sit on each page. Short: this is presence, not engagement. */
  dwellMs?: number
  deadlineMs?: number
  /** Fewer than the default 3. A keepalive is not worth three sessions' minutes. */
  attempts?: number
}

export interface KeepaliveReport {
  personaId: string
  visited: string[]
  /** False when nothing was persisted, including when there was nothing to persist. */
  saved: boolean
  savedBytes: number | null
  /** Summed across attempts, including the ones that failed. */
  minutes: number
  sessions: number
  health: PersonaHealth
  healthChanged: boolean
}

export const DEFAULT_DWELL_MS = 4_000

export async function keepalive(
  deps: KeepaliveDeps,
  input: KeepaliveInput,
): Promise<Result<KeepaliveReport, Failure>> {
  const logger = deps.logger ?? silentLogger
  const clock = deps.clock ?? (() => new Date())
  const dwellMs = input.dwellMs ?? DEFAULT_DWELL_MS

  const persona = await deps.store.byId(input.personaId)
  if (!persona) return err(failure("config", `no such persona: ${input.personaId}`))
  if (persona.health === "banned" || persona.health === "retired") {
    // Refused rather than skipped-with-a-warning: the point of the health state is
    // that it stops spend, and a keepalive is spend on an identity we have already
    // concluded is finished.
    return err(
      failure(
        "config",
        `persona ${persona.id} is ${persona.health}; keepalive would spend on a dead identity`,
      ),
    )
  }
  if (input.urls.length === 0) {
    return err(
      failure(
        "config",
        "keepalive needs at least one url; a session that visits nothing is a bill",
      ),
    )
  }

  const spends: SessionSpend[] = []
  const visited: string[] = []
  let saved = false
  let savedBytes: number | null = null

  const result = await deps.kernel.withBrowser(
    "persona.keepalive",
    {
      country: persona.country,
      locale: persona.locale,
      timezoneId: persona.timezoneId,
      personaId: persona.id,
      ...(persona.proxySession ? { proxySession: persona.proxySession } : {}),
      ...(persona.solariProfileId ? { profileId: persona.solariProfileId } : {}),
      ...(input.deadlineMs ? { deadlineMs: input.deadlineMs } : {}),
      attempts: input.attempts ?? 2,
      onSession: (spend) => spends.push(spend),
    },
    async (page, signal) => {
      const p = page as PageLike
      // Reset per attempt: a retry starts from an empty list, or a failure halfway
      // through the first try would be reported as having visited those pages twice.
      visited.length = 0
      for (const url of input.urls) {
        if (signal.aborted) break
        const response = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
        // `goto` does not throw on a 403 — it returns one. Left unread, a refusal
        // classifies as `internal` and is retried, which is both a second bill and
        // a second refusal from a surface now watching this identity retry.
        const status = response?.status() ?? 0
        if (status >= 400) throw new Blocked(`HTTP ${status}`)
        visited.push(url)
        await sleep(dwellMs, signal)
      }

      // Inside `fn`, deliberately. The kernel closes the browser in a `finally`,
      // so anything that needs the live context has exactly this window.
      if (persona.solariProfileId && deps.profiles) {
        const state = await p.context().storageState()
        const outcome = await deps.profiles.save(persona.solariProfileId, state)
        saved = true
        savedBytes = outcome.sizeBytes
      }
      return visited.length
    },
  )

  // Every attempt was a real session and every one of them was metered. Recorded
  // one row at a time rather than as a total, so a persona's session count matches
  // the `sessions` table rather than the number of times someone called this.
  for (const spend of spends) {
    await deps.store.recordSession(persona.id, {
      minutes: spend.minutes,
      outcome: spend.outcome,
      at: clock(),
    })
  }

  const verdict = await reassess({ store: deps.store, logger }, persona.id)
  const minutes = spends.reduce((sum, s) => sum + s.minutes, 0)

  logger.emit({
    at: now(),
    event: "persona.keepalive",
    personaId: persona.id,
    visited: visited.length,
    saved,
    savedBytes,
  })

  if (!result.ok) return err(result.error)
  return ok({
    personaId: persona.id,
    visited: [...visited],
    saved,
    savedBytes,
    minutes,
    sessions: spends.length,
    health: verdict.ok ? verdict.value.health : persona.health,
    healthChanged: verdict.ok ? verdict.value.changed : false,
  })
}

/** Abortable, because SIGTERM during a dwell must not wait out the dwell. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
