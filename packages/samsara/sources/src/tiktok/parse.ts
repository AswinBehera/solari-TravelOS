import type { Engagement } from "@samsara/core"
import type { Capture, ItemDraft } from "../adapter.js"
import { parseCount } from "../counts.js"
import { guessLanguage } from "../language.js"
import type { TikTokPayload } from "./types.js"

/**
 * Turning a captured TikTok response into drafts. Pure, synchronous, free.
 *
 * **The interesting difference from YouTube is that TikTok does not name its
 * items.** YouTube tags every result with a renderer name — `videoRenderer`,
 * `gridVideoRenderer` — so the parser can search the tree for a *name* and be
 * confident that anything under one is a video. TikTok's items are anonymous
 * objects sitting in arrays called `itemList`, `item_list`, `data`, or nothing at
 * all, depending on which endpoint answered.
 *
 * So recognition here is **structural**: an object is an item if it has a
 * digit-string `id`, a string `desc`, and an author or a stats block. That is a
 * weaker guarantee than a name, and it has a failure mode a name search does not
 * — false positives. A structural matcher that is too loose will happily return a
 * music track, a hashtag, or a "related search" suggestion as a video, and every
 * one of those would be stored as evidence and scored. So the predicate is
 * deliberately strict and the cost of that is admitted: an item shaped unusually
 * is dropped rather than guessed at, which is the same trade `counts.ts` makes for
 * the same reason.
 *
 * **Both strategies are parsed, state first, then the API bodies**, and the two
 * are deduplicated against each other by item id. State first because when both
 * are present the state is the page as rendered — the order a person saw — while
 * the API bodies arrive in network order, which is close to rank order and not
 * guaranteed to be it. Encounter order is preserved throughout, for the reason it
 * is preserved in every parser here: it is rank order, and P1.8's whole
 * measurement is set overlap over ranked lists.
 */

const MAX_DEPTH = 40

export function parseTikTok(capture: Capture<TikTokPayload>): readonly ItemDraft[] {
  const seen = new Set<string>()
  const drafts: ItemDraft[] = []

  const collect = (node: unknown) => {
    walk(node, 0, (candidate) => {
      const draft = toDraft(candidate)
      if (!draft) return
      if (seen.has(draft.id)) return
      seen.add(draft.id)
      drafts.push(draft.item)
    })
  }

  collect(capture.payload.state)
  for (const body of capture.payload.intercepted) collect(body.body)

  return drafts
}

/** Depth-first, in document order, calling back on every object at all. */
function walk(node: unknown, depth: number, visit: (candidate: Record<string, unknown>) => void) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return

  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, depth + 1, visit)
    return
  }

  const record = node as Record<string, unknown>
  if (looksLikeItem(record)) visit(record)
  // Descends even into something that matched: the search API wraps a video as
  // `{ type: 1, item: {...} }`, and both the wrapper and the item can carry an id.
  // The dedup by item id upstream is what makes descending safe.
  for (const value of Object.values(record)) walk(value, depth + 1, visit)
}

/**
 * The structural predicate. Strict on purpose — see the header.
 *
 * `id` must be a string of digits: TikTok video ids are 19-digit snowflakes, and
 * requiring digits is what keeps hashtag objects (`id: "food"`) and music objects
 * (whose ids *are* numeric, hence the second condition) out.
 *
 * `desc` must be a string and must be *present*. A music track has `title`, not
 * `desc`. An empty caption is a real thing, so `""` is accepted — the check is
 * `typeof`, not truthiness, and that distinction is the whole reason this is not
 * a one-liner.
 */
function looksLikeItem(record: Record<string, unknown>): boolean {
  const id = record.id
  if (typeof id !== "string" || id.length === 0 || !/^\d+$/.test(id)) return false
  if (typeof record.desc !== "string") return false
  return isRecord(record.author) || isRecord(record.stats) || isRecord(record.statsV2)
}

function toDraft(record: Record<string, unknown>): { id: string; item: ItemDraft } | null {
  const id = record.id as string
  const author = isRecord(record.author) ? record.author : null
  const handle =
    (author && typeof author.uniqueId === "string" && author.uniqueId) ||
    (author && typeof author.unique_id === "string" && author.unique_id) ||
    null
  const desc = typeof record.desc === "string" ? record.desc : ""

  return {
    id,
    item: {
      // Built from the handle and the id, never read off the page. TikTok's own
      // anchors carry per-session tracking parameters, and a URL that differs
      // between two captures of the same video cannot be used to tell they are the
      // same video — which is precisely what the overlap measurement does.
      //
      // Without a handle the canonical `/@user/video/:id` form is unavailable;
      // `/video/:id` redirects to it and is stable, so an item with an unreadable
      // author is still a usable row rather than a dropped one.
      url: handle
        ? `https://www.tiktok.com/@${handle}/video/${id}`
        : `https://www.tiktok.com/video/${id}`,
      // A TikTok video has no title. The caption is the whole text, so promoting it
      // to `title` as well would store the same string twice and make `title` mean
      // something different here than in every other adapter.
      title: null,
      text: desc,
      languageGuess: readLanguage(record) ?? guessLanguage(desc),
      mediaRefs: readMedia(record),
      engagement: readEngagement(record),
    },
  }
}

/**
 * TikTok sometimes states the language outright, which beats guessing from script
 * — particularly for Vietnamese, where a caption of pure emoji and hashtags has no
 * diacritics for the detector to find.
 *
 * Trusted over the script guess, and only over it: this is still
 * `languageGuess`, still documented as not authoritative, and the source's own
 * claim is wrong often enough (every account that posts in one language with its
 * app set to another) that nothing downstream should treat it as settled.
 */
function readLanguage(record: Record<string, unknown>): string | null {
  const claimed = record.textLanguage ?? record.desc_language ?? record.language
  if (typeof claimed !== "string" || claimed.length === 0) return null
  return (claimed.split("-")[0] ?? claimed).toLowerCase()
}

function readMedia(record: Record<string, unknown>): readonly string[] {
  const urls: string[] = []
  const video = isRecord(record.video) ? record.video : null
  if (video) {
    for (const key of ["cover", "originCover", "dynamicCover"]) {
      const value = video[key]
      if (typeof value === "string" && value.length > 0) urls.push(value)
    }
  }
  return urls
}

/**
 * All three fields, when the source gives them — unlike YouTube search, TikTok
 * returns likes and comments alongside plays.
 *
 * Two shapes to read. The API returns numbers (`playCount: 41238`); the rendered
 * state sometimes carries `statsV2`, whose values are **strings** and may be
 * abbreviated. `parseCount` handles the second, which is why it lives one folder
 * up rather than inside `youtube/` where it started.
 *
 * A missing field stays `null`. `Engagement`'s three fields are independently
 * nullable precisely so that "TikTok told us the plays but not the likes" is
 * expressible without inventing a zero that would rank this video below a video
 * with one like.
 */
function readEngagement(record: Record<string, unknown>): Engagement | null {
  const stats = isRecord(record.stats) ? record.stats : null
  const v2 = isRecord(record.statsV2) ? record.statsV2 : null
  if (!stats && !v2) return null

  const read = (...keys: string[]): number | null => {
    for (const source of [stats, v2]) {
      if (!source) continue
      for (const key of keys) {
        const value = source[key]
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          return Math.round(value)
        }
        if (typeof value === "string") {
          const parsed = parseCount(value)
          if (parsed !== null) return parsed
        }
      }
    }
    return null
  }

  const views = read("playCount", "play_count")
  const likes = read("diggCount", "digg_count")
  const comments = read("commentCount", "comment_count")
  if (views === null && likes === null && comments === null) return null
  return { views, likes, comments }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
