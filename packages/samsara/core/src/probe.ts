import { z } from "zod"
import { countryCode, id, sourceId, storageRef, timestamps } from "./primitives.js"

/** How often a watched target is re-observed. Null cadence means on demand only. */
export const probeCadence = z.enum(["hourly", "daily", "weekly"]).nullable()
export type ProbeCadence = z.infer<typeof probeCadence>

/**
 * One URL worth looking at from more than one country. `parsed` holds whatever the
 * source adapter declared it understands about the target — the engine does not read it.
 */
export const probeTarget = z
  .object({
    id,
    ownerId: z.string().min(1).nullable(),
    sourceId,
    url: z.url(),
    parsed: z.unknown(),
    watch: z.boolean(),
    cadence: probeCadence,
  })
  .extend(timestamps.shape)
export type ProbeTarget = z.infer<typeof probeTarget>

/**
 * What one country was actually shown, once, with a screenshot to prove it.
 *
 * `payload` is generic on purpose: a fare is one shape, a ranked result list another,
 * a rendered ad slot a third. The probe engine does not know which, and adding a
 * fourth must not require a migration here.
 */
export const observation = z
  .object({
    id,
    targetId: id,
    country: countryCode,
    personaId: id.nullable(),
    capturedAt: z.date(),
    payload: z.unknown(),
    screenshotRef: storageRef,
    sessionId: id,
    notes: z.string().nullable(),
  })
  .extend(timestamps.shape)
export type Observation = z.infer<typeof observation>
