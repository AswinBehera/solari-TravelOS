import { describe, expect, it } from "vitest"
import { DEFAULT_RULE, MemoryPacer } from "./pace.js"

/**
 * The pacer, against a fake clock.
 *
 * Every test here injects `now`, `sleep` and `random`, so the suite runs in
 * microseconds and asserts the *decision* rather than the elapsed time. A pacing
 * test that actually waits is a pacing test nobody runs.
 */

interface HarnessOpts {
  rules?: Record<string, { minIntervalMs: number; jitterMs?: number }>
  random?: number
}

/**
 * Records what was asked for instead of waiting, against a clock that only moves
 * when a test says so.
 *
 * The fake `sleep` deliberately does **not** advance the clock. An earlier version
 * did, and it made the concurrency test lie: three waiters entered in the same tick
 * but the second one's synchronous fake sleep moved the shared clock forward before
 * the third read it, so the third computed its delay from a later "now" than it
 * actually had. That models sequential waits, which is the case that needs no
 * pacing. A frozen clock models what the class is for — several waiters arriving at
 * the same instant — and leaves advancing it to the one test about elapsed time.
 */
function harness(opts: HarnessOpts = {}) {
  let now = 1_000_000
  const slept: number[] = []
  const pacer = new MemoryPacer({
    ...(opts.rules ? { rules: opts.rules } : {}),
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
    },
    random: () => opts.random ?? 0,
  })
  return { pacer, slept, advance: (ms: number) => (now += ms), at: () => now }
}

describe("MemoryPacer", () => {
  it("lets the first request through immediately", async () => {
    const h = harness()
    await h.pacer.wait("a.source")
    expect(h.slept).toEqual([])
  })

  it("holds the second request for the interval", async () => {
    const h = harness({ rules: { "a.source": { minIntervalMs: 5_000, jitterMs: 0 } } })
    await h.pacer.wait("a.source")
    await h.pacer.wait("a.source")
    expect(h.slept).toEqual([5_000])
  })

  it("charges nothing for time that already passed", async () => {
    const h = harness({ rules: { "a.source": { minIntervalMs: 5_000, jitterMs: 0 } } })
    await h.pacer.wait("a.source")
    h.advance(6_000)
    await h.pacer.wait("a.source")
    expect(h.slept).toEqual([])
  })

  it("paces each source separately", async () => {
    const h = harness({
      rules: {
        "a.source": { minIntervalMs: 5_000, jitterMs: 0 },
        "b.source": { minIntervalMs: 5_000, jitterMs: 0 },
      },
    })
    await h.pacer.wait("a.source")
    // Asking one source is not evidence about how hard another is being asked.
    await h.pacer.wait("b.source")
    expect(h.slept).toEqual([])
  })

  it("reserves the slot before sleeping, so concurrent waiters do not collide", async () => {
    const h = harness({ rules: { "a.source": { minIntervalMs: 5_000, jitterMs: 0 } } })
    // Three at once. If the slot were reserved after the sleep, all three would
    // read the same `nextFree`, sleep the same duration, and fire together — the
    // exact burst the class exists to prevent, arrived at via a rate limiter.
    await Promise.all([
      h.pacer.wait("a.source"),
      h.pacer.wait("a.source"),
      h.pacer.wait("a.source"),
    ])
    expect(h.slept).toEqual([5_000, 10_000])
  })

  it("adds jitter, because a fixed interval is a metronome", async () => {
    const h = harness({
      rules: { "a.source": { minIntervalMs: 4_000, jitterMs: 1_000 } },
      random: 1,
    })
    await h.pacer.wait("a.source")
    // The first call is delayed too: jitter that only applies to later requests
    // still leaves the first one of every drain landing at a predictable instant.
    expect(h.slept).toEqual([1_000])
  })

  it("defaults jitter to a quarter of the interval", async () => {
    const h = harness({ rules: { "a.source": { minIntervalMs: 8_000 } }, random: 1 })
    await h.pacer.wait("a.source")
    expect(h.slept).toEqual([2_000])
  })

  it("falls back to the default rule for an unknown source", async () => {
    const h = harness({ random: 0 })
    await h.pacer.wait("unknown.source")
    await h.pacer.wait("unknown.source")
    expect(h.slept).toEqual([DEFAULT_RULE.minIntervalMs])
  })

  it("rejects when the runner is cancelled mid-wait", async () => {
    const controller = new AbortController()
    const pacer = new MemoryPacer({ rules: { "a.source": { minIntervalMs: 50, jitterMs: 0 } } })
    await pacer.wait("a.source", controller.signal)
    const pending = pacer.wait("a.source", controller.signal)
    controller.abort()
    // A runner told to shut down must not hold its lease sleeping through it.
    await expect(pending).rejects.toThrow(/aborted/)
  })

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const pacer = new MemoryPacer({ rules: { "a.source": { minIntervalMs: 50, jitterMs: 0 } } })
    await pacer.wait("a.source", controller.signal)
    await expect(pacer.wait("a.source", controller.signal)).rejects.toThrow(/aborted/)
  })
})
