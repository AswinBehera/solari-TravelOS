import type { SourceId } from "@samsara/core"

/**
 * How fast a source may be asked, and the honest limits of enforcing it here.
 *
 * **This is per-source, never global.** Asking YouTube is not evidence about how
 * hard TikTok is being asked, and a shared limiter would make a slow source
 * throttle a fast one for no reason anybody could explain at 2am.
 *
 * **And it is in-process only, which is a real limitation and not a TODO.** Under
 * ADR-0014 a drain is a scheduled GitHub Actions run that exits when it is done;
 * two runs can overlap, and neither can see the other's limiter. So what this
 * enforces is the interval *within one drain*, which is the interval that actually
 * produces the burst — a drain claiming twelve harvest jobs and firing them at one
 * source in four seconds is the shape that gets an identity banned. Cross-process
 * pacing is the `jobs.run_after` column, set by whoever enqueues, and that is the
 * right place for it: it survives a process exiting, which nothing in memory does.
 *
 * Storing the limiter state in Postgres was considered and rejected. It would make
 * every harvest pay a round trip to discover it may proceed, to defend against a
 * collision between two runs that the queue's own scheduling already makes rare —
 * and the failure it would prevent (two runs, one source, same second) is one the
 * source itself will report, as a refusal, which is a signal this system already
 * knows how to read.
 */

export interface Pacer {
  /**
   * Resolves when it is this caller's turn for `sourceId`.
   *
   * Rejects if `signal` aborts while waiting, because a runner being cancelled
   * mid-wait must not hold its lease sleeping through a shutdown it was told about.
   */
  wait(sourceId: SourceId, signal?: AbortSignal): Promise<void>
}

export interface PaceRule {
  /** Minimum gap between the *starts* of two requests to this source. */
  minIntervalMs: number
  /**
   * Random extra delay, 0..jitterMs, added to every wait.
   *
   * Not politeness: a fixed interval is a metronome, and a metronome is the
   * easiest possible thing for a rate-limiter on the other side to recognise. The
   * default is a quarter of the interval, which is enough to blur the pattern
   * without meaningfully changing the throughput anybody planned around.
   */
  jitterMs?: number
}

export const DEFAULT_RULE: PaceRule = { minIntervalMs: 5_000 }

/** Never paces. For unit tests of everything that is not the pacing. */
export const immediatePacer: Pacer = { async wait() {} }

export class MemoryPacer implements Pacer {
  readonly #rules: ReadonlyMap<SourceId, PaceRule>
  readonly #fallback: PaceRule
  readonly #nextFree = new Map<SourceId, number>()
  readonly #now: () => number
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly #random: () => number

  constructor(
    opts: {
      rules?: Readonly<Record<SourceId, PaceRule>>
      fallback?: PaceRule
      now?: () => number
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
      random?: () => number
    } = {},
  ) {
    this.#rules = new Map(Object.entries(opts.rules ?? {}))
    this.#fallback = opts.fallback ?? DEFAULT_RULE
    this.#now = opts.now ?? (() => Date.now())
    this.#sleep = opts.sleep ?? sleep
    this.#random = opts.random ?? Math.random
  }

  async wait(sourceId: SourceId, signal?: AbortSignal): Promise<void> {
    const rule = this.#rules.get(sourceId) ?? this.#fallback
    const jitterMs = rule.jitterMs ?? Math.floor(rule.minIntervalMs / 4)
    // `+ 1` makes the range inclusive of `jitterMs`, since `Math.random()` is
    // `[0, 1)`. Clamped because a test double is not obliged to honour that
    // contract, and a double returning exactly 1 should produce the maximum
    // jitter rather than one millisecond more than the maximum.
    const jitter = Math.min(jitterMs, Math.floor(this.#random() * (jitterMs + 1)))

    // The slot is reserved *before* the sleep, not after it. Two concurrent
    // callers awaiting the same source would otherwise both read the same
    // `nextFree`, both sleep the same duration, and both fire at the same instant
    // — which is precisely the burst this class exists to prevent, arrived at by
    // way of a rate limiter.
    const now = this.#now()
    const startAt = Math.max(now, this.#nextFree.get(sourceId) ?? 0) + jitter
    this.#nextFree.set(sourceId, startAt + rule.minIntervalMs)

    const delay = startAt - now
    if (delay > 0) await this.#sleep(delay, signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(new Error("aborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
