import type { Engagement } from "@samsara/core"
import type { Capture, ItemDraft } from "../adapter.js"
import { parseCount } from "./counts.js"
import type { YouTubePayload } from "./types.js"

/**
 * Turning a captured YouTube response into drafts. Pure, synchronous, free.
 *
 * **It searches the tree rather than walking a path.** The obvious implementation
 * is `contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer
 * .contents[0].itemSectionRenderer.contents`, and that expression is correct
 * roughly until the next time YouTube inserts a shelf, a chip bar, an ad slot or a
 * "people also watched" row — each of which changes the path without changing a
 * single renderer. The renderer *names* are the stable part of that response; the
 * containers around them are not. So this walks the whole payload and collects
 * every object that looks like a video, in the order it is encountered.
 *
 * Encounter order is document order, which is rank order. That matters more than
 * it looks: the entire P1.0 result is a set-overlap measurement over ranked lists,
 * and a parser that returned results in, say, map-iteration order would quietly
 * destroy the ordering that every downstream comparison depends on.
 *
 * Deduplicated by video id, first occurrence winning. A search page shows the same
 * video in a shelf and again in the main list often enough that not doing this
 * would inflate every count by a shelf.
 */

/**
 * The renderer names that carry a video. Names, not paths — see above.
 *
 * `reelItemRenderer` is Shorts. Included deliberately: a Shorts result is a real
 * result that a real person saw at that rank, and dropping it here would make the
 * harvest disagree with the page it harvested.
 */
const VIDEO_RENDERERS = [
  "videoRenderer",
  "gridVideoRenderer",
  "compactVideoRenderer",
  "playlistVideoRenderer",
  "reelItemRenderer",
] as const

/** Depth limit. A malformed payload with a cycle would otherwise hang the runner. */
const MAX_DEPTH = 40

export function parseYouTube(capture: Capture<YouTubePayload>): readonly ItemDraft[] {
  const seen = new Set<string>()
  const drafts: ItemDraft[] = []

  walk(capture.payload.initialData, 0, (renderer) => {
    const draft = toDraft(renderer)
    if (!draft) return
    if (seen.has(draft.id)) return
    seen.add(draft.id)
    drafts.push(draft.item)
  })

  return drafts
}

/** Depth-first, in document order, calling back on every video-shaped object. */
function walk(node: unknown, depth: number, visit: (renderer: Record<string, unknown>) => void) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return

  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, depth + 1, visit)
    return
  }

  const record = node as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if ((VIDEO_RENDERERS as readonly string[]).includes(key) && isRecord(value)) {
      visit(value)
      // Still descend: a renderer can contain another one, and the point of
      // searching rather than pathing is not to assume where things sit.
    }
    walk(value, depth + 1, visit)
  }
}

function toDraft(renderer: Record<string, unknown>): { id: string; item: ItemDraft } | null {
  const id = typeof renderer.videoId === "string" ? renderer.videoId : null
  if (!id) return null

  const title = readText(renderer.title) ?? readText(renderer.headline)
  const snippet =
    readSnippet(renderer.detailedMetadataSnippets) ??
    readText(renderer.descriptionSnippet) ??
    readText(renderer.description)

  return {
    id,
    item: {
      // Built, not read off the page. YouTube's own hrefs carry per-session click
      // tracking, and a URL that differs between two captures of the same video is
      // a URL that cannot be used to tell they are the same video.
      url: `https://www.youtube.com/watch?v=${id}`,
      title,
      // `text` is not nullable, and an item whose only text is its title is still
      // an item worth keeping — a Short has no description at all. Falling back to
      // the title is more honest than storing an empty string that reads, wrongly,
      // as "this video has no words in it".
      text: snippet ?? title ?? "",
      languageGuess: guessLanguage(`${title ?? ""} ${snippet ?? ""}`),
      mediaRefs: readThumbnails(renderer.thumbnail),
      engagement: readEngagement(renderer),
    },
  }
}

/** `{ simpleText }` and `{ runs: [{ text }] }` are both ways YouTube says "a string". */
function readText(node: unknown): string | null {
  if (!isRecord(node)) return null
  if (typeof node.simpleText === "string") return node.simpleText || null
  if (Array.isArray(node.runs)) {
    const text = node.runs
      .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
      .join("")
    return text || null
  }
  return null
}

function readSnippet(node: unknown): string | null {
  if (!Array.isArray(node)) return null
  const parts: string[] = []
  for (const entry of node) {
    if (!isRecord(entry)) continue
    const text = readText(entry.snippetText)
    if (text) parts.push(text)
  }
  return parts.length > 0 ? parts.join(" ") : null
}

function readThumbnails(node: unknown): readonly string[] {
  if (!isRecord(node) || !Array.isArray(node.thumbnails)) return []
  const urls: string[] = []
  for (const thumb of node.thumbnails) {
    if (isRecord(thumb) && typeof thumb.url === "string") urls.push(thumb.url)
  }
  return urls
}

/**
 * Views only. Search results carry no like or comment count, and `null` is the
 * field's way of saying so — inventing a zero would make an unmeasured video
 * indistinguishable from an unpopular one, which is exactly the distinction
 * anything ranking on engagement needs.
 */
function readEngagement(renderer: Record<string, unknown>): Engagement | null {
  const views =
    parseCount(readText(renderer.viewCountText)) ??
    parseCount(readText(renderer.shortViewCountText))
  if (views === null) return null
  return { views, likes: null, comments: null }
}

/**
 * A script detector, not a language detector, and the field it fills says
 * explicitly that it is not authoritative.
 *
 * Thai script means Thai; nothing else is written in it. Vietnamese is Latin, so
 * it is identified by the diacritics no other Latin-script language stacks the
 * same way (`ệ`, `ượ`, `ỗ`) — present in almost any real Vietnamese sentence and
 * in essentially no English one. Everything else returns null rather than
 * defaulting to `"en"`, because "probably English" is a claim, and the refinement
 * stage downstream can make a better one with a real model.
 */
function guessLanguage(text: string): string | null {
  if (/[฀-๿]/.test(text)) return "th"
  if (/[Ạ-ỹăâêôơưđĂÂÊÔƠƯĐ]/.test(text)) return "vi"
  if (/[぀-ヿ]/.test(text)) return "ja"
  if (/[가-힯]/.test(text)) return "ko"
  if (/[一-鿿]/.test(text)) return "zh"
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
