import { z } from "zod"
import { engagement } from "./harvest.js"
import { domainId, id, sourceId, storageRef, timestamps } from "./primitives.js"

export const resolutionState = z.enum(["pending", "resolved", "unresolvable"])
export type ResolutionState = z.infer<typeof resolutionState>

/**
 * Something a pack's extractor found in a RawItem, before anyone worked out what it
 * refers to. `payload` is opaque here and validated against the pack's own
 * `mentionSchema` at the boundary — the engine stores it, the pack shapes it.
 */
export const mention = z
  .object({
    id,
    rawItemId: id,
    domainId,
    /** Bumped whenever the pack's prompts or weights change. Stored so old rows stay readable. */
    packVersion: z.string().min(1),
    payload: z.unknown(),
    /** Opaque pointer into the pack's own table. Null until resolved. See `entityRef`. */
    entityId: id.nullable(),
    resolution: resolutionState,
    confidence: z.number().min(0).max(1),
  })
  .extend(timestamps.shape)
export type Mention = z.infer<typeof mention>

/**
 * Why we believe something about an entity: which identity saw it, where, when, in
 * what language, and the receipt. Every score points back at these, and a score with
 * no Evidence behind it is a bug.
 */
export const evidence = z
  .object({
    id,
    domainId,
    /** Opaque by design — no foreign key to a vertical's table. See section 3 of the plan. */
    entityId: id,
    rawItemId: id,
    sourceId,
    sourceUrl: z.url(),
    personaId: id,
    language: z.string().min(2).nullable(),
    capturedAt: z.date(),
    /** Pack-shaped. The engine carries it without reading it. */
    extract: z.unknown(),
    rawRef: storageRef,
    engagement: engagement.nullable(),
  })
  .extend(timestamps.shape)
export type Evidence = z.infer<typeof evidence>
