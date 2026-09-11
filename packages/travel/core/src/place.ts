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
    /**
     * Where the coordinate came from, tagged with which tier produced it (ADR-0017).
     * `artifact` — the harvested post carried it. `osm` — matched against our own
     * OSM extract. `geocoder` — a hosted free-tier lookup. Source-tagged rather than
     * a bare id because dedup must not merge an OSM node id with a geocoder's id
     * that happens to collide.
     */
    externalRef: z
      .object({ source: z.enum(["artifact", "osm", "geocoder"]), id: z.string().min(1) })
      .nullable(),
    /** Which tier resolved it: 0 artifact, 1 OSM extract, 2 hosted geocoder. */
    resolvedTier: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    category: placeCategory,
    tags: z.array(z.string().min(1)),
    scores: scoreSet,
    firstSeenAt: z.date(),
    lastSeenAt: z.date(),
    evidenceCount: z.number().int().nonnegative(),
  })
  .extend(timestamps.shape)
export type Place = z.infer<typeof place>
