import type { Engagement } from "@samsara/core"
import type { Capture, ItemDraft } from "../adapter.js"
import { parseCount } from "../counts.js"
import { guessLanguage } from "../language.js"
import type { MapsEntityNode, MapsPayload, MapsReviewNode } from "./types.js"

/**
 * Turning a captured Maps page into drafts. Pure, synchronous, free.
 *
 * This parser does less than the other two, because `inpage.ts` was forced to do
 * more: there is no DOM in here, so the fields arrived already separated. What is
 * left is exactly the part that was worth keeping on this side — every judgement.
 * Reading "5 ดาว จาก 5" as a rating, "(231)" as an integer, a `style` attribute as
 * an image reference, a hex pair as an identity: all of it can be got wrong, and
 * getting it wrong here costs nothing.
 *
 * **Identity is the feature id, not the URL Google hands you.**
 *
 * A Maps entity URL carries a viewport and a session-shaped `data=` segment, so two
 * captures of the same entity from two personas produce two different URLs. P1.8's
 * entire measurement is URL overlap between two personas, so that would not have
 * failed loudly — it would have reported zero overlap and looked like a finding.
 *
 * The hex pair `0x…:0x…` inside the address is what Maps actually keys an entity
 * by. It is identical across viewpoints, it is extractable with a regex *without
 * understanding the blob it sits in* — which matters on a surface where nothing
 * else can be read positionally — and its second half converts to the canonical
 * `maps.google.com/?cid=` link with one `BigInt`. So the draft's URL is built, never
 * read off the page, for the same reason the TikTok parser builds its own.
 *
 * **The star rating is deliberately not carried, and that is the one real loss.**
 * `ItemDraft` has no numeric field for it and neither does `RawItem`, so carrying it
 * would mean widening an engine schema — and a migration in `@samsara/db` — for a
 * column no named consumer wants: P2.2 takes sentiment from the text, P2.5's factors
 * are the evidence mix and a keyword list. The rating is in the archived capture
 * either way, and re-parsing an archived capture opens no browser. So the cost of
 * deferring is a migration later; the cost of not deferring is a migration now for
 * an unused column. If P2.5 turns out to want it, every capture ever taken can be
 * re-read for zero browser minutes, which is the entire point of the split.
 */

/**
 * `0x<cell>:0x<entity>`. The second half is the entity; the first is the map cell it
 * sits in and changes nothing about identity.
 */
export const FEATURE_ID = /0x[0-9a-f]+:0x([0-9a-f]+)/i

/** `url("https://…")` or `url(https://…)` inside a `style` attribute. */
const CSS_URL = /url\(\s*["']?(https?:\/\/[^"')]+)/i

export function parseMaps(capture: Capture<MapsPayload>): readonly ItemDraft[] {
  const payload = capture.payload
  const drafts: ItemDraft[] = []
  const seen = new Set<string>()

  // The entity every review on this capture belongs to. On the reviews surface the
  // capture's own URL is the entity; on the search surface each card carries its own.
  const entity = entityUrl(capture.url)

  for (const review of payload.reviews) {
    const draft = reviewDraft(review, entity)
    if (draft === null || seen.has(draft.url)) continue
    seen.add(draft.url)
    drafts.push(draft)
  }

  for (const node of payload.entities) {
    const draft = entityDraft(node)
    if (draft === null || seen.has(draft.url)) continue
    seen.add(draft.url)
    drafts.push(draft)
  }

  // A search Maps answered by resolving it. There are no cards to read, because the
  // page we ended on *is* the answer, and the only evidence of what it is is the
  // address and the title. One draft rather than zero — and, the part that matters, a
  // URL `maps.reviews` can be handed, which is what a search capture is for.
  if (payload.surface === "search" && payload.entities.length === 0 && entity !== null) {
    if (!seen.has(entity)) {
      drafts.push({
        url: entity,
        title: resolvedTitle(payload.pageTitle),
        text: "",
        languageGuess: guessLanguage(payload.pageTitle ?? ""),
        mediaRefs: [],
        engagement: null,
      })
    }
  }

  return drafts
}

/**
 * A tab title minus the product's own name.
 *
 * `ซ. พหลโยธิน 7 - Google Maps` is an entity and a suffix nobody asked for. Matched on
 * "Google" rather than on "Maps", because the product half is localised in most places
 * and the company half is not — and the whole title is kept when the pattern does not
 * match, since a title with a stray suffix is a smaller error than one truncated by a
 * rule that guessed.
 */
function resolvedTitle(pageTitle: string | null): string | null {
  if (pageTitle === null) return null
  const full = pageTitle.trim()
  const stripped = full.replace(/\s*[-\u2013\u2014]\s*Google[^-\u2013\u2014]*$/u, "").trim()
  if (stripped.length === 0) return null
  // Nothing was stripped and the title starts with the company's name: this is the
  // product's own title — `Google Maps`, `Google Карты` — on a page that never
  // named an entity. A null says that; "Google Maps" as an item's title does not.
  // An entity genuinely called `Google <something>` keeps its name, because its page
  // title carries the suffix too and the strip above will have fired.
  if (stripped === full && /^Google\b/u.test(full)) return null
  return stripped
}

/**
 * A review with no text is kept, with `text: ""`.
 *
 * It is tempting to drop it — a rating with no words is not the native-script
 * evidence this adapter exists to collect — and the reason not to is in
 * `adapter.ts`: the adapter "does not score, filter, rank, deduplicate, or decide
 * what is interesting". A rating-only review is a real thing a real person left, and
 * whether it is worth anything is a pack's opinion, formed downstream where it can
 * be changed without re-reading a page.
 *
 * A review with no id *is* dropped, because without one there is no identity, and an
 * item whose URL is just the entity's would collide with every other review on it.
 */
function reviewDraft(review: MapsReviewNode, entity: string | null): ItemDraft | null {
  if (review.reviewId === null || review.reviewId.length === 0) return null
  if (entity === null) return null

  const text = review.text ?? ""
  return {
    url: `${entity}#${review.reviewId}`,
    // A review has no title, exactly as a TikTok video has none. The rating label
    // would fit the field's shape and not its meaning, and a `title` that means the
    // byline here and the headline everywhere else is worse than a null.
    title: null,
    text,
    languageGuess: guessLanguage(text),
    mediaRefs: mediaRefs(review.photoRefs),
    engagement: reviewEngagement(review),
  }
}

function entityDraft(node: MapsEntityNode): ItemDraft | null {
  if (node.href === null) return null
  const url = entityUrl(node.href)
  if (url === null) return null

  // What the card actually says, in the order it says it: category, address, hours,
  // and whatever snippet Maps chose to show. Joined rather than dropped, because the
  // extract stage reads `text` and this is the only text a result card has.
  const text = node.detailLines.join(" · ")
  return {
    url,
    title: node.name,
    text,
    languageGuess: guessLanguage(text),
    mediaRefs: [],
    engagement: entityEngagement(node),
  }
}

/**
 * `maps.google.com/?cid=<decimal>` — the canonical link, built from the feature id.
 *
 * Falls back to the address with its volatile parts removed, so an entity whose link
 * has no feature id in it is still a row rather than a dropped one. The fallback is
 * *not* stable across viewpoints and is documented as the weaker answer; it exists
 * because a URL that differs is still better evidence than no item at all.
 */
export function entityUrl(raw: string): string | null {
  const match = FEATURE_ID.exec(raw)
  const hex = match?.[1]
  if (hex !== undefined) {
    try {
      return `https://maps.google.com/?cid=${BigInt(`0x${hex}`).toString(10)}`
    } catch {
      // An unparseable hex run is not an identity. Fall through to the address.
    }
  }
  try {
    const url = new URL(raw, "https://www.google.com")
    return `${url.origin}${url.pathname.split("/data=")[0]}`
  } catch {
    return null
  }
}

/**
 * A review has no views and no comments. It has a "helpful" count, which is the one
 * thing other people did to it, so it goes in `likes`.
 *
 * The other two stay `null` rather than becoming zero, for the reason the schema
 * states outright: zero is not the same as unknown, and a review recorded as having
 * zero views would rank below anything that has any.
 */
function reviewEngagement(review: MapsReviewNode): Engagement | null {
  const likes = parseCount(review.helpfulLabel)
  if (likes === null) return null
  return { views: null, likes, comments: null }
}

/**
 * A result card's review count goes in `comments`, which is the least wrong of the
 * three slots: it is how many things people wrote about this entity. It is not a
 * perfect fit and the alternative was inventing a field on a shared schema for one
 * adapter's surface — see the header on the star rating, which is the same argument
 * with the opposite answer, because that one had no slot at all.
 */
function entityEngagement(node: MapsEntityNode): Engagement | null {
  const comments = parseCount(node.reviewCountLabel)
  if (comments === null) return null
  return { views: null, likes: null, comments }
}

/**
 * An `img` `src` passes through; a `style` attribute is unwrapped. Anything that is
 * neither is dropped rather than stored — `mediaRefs` is documented as references
 * the caller may dereference, and a CSS declaration is not one.
 */
function mediaRefs(refs: readonly string[]): readonly string[] {
  const out: string[] = []
  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) {
      out.push(ref)
      continue
    }
    const found = CSS_URL.exec(ref)
    if (found?.[1]) out.push(found[1])
  }
  return out
}
