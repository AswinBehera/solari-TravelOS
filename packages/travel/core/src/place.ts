import { id, scoreSet, timestamps } from "@samsara/core"
import { z } from "zod"

export const placeCategory = z.enum([
  "food",
  "drink",
  "market",
  "temple",
  "nature",
  "nightlife",
  "shop",
  "other",
])
export type PlaceCategory = z.infer<typeof placeCategory>

export const geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type Geo = z.infer<typeof geo>

/**
 * The travel pack's entity. Written only through `@dt/travel-pack`'s `EntityRepo` —
 * the engine holds an opaque `(domainId, entityId)` pair and never touches this table.
 *
 * `scores` is a generic `ScoreSet` from `@samsara/core`: the pack decides that `local`
 * and `tourist` are the two that exist here, and each carries its own `because`
 * explanations so the UI can show the algorithm rather than assert a number.
 */
export const place = z
  .object({
    id,
    canonicalName: z.string().min(1),
    /** Native script, as written on the sign. Often the only name that resolves. */
    localName: z.string().min(1).nullable(),
    city: z.string().min(1),
    geo: geo.nullable(),
    googlePlaceId: z.string().min(1).nullable(),
    category: placeCategory,
    tags: z.array(z.string().min(1)),
    scores: scoreSet,
    firstSeenAt: z.date(),
    lastSeenAt: z.date(),
    evidenceCount: z.number().int().nonnegative(),
  })
  .extend(timestamps.shape)
export type Place = z.infer<typeof place>
