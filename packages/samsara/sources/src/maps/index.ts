import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "../adapter.js"
import { captureMaps, type MapsCaptureOptions } from "./capture.js"
import { parseMaps } from "./parse.js"
import type { MapsPayload, MapsSurface } from "./types.js"

// Renamed on the way out, like TikTok's: three adapters now have a `buildSearchUrl`
// and the package index re-exports every folder, so the unqualified name is
// ambiguous at the package boundary. `tsc` says so, which is the seam doing its job
// in miniature.
export {
  buildReviewsUrl as buildMapsReviewsUrl,
  buildSearchUrl as buildMapsSearchUrl,
  DEFAULT_REVIEW_TAB_INDEX as MAPS_DEFAULT_REVIEW_TAB_INDEX,
  DEFAULT_SETTLE_MS as MAPS_DEFAULT_SETTLE_MS,
  MAX_SCROLLS as MAPS_MAX_SCROLLS,
  type MapsCaptureOptions,
  type MapsPage,
  type MapsResponse,
  SHAPE_REDACTIONS as MAPS_SHAPE_REDACTIONS,
} from "./capture.js"
export { entityUrl as mapsEntityUrl, parseMaps } from "./parse.js"
export type { MapsEntityNode, MapsPayload, MapsReviewNode, MapsSurface } from "./types.js"

/**
 * Google Maps as two adapters over one parser.
 *
 * `maps.search` takes a question — an area name, a category, whatever the caller
 * asks — and returns the result list. `maps.reviews` takes **an entity URL** as its
 * query and returns what people wrote about that one entity.
 *
 * The pairing is deliberate and it is the caller's to chain: search an area, then
 * run reviews on each result worth reading. An adapter that did both inside one
 * `capture()` would be one billed session of unbounded length, invisible to the
 * kernel's meters until it ended. See `capture.ts`.
 */
export function createMapsAdapter(
  surface: MapsSurface,
  options: MapsCaptureOptions = {},
): SourceAdapter<MapsPayload> {
  return {
    id: `maps.${surface}`,
    capture(ctx: CaptureContext, query: string): Promise<Capture<MapsPayload>> {
      return captureMaps(ctx, query, surface, options)
    },
    parse(capture: Capture<MapsPayload>): readonly ItemDraft[] {
      return parseMaps(capture)
    },
  }
}

export const mapsSearch = createMapsAdapter("search")
export const mapsReviews = createMapsAdapter("reviews")
