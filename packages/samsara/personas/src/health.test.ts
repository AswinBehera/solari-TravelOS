import type { SessionOutcome } from "@samsara/core"
import { describe, expect, it } from "vitest"
import {
  assess,
  BLOCKS_TO_BAN,
  BLOCKS_TO_DEGRADE,
  CLEAN_TO_RECOVER,
  SESSION_SCAN_DEPTH,
  VERDICTS_NEEDED,
} from "./health.js"

/** Newest first, the order `assess` documents and the store returns. */
const hist = (...o: SessionOutcome[]): SessionOutcome[] => o

describe("assess", () => {
  it("leaves a healthy persona alone after a single refusal", () => {
    const v = assess("healthy", hist("blocked", "ok", "ok"))
    expect(v.health).toBe("healthy")
    expect(v.changed).toBe(false)
    expect(v.blockStreak).toBe(1)
  })

  it("degrades on two consecutive refusals", () => {
    const v = assess("healthy", hist("blocked", "blocked", "ok"))
    expect(v.health).toBe("degraded")
    expect(v.changed).toBe(true)
    expect(v.reason).toContain("2 consecutive")
  })

  it("bans on three", () => {
    expect(assess("degraded", hist("blocked", "blocked", "blocked")).health).toBe("banned")
  })

  it("counts the streak from the newest end, not the oldest", () => {
    // Three refusals are present, but they are old and the recent sessions are
    // clean. Reading this list backwards would ban a working persona.
    const v = assess("healthy", hist("ok", "ok", "blocked", "blocked", "blocked"))
    expect(v.health).toBe("healthy")
    expect(v.blockStreak).toBe(0)
    expect(v.cleanStreak).toBe(2)
  })

  it("recovers a degraded persona only after two clean sessions", () => {
    expect(assess("degraded", hist("ok", "blocked")).health).toBe("degraded")
    expect(assess("degraded", hist("ok", "ok", "blocked")).health).toBe("healthy")
  })

  it("never recovers a healthy persona into something else by accident", () => {
    const v = assess("healthy", hist("ok", "ok", "ok"))
    expect(v.health).toBe("healthy")
    expect(v.changed).toBe(false)
  })

  describe("non-verdicts", () => {
    it("skips timeouts and errors rather than counting them either way", () => {
      // Two refusals with our own timeout in between is still two refusals.
      const v = assess("healthy", hist("blocked", "timeout", "blocked"))
      expect(v.blockStreak).toBe(2)
      expect(v.health).toBe("degraded")
    })

    it("does not let a run of our own failures look like health", () => {
      const v = assess("degraded", hist("error", "timeout", "orphaned", "blocked"))
      expect(v.cleanStreak).toBe(0)
      expect(v.health).toBe("degraded")
    })

    it("ignores sessions still running", () => {
      expect(assess("healthy", hist("running", "blocked", "blocked")).health).toBe("degraded")
    })
  })

  describe("terminal states", () => {
    it("does not un-ban on clean evidence", () => {
      const v = assess("banned", hist("ok", "ok", "ok", "ok"))
      expect(v.health).toBe("banned")
      expect(v.changed).toBe(false)
    })

    it("does not overturn a retirement", () => {
      expect(assess("retired", hist("ok", "ok", "ok")).health).toBe("retired")
    })

    it("does not re-ban an already banned persona into a change event", () => {
      expect(assess("banned", hist("blocked", "blocked", "blocked")).changed).toBe(false)
    })
  })

  it("survives an empty history", () => {
    const v = assess("healthy", [])
    expect(v).toMatchObject({ health: "healthy", changed: false, blockStreak: 0, cleanStreak: 0 })
  })

  it("reads far enough back to reach a ban through non-verdicts", () => {
    expect(VERDICTS_NEEDED).toBe(Math.max(BLOCKS_TO_BAN, CLEAN_TO_RECOVER))
    expect(SESSION_SCAN_DEPTH).toBeGreaterThan(VERDICTS_NEEDED)
    // The scan depth has to survive a realistic run of non-verdicts before the
    // evidence. If it did not, a persona that had just timed out a few times could
    // never be banned — the failure direction that keeps spending money.
    const padded: SessionOutcome[] = [
      ...Array<SessionOutcome>(SESSION_SCAN_DEPTH - BLOCKS_TO_BAN).fill("timeout"),
      ...Array<SessionOutcome>(BLOCKS_TO_BAN).fill("blocked"),
    ]
    expect(assess("healthy", padded.slice(0, SESSION_SCAN_DEPTH).reverse()).health).toBe("banned")
  })

  it("degrades before it bans, at every streak length in between", () => {
    for (let n = BLOCKS_TO_DEGRADE; n < BLOCKS_TO_BAN; n++) {
      const v = assess("healthy", Array<SessionOutcome>(n).fill("blocked"))
      expect(v.health).toBe("degraded")
    }
  })
})
