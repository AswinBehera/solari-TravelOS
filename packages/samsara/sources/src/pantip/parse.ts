import type { Engagement } from "@samsara/core"
import type { Capture, ItemDraft } from "../adapter.js"
import { parseCount } from "../counts.js"
import { guessLanguage } from "../language.js"
import type { PantipPayload, PantipPostNode, PantipTopicNode } from "./types.js"

/**
 * Turning a captured Pantip page into drafts. Pure, synchronous, free.
 *
 * **Identity is the topic number.** `/topic/43210987` is what Pantip keys a thread
 * by, it survives every listing the thread appears in, and a listing link carries
 * tracking parameters that differ between two rows pointing at the same thread. P1.8
 * measures URL overlap between two personas; a URL that differs per row would have
 * reported no overlap and read like a finding, which is the mistake the Maps adapter
 * was built to avoid and this one inherits rather than rediscovers.
 *
 * **A reply's identity is the topic plus whatever Pantip anchored it with.** A reply
 * with neither is dropped: without an id its URL would be the topic's, and it would
 * collide with every other reply under it.
 *
 * **The counts are read here and nowhere else.** `2.5 หมื่น` is twenty-five thousand,
 * `หมื่น` being ten thousand rather than a thousand — Thai counts in powers of ten
 * thousand, which is why `counts.ts` exists and why nothing in `inpage.ts` is allowed
 * to do this. Getting it wrong here costs a re-parse; getting it wrong there costs a
 * browser session.
 */

/** `/topic/<digits>` anywhere in an address, absolute or relative. */
export const TOPIC_ID = /\/topic\/(\d+)/

export function parsePantip(capture: Capture<PantipPayload>): readonly ItemDraft[] {
  const payload = capture.payload
  const drafts: ItemDraft[] = []
  const seen = new Set<string>()

  /**
   * Posts first, and the order is not cosmetic.
   *
   * The opening post and a listing row that points at the same thread produce the
   * same URL, because that URL is the thread's identity — and on a topic page such
   * a row is easy to come by: the page links itself, and a "related" rail links it
   * again. The two drafts are not equally good. The opening post carries the
   * writing and the images; the row carries a title and a one-line excerpt. First
   * one wins the id, so the one with the evidence in it goes first.
   *
   * On a listing surface there are no posts and this changes nothing.
   */
  const topicUrl = canonicalTopicUrl(capture.url)
  for (const post of payload.posts) {
    const draft = postDraft(post, topicUrl, payload.pageTitle)
    if (draft === null || seen.has(draft.url)) continue
    seen.add(draft.url)
    drafts.push(draft)
  }

  for (const topic of payload.topics) {
    const draft = topicDraft(topic)
    if (draft === null || seen.has(draft.url)) continue
    seen.add(draft.url)
    drafts.push(draft)
  }

  return drafts
}

/**
 * A listing row.
 *
 * The excerpt is the text, and it is usually a sentence rather than a thread. That
 * is honest: a listing is a listing. The reason the row is worth storing at all is
 * that it carries counts the topic page does not show as plainly, and that its URL
 * is the input `pantip.topic` takes.
 */
function topicDraft(topic: PantipTopicNode): ItemDraft | null {
  const url = canonicalTopicUrl(topic.href ?? "")
  if (url === null) return null
  const text = topic.excerpt ?? ""
  return {
    url,
    title: topic.title,
    text,
    // The title is the longer and more reliable sample on a listing row, and an
    // excerpt is sometimes absent entirely.
    languageGuess: guessLanguage(text.length > 0 ? text : (topic.title ?? "")),
    mediaRefs: [],
    engagement: listingEngagement(topic),
  }
}

/**
 * The opening post, or one reply.
 *
 * The opening post takes the topic's own URL and the page title; a reply takes an
 * anchor under it and no title, because a reply has no headline and putting the
 * thread's title on every reply would make forty copies of one claim.
 */
function postDraft(
  post: PantipPostNode,
  topicUrl: string | null,
  pageTitle: string,
): ItemDraft | null {
  if (topicUrl === null) return null
  const isOpening = post.role === "opening"
  if (!isOpening && (post.postId === null || post.postId.length === 0)) return null
  const url = isOpening ? topicUrl : `${topicUrl}#${post.postId}`
  const text = post.text ?? ""
  return {
    url,
    title: isOpening ? threadTitle(pageTitle) : null,
    text,
    languageGuess: guessLanguage(text),
    mediaRefs: post.mediaRefs,
    engagement: postEngagement(post),
  }
}

/**
 * `https://pantip.com/topic/<id>` — built, never copied off the page.
 *
 * Returns `null` rather than falling back to the raw address. Maps has a fallback
 * because a Maps link without a feature id is still a link to something; a Pantip
 * link without a topic number is not a topic at all, and storing it would put the
 * board's own pagination into the evidence.
 */
export function canonicalTopicUrl(raw: string): string | null {
  const match = TOPIC_ID.exec(raw)
  const id = match?.[1]
  if (id === undefined) return null
  return `https://pantip.com/topic/${id}`
}

/**
 * A tab title minus the site's own name.
 *
 * Same rule, and the same restraint, as the Maps title: strip a trailing separator
 * plus the site name, keep the whole thing when the pattern does not match, and
 * treat a title that is only the site name as no title at all. A title with a stray
 * suffix is a smaller error than one truncated by a rule that guessed.
 */
function threadTitle(pageTitle: string): string | null {
  const full = pageTitle.trim()
  if (full.length === 0) return null
  const stripped = full.replace(/\s*[-|–—]\s*Pantip[^-|–—]*$/iu, "").trim()
  if (stripped.length === 0) return null
  if (stripped === full && /^Pantip\b/iu.test(full)) return null
  return stripped
}

/**
 * Three independently nullable numbers, and the nulls are the point.
 *
 * A row that shows no view count has not told us it has no views. Zero and unknown
 * are different claims, and P1.8 reads these as evidence about what a viewpoint was
 * shown.
 */
function listingEngagement(topic: PantipTopicNode): Engagement | null {
  const views = parseCount(topic.viewLabel)
  const likes = parseCount(topic.voteLabel)
  const comments = parseCount(topic.commentLabel)
  if (views === null && likes === null && comments === null) return null
  return { views, likes, comments }
}

function postEngagement(post: PantipPostNode): Engagement | null {
  const likes = parseCount(post.voteLabel)
  if (likes === null) return null
  return { views: null, likes, comments: null }
}
