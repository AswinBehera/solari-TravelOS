import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "../adapter.js"
import { captureYouTube, type YouTubeCaptureOptions } from "./capture.js"
import { parseYouTube } from "./parse.js"
import type { YouTubePayload } from "./types.js"

export { buildSearchUrl, buildTrendingUrl, type YouTubePage } from "./capture.js"
export { parseCount } from "./counts.js"
export { parseYouTube } from "./parse.js"
export type { YouTubePayload } from "./types.js"

/**
 * YouTube, logged out, as two adapters over one parser.
 *
 * Two rather than one because `sourceId` is what a stored row is grouped and
 * re-parsed by, and a search result and a trending slot are not the same kind of
 * evidence: one is an answer to a question somebody asked, the other is what the
 * region was being shown regardless. Collapsing them would make every later
 * question about either one require a join that does not exist.
 *
 * One parser because the response shape is identical — the same renderers in a
 * different container — which is precisely what searching the tree for renderer
 * names instead of walking a path buys.
 *
 * **Trending takes the category as its `query`.** The interface has a query
 * parameter and trending has no query, so the honest options were to ignore the
 * argument or to give it the nearest real meaning. `""` asks for the default feed.
 */
export function createYouTubeAdapter(
  surface: "search" | "trending",
  options: YouTubeCaptureOptions = {},
): SourceAdapter<YouTubePayload> {
  return {
    id: `youtube.${surface}`,
    capture(ctx: CaptureContext, query: string): Promise<Capture<YouTubePayload>> {
      return captureYouTube(ctx, query, surface, options)
    },
    parse(capture: Capture<YouTubePayload>): readonly ItemDraft[] {
      return parseYouTube(capture)
    },
  }
}

export const youtubeSearch = createYouTubeAdapter("search")
export const youtubeTrending = createYouTubeAdapter("trending")
