import { id, timestamps } from "@samsara/core"
import { z } from "zod"
import { geo } from "./place.js"

export const postcardKind = z.enum(["place", "price", "note", "photo", "link", "checklist"])
export type PostcardKind = z.infer<typeof postcardKind>

/**
 * `fresh` was confirmed recently, `stale` needs re-checking, `pinned` is the user's
 * decision and daemons leave it alone.
 */
export const postcardState = z.enum(["fresh", "stale", "pinned"])
export type PostcardState = z.infer<typeof postcardState>

/**
 * The only thing that appears on the map. If it has no geo, it does not appear —
 * that rule is the reason `geo` is nullable here rather than optional.
 */
export const postcard = z
  .object({
    id,
    tripId: id,
    kind: postcardKind,
    placeId: id.nullable(),
    /** Kind-specific. Narrowed by the renderer, not by this schema. */
    payload: z.unknown(),
    geo: geo.nullable(),
    /** A date, or a range. Null for things that are not about a time. */
    time: z.object({ start: z.date(), end: z.date().nullable() }).nullable(),
    /** Evidence ids in the engine's table. Every card can show its receipts. */
    sourceRefs: z.array(id),
    state: postcardState,
  })
  .extend(timestamps.shape)
export type Postcard = z.infer<typeof postcard>
