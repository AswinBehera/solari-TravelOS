import {
  mapsReviews,
  mapsSearch,
  pantipForum,
  pantipTag,
  pantipTopic,
  type SourceAdapter,
  tiktokExplore,
  tiktokSearch,
  youtubeSearch,
  youtubeTrending,
} from "@samsara/sources"

/**
 * Every source this deployment can be told to spend money on.
 *
 * **Registered by name, not discovered.** An adapter that is importable is not
 * thereby permitted: this list is a line somebody wrote, and adding to it is the
 * decision to let a queued job open a browser against that surface.
 *
 * It lives in its own module rather than inside `boot()` for a reason found the
 * cheap way, by a list drifting: `record-capture.ts` keeps a second list of the same
 * adapters, an adapter wired into one and not the other is not a type error, and
 * nothing failed when it happened. `sources.test.ts` now compares the two.
 */
export const SOURCE_ADAPTERS: ReadonlyArray<SourceAdapter<unknown>> = [
  youtubeSearch as SourceAdapter<unknown>,
  youtubeTrending as SourceAdapter<unknown>,
  tiktokSearch as SourceAdapter<unknown>,
  tiktokExplore as SourceAdapter<unknown>,
  mapsSearch as SourceAdapter<unknown>,
  mapsReviews as SourceAdapter<unknown>,
  pantipForum as SourceAdapter<unknown>,
  pantipTag as SourceAdapter<unknown>,
  pantipTopic as SourceAdapter<unknown>,
]

export function sourceRegistry(): Map<string, SourceAdapter<unknown>> {
  return new Map(SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter]))
}
