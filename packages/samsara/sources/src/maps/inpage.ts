/// <reference lib="dom" />

/**
 * The four functions in this folder that run inside the browser.
 *
 * File-scoped `dom` lib, for the reason `youtube/inpage.ts` gives at length: the
 * body of a `page.evaluate` is genuinely DOM code, but `@samsara/sources` may have
 * to compile against the Workers runtime, and a package-wide `"lib": ["DOM"]` would
 * let every other file here reach for `document` and still typecheck.
 *
 * **They close over nothing and declare no function of their own.** Playwright
 * serialises the source; an import used inside typechecks here and throws
 * `x is not defined` in the page, on a clock that is already billing. Worse, the
 * bundler rewrites a named inner function as `__name(fn, "…")` with `__name` at
 * module scope, so even a helper declared *inside* the evaluated function does not
 * survive. Two billed TikTok sessions established that, in that order. Everything
 * below is written with `for` loops and no callbacks because of it, and
 * `inpage.test.ts` asserts the shape rather than trusting this paragraph.
 *
 * The `import type` is safe: type-only imports are erased before the source ever
 * reaches `toString`.
 *
 * **What these may and may not do.** They select nodes and copy strings. They do
 * not interpret them — no number parsing, no date arithmetic, no language guess, no
 * stripping of localised words. That line is the whole of what remains of the
 * capture/parse split for a DOM-read source, and it is worth keeping precisely
 * because it is all that is left: changing our mind about what a rating is must not
 * cost a browser session. Whitespace is trimmed, which is not interpretation.
 */

import type { MapsEntityNode, MapsReviewNode } from "./types.js"

export interface MapsPageRead {
  reviews: MapsReviewNode[]
  entities: MapsEntityNode[]
  state: string | null
  stateLength: number | null
  stateKeys: string[]
  tabLabels: string[]
  nodeCounts: Record<string, number>
  /** What kind of wall, not merely that there is one. See `capture.ts`. */
  wall: "consent" | "captcha" | null
  title: string
  href: string
}

/**
 * Read everything, on both surfaces, regardless of which one we think we are on.
 *
 * Reading result cards on a reviews capture costs nothing and buys a diagnosis: a
 * reviews capture that came back holding fourteen result cards and no reviews never
 * left the search page, and that is a different bug from an entity with no reviews.
 */
export function readMapsPage(): MapsPageRead {
  const globals = window as unknown as Record<string, unknown>

  // The blob, as a string, truncated. Nothing parses it today; it is stored because
  // re-reading a capture is free and re-opening a session is not. 200k characters is
  // roughly a fifth of a megabyte of JSON, which is the most this can contribute to
  // a file a person is expected to read before committing it.
  const stateKeys: string[] = []
  let state: string | null = null
  let stateLength: number | null = null
  for (const name of ["APP_INITIALIZATION_STATE", "APP_OPTIONS", "_pageData"]) {
    const value = globals[name]
    if (value === undefined || value === null) continue
    stateKeys.push(name)
    if (state !== null) continue
    if (value instanceof Node) continue
    let text = ""
    try {
      text = JSON.stringify(value) ?? ""
    } catch {
      text = ""
    }
    if (text.length === 0) continue
    stateLength = text.length
    state = text.slice(0, 200000)
  }

  const tabLabels: string[] = []
  for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
    const label = tab.getAttribute("aria-label") ?? tab.textContent ?? ""
    tabLabels.push(label.trim())
  }

  const nodeCounts: Record<string, number> = {}

  /**
   * The selector guesses, as data.
   *
   * Maps' class names are obfuscated and change; its `data-` and `aria-` attributes
   * are an accessibility contract and do not. The lists are ordered
   * most-durable-first, every hit is counted into `nodeCounts`, and correcting one
   * after a real capture is a one-line edit rather than a rewrite.
   */
  const reviewPlan: Array<[string, string[], string]> = [
    ["authorName", ['a[href*="/contrib/"] + div', ".d4r55", '[class*="d4r55"]'], "text"],
    ["authorHref", ['a[href*="/contrib/"]'], "href"],
    ["authorMeta", [".RfnDt", '[class*="RfnDt"]'], "text"],
    ["ratingLabel", ['span[role="img"][aria-label]', "[aria-label][role='img']"], "aria"],
    ["relativeTime", [".rsqaWe", ".xRkPPb", '[class*="rsqaWe"]'], "text"],
    // `span.wiI7pd` before `.MyEned`, and the order is not cosmetic: the "more"
    // control lives *inside* `.MyEned`, so reading the wrapper's `textContent`
    // appends the localised word "More" to the end of every truncated review. The
    // inner span is the sentence; the wrapper is the sentence plus a button.
    ["text", ["span.wiI7pd", '[class*="wiI7pd"]', ".MyEned"], "text"],
    ["helpfulLabel", ['button[jsaction*="helpful"]', "button[aria-label*='Helpful']"], "aria"],
    ["ownerReply", ['[jsaction*="ownerResponse"]', ".CDe7pd", '[class*="CDe7pd"]'], "text"],
  ]

  const reviews: MapsReviewNode[] = []
  const seenReviews: Record<string, boolean> = {}
  const reviewNodes = Array.from(document.querySelectorAll("[data-review-id]"))
  nodeCounts["[data-review-id]"] = reviewNodes.length
  for (const node of reviewNodes) {
    const reviewId = node.getAttribute("data-review-id") ?? ""
    if (reviewId.length === 0) continue
    // Buttons *inside* a review carry the same id as the container around them.
    // `querySelectorAll` is in document order and an ancestor precedes its
    // descendants, so the first node seen for an id is the outer one.
    if (seenReviews[reviewId]) continue
    seenReviews[reviewId] = true

    const fields: Record<string, string | null> = {}
    for (const [name, selectors, kind] of reviewPlan) {
      fields[name] = null
      for (const selector of selectors) {
        const found = node.querySelector(selector)
        if (found === null) continue
        let value: string | null = null
        if (kind === "aria") value = found.getAttribute("aria-label")
        else if (kind === "href") value = found.getAttribute("href")
        else value = found.textContent
        if (value === null) continue
        value = value.trim()
        if (value.length === 0) continue
        fields[name] = value
        nodeCounts[selector] = (nodeCounts[selector] ?? 0) + 1
        break
      }
    }

    const photoRefs: string[] = []
    for (const image of Array.from(node.querySelectorAll("img"))) {
      // The contributor's avatar is a picture of a person and not evidence about
      // anything. It is the one image inside the author's own link.
      if (image.closest('a[href*="/contrib/"]') !== null) continue
      const src = image.getAttribute("src") ?? ""
      if (src.length > 0) photoRefs.push(src)
    }
    for (const painted of Array.from(node.querySelectorAll('[style*="background-image"]'))) {
      const style = painted.getAttribute("style") ?? ""
      if (style.length > 0) photoRefs.push(style)
    }

    reviews.push({
      reviewId,
      authorName: fields.authorName ?? null,
      authorHref: fields.authorHref ?? null,
      authorMeta: fields.authorMeta ?? null,
      ratingLabel: fields.ratingLabel ?? null,
      relativeTime: fields.relativeTime ?? null,
      text: fields.text ?? null,
      photoRefs,
      helpfulLabel: fields.helpfulLabel ?? null,
      ownerReply: fields.ownerReply ?? null,
    })
  }

  const entities: MapsEntityNode[] = []
  const seenHrefs: Record<string, boolean> = {}
  let anchors = 0
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? ""
    if (!href.includes("/maps/")) continue
    // `!1s` is the feature id Google keys an entity by; `/@` is the viewport it
    // writes into a result link. One or the other is present on a result card and
    // on nothing else in the chrome around it.
    if (!href.includes("!1s") && !href.includes("/@")) continue
    if (seenHrefs[href]) continue
    seenHrefs[href] = true
    anchors += 1

    const card = anchor.parentElement ?? anchor
    let ratingLabel: string | null = null
    const rating = card.querySelector('span[role="img"][aria-label]')
    if (rating !== null) ratingLabel = rating.getAttribute("aria-label")

    let reviewCountLabel: string | null = null
    for (const selector of ['span[aria-label][class*="UY7F9"]', "span + span[aria-label]"]) {
      const found = card.querySelector(selector)
      if (found === null) continue
      const label = found.getAttribute("aria-label")
      if (label === null || label.trim().length === 0) continue
      reviewCountLabel = label.trim()
      nodeCounts[selector] = (nodeCounts[selector] ?? 0) + 1
      break
    }

    const detailLines: string[] = []
    for (const line of Array.from(card.querySelectorAll('[class*="W4Efsd"]'))) {
      const text = (line.textContent ?? "").trim()
      if (text.length > 0) detailLines.push(text)
    }

    entities.push({
      href,
      name: anchor.getAttribute("aria-label"),
      ratingLabel,
      reviewCountLabel,
      detailLines,
    })
  }
  nodeCounts["a[href*=/maps/]"] = anchors

  const text = document.body?.innerText?.slice(0, 4000) ?? ""
  const consent =
    location.href.includes("consent.google.") ||
    document.querySelector('form[action*="consent"]') !== null
  const captcha =
    location.pathname.includes("/sorry/") || document.querySelector("#captcha-form") !== null
  // `text` is read last and used for nothing but the shape of a wall we did not
  // recognise structurally; it is deliberately not matched against words.
  const wall = captcha ? "captcha" : consent ? "consent" : null

  return {
    reviews,
    entities,
    state,
    stateLength,
    stateKeys,
    tabLabels,
    nodeCounts: { ...nodeCounts, bodyTextLength: text.length },
    wall,
    title: document.title,
    href: location.href,
  }
}

/**
 * Open a tab by **position**, because its label is localised.
 *
 * A list of the word "reviews" in eleven languages is a thing this package would
 * then own, would have to maintain, and would get wrong first in the languages this
 * project actually targets. The index is a guess; `tabLabels` in the payload is what
 * makes it a guess that costs one capture to correct rather than one session.
 */
export function clickMapsTab(index: number): number | null {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  const tab = tabs[index]
  if (tab === undefined) return null
  ;(tab as HTMLElement).click()
  return index
}

/**
 * Scroll the results pane to its end. Returns the height reached, so the caller can
 * stop when it stops growing rather than scrolling a fixed number of times.
 */
export function scrollMapsPane(): number {
  const pane = document.querySelector('div[role="feed"], div[role="main"] div[tabindex="-1"]')
  if (pane === null) {
    window.scrollTo(0, document.body.scrollHeight)
    return document.body.scrollHeight
  }
  pane.scrollTop = pane.scrollHeight
  return pane.scrollHeight
}

/**
 * Click every "more" control on a review.
 *
 * Matched on `jsaction` rather than on the button's label for the same reason the
 * tab is matched by position: the label is localised and the action name is not.
 * A truncated review is a truncated harvest, and the truncation is the half of the
 * sentence with the opinion in it.
 */
export function expandMapsReviews(): number {
  let clicked = 0
  for (const button of Array.from(
    document.querySelectorAll(
      'button[jsaction*="expandReview"], button[jsaction*="review.expand"]',
    ),
  )) {
    ;(button as HTMLElement).click()
    clicked += 1
  }
  return clicked
}
