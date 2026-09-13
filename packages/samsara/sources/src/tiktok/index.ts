import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "../adapter.js"
import { captureTikTok, type TikTokCaptureOptions } from "./capture.js"
import { parseTikTok } from "./parse.js"
import type { TikTokPayload, TikTokSurface } from "./types.js"

// Renamed on the way out. Both adapters have a `buildSearchUrl` and the package
// index re-exports both folders, so the unqualified name is ambiguous at the
// package boundary — `tsc` says so, which is the seam doing its job in miniature.
// Qualified here rather than inside the folder, where `buildSearchUrl` is
// unambiguous and repeating the source name would be noise.
export {
  buildExploreUrl as buildTikTokExploreUrl,
  buildSearchUrl as buildTikTokSearchUrl,
  DEFAULT_SETTLE_MS as TIKTOK_DEFAULT_SETTLE_MS,
  type TikTokCaptureOptions,
  type TikTokPage,
  type TikTokResponse,
} from "./capture.js"
export { parseTikTok } from "./parse.js"
export type { InterceptedBody, TikTokPayload, TikTokSurface } from "./types.js"

/**
 * TikTok, logged out, as two adapters over one parser — the same shape as YouTube,
 * and for the same reason: `sourceId` is what a stored row is grouped and
 * re-parsed by, and "what I asked for" and "what the region is shown" are not the
 * same evidence.
 *
 * This is the adapter the plan expects to be refused by, and the one whose
 * refusals are the point. See `capture.ts`.
 *
 * **`explore` ignores its query argument**, unlike YouTube's trending, which takes
 * a category. TikTok's explore feed has no category in the URL, so there is nothing
 * honest to map the argument onto; it is stored on the capture as the question
 * asked, and the capture is a record of a question that had no effect.
 */
export function createTikTokAdapter(
  surface: TikTokSurface,
  options: TikTokCaptureOptions = {},
): SourceAdapter<TikTokPayload> {
  return {
    id: `tiktok.${surface}`,
    capture(ctx: CaptureContext, query: string): Promise<Capture<TikTokPayload>> {
      return captureTikTok(ctx, query, surface, options)
    },
    parse(capture: Capture<TikTokPayload>): readonly ItemDraft[] {
      return parseTikTok(capture)
    },
  }
}

export const tiktokSearch = createTikTokAdapter("search")
export const tiktokExplore = createTikTokAdapter("explore")
