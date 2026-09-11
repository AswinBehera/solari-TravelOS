import type { MeterId, SessionOutcome, SessionPurpose } from "@samsara/core"
import type { FailureKind } from "./result.js"

/**
 * Structured logs (plan section 2.4, item 5). One JSON line per event.
 *
 * The repository is public, which means the GitHub Actions log is public
 * (ADR-0014). So the defence against logging a secret is not a redaction denylist
 * — those are only ever as good as their last update — it is that **the event
 * types have nowhere to put one**. There is no `payload`, no `meta`, no
 * `Record<string, unknown>` anywhere below. Adding a field is a reviewed diff in
 * this file, which is the only place where "should this be public?" gets asked.
 *
 * Consequently: no request bodies, no harvested text, no URLs with query strings,
 * no values read from `process.env`. Counts, durations, ids, and error classes.
 */

interface Base {
  /** Monotonic-ish wall clock. Every run records its own time because a scheduled
   *  workflow cannot assume it ran on the schedule it was meant to (ADR-0014). */
  at: string
}

export type KernelEvent = Base &
  (
    | {
        event: "session.open"
        sessionId: string
        purpose: SessionPurpose
        /** Where the packets came from. */
        country: string
        /** What the browser claimed to be. Divergence from `country` is deliberate
         *  and is the thing a Persona Lab reading these logs needs to see. */
        locale: string | null
        timezoneId: string | null
        personaId: string | null
        domainId: string | null
        recording: boolean
      }
    | {
        event: "session.close"
        sessionId: string
        purpose: SessionPurpose
        country: string
        personaId: string | null
        outcome: SessionOutcome
        durationMs: number
        minutes: number
        /** Bytes read through the session, when the caller can report it. */
        bytes: number | null
      }
    | {
        event: "session.orphaned"
        sessionId: string
        purpose: SessionPurpose
        /** How long the row sat open with no live handle. */
        ageMs: number
      }
    | {
        event: "budget.refused"
        meter: MeterId
        window: string
        ceiling: number
        used: number
        requested: number
      }
    | {
        event: "budget.spent"
        meter: MeterId
        amount: number
        purpose: SessionPurpose | null
      }
    | {
        event: "attempt.retry"
        purpose: SessionPurpose
        attempt: number
        of: number
        delayMs: number
        /** The class only. Never the message, which can quote a page. */
        because: FailureKind
      }
    | {
        event: "attempt.failed"
        purpose: SessionPurpose
        kind: FailureKind
        /** Safe by construction: kernel-authored strings, never provider text. */
        message: string
        attempts: number
      }
  )

export interface Logger {
  emit(event: KernelEvent): void
}

/** One JSON object per line on stdout — what GitHub Actions and `jq` both want. */
export const jsonLogger: Logger = {
  emit(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
}

/** Collects events instead of printing them. For assertions in tests. */
export class MemoryLogger implements Logger {
  readonly events: KernelEvent[] = []
  emit(event: KernelEvent): void {
    this.events.push(event)
  }
}

export const silentLogger: Logger = { emit() {} }

export const now = (): string => new Date().toISOString()
