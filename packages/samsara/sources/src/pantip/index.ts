import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "../adapter.js"
import { capturePantip, type PantipCaptureOptions } from "./capture.js"
import { parsePantip } from "./parse.js"
import type { PantipPayload, PantipSurface } from "./types.js"

// Renamed on the way out, like TikTok's and Maps'. The package index re-exports every
// folder, so an unqualified `buildForumUrl` would be ambiguous at the package
// boundary. `tsc` says so, which is the seam doing its job in miniature.
export {
  buildForumUrl as buildPantipForumUrl,
  buildPantipUrl,
  buildTagUrl as buildPantipTagUrl,
  buildTopicUrl as buildPantipTopicUrl,
  DEFAULT_SETTLE_MS as PANTIP_DEFAULT_SETTLE_MS,
  FRAGMENT_CHARS as PANTIP_FRAGMENT_CHARS,
  MAX_FRAGMENTS as PANTIP_MAX_FRAGMENTS,
  MAX_SCROLLS as PANTIP_MAX_SCROLLS,
  type PantipCaptureOptions,
  type PantipPage,
  type PantipResponse,
  SHAPE_REDACTIONS as PANTIP_SHAPE_REDACTIONS,
} from "./capture.js"
export { canonicalTopicUrl as pantipTopicUrl, parsePantip } from "./parse.js"
export type { PantipPayload, PantipPostNode, PantipSurface, PantipTopicNode } from "./types.js"

/**
 * Pantip as three adapters over one parser.
 *
 * `pantip.forum` takes a board id, `pantip.tag` takes a tag, `pantip.topic` takes a
 * topic id or a topic URL — which is what the other two produce. The chaining is the
 * caller's, for the cost reason `capture.ts` sets out.
 */
export function createPantipAdapter(
  surface: PantipSurface,
  options: PantipCaptureOptions = {},
): SourceAdapter<PantipPayload> {
  return {
    id: `pantip.${surface}`,
    capture(ctx: CaptureContext, query: string): Promise<Capture<PantipPayload>> {
      return capturePantip(ctx, query, surface, options)
    },
    parse(capture: Capture<PantipPayload>): readonly ItemDraft[] {
      return parsePantip(capture)
    },
  }
}

export const pantipForum = createPantipAdapter("forum")
export const pantipTag = createPantipAdapter("tag")
export const pantipTopic = createPantipAdapter("topic")
