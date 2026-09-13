/// <reference lib="dom" />

/**
 * The two functions in this folder that run inside the browser.
 *
 * File-scoped `dom` lib, and the same serialisation contract every other adapter
 * here is written under: **they close over nothing and declare no function of their
 * own.** Playwright serialises the source, the bundler rewrites a named inner
 * function as `__name(fn, "…")` with `__name` at module scope, and the failure
 * arrives as `__name is not defined` on a clock that is already billing. Hence the
 * `for` loops and the absence of callbacks. `inpage.test.ts` asserts that shape
 * rather than trusting this paragraph.
 *
 * **They select and copy strings; they do not interpret them.** No number parsing,
 * no date arithmetic, no language guess, no stripping of localised words. On a
 * source read from the DOM that line is all that is left of the capture/parse
 * split, and it is what keeps "we were wrong about what a vote label means" a
 * parser edit rather than a browser session.
 *
 * **They also click nothing.** Pantip pages a long topic behind a control this file
 * has never seen, and a selector loose enough to find it — a button that mentions
 * comments and mentions "more" — is loose enough to find something else and press
 * it. The candidate is counted into `nodeCounts` instead, so the next capture says
 * what the control is actually called and the guess after that is not a guess.
 */

import type { PantipPostNode, PantipTopicNode } from "./types.js"

export interface PantipReadLimits {
  /** How many item fragments to keep. */
  maxFragments: number
  /** How much of each one. */
  fragmentChars: number
}

export interface PantipPageRead {
  topics: PantipTopicNode[]
  posts: PantipPostNode[]
  state: string | null
  stateLength: number | null
  stateKeys: string[]
  stateCandidates: string[]
  nodeCounts: Record<string, number>
  fragmentsStored: number
  /** What kind of wall, not merely that there is one. See `capture.ts`. */
  wall: "captcha" | "login" | null
  title: string
  href: string
}

/**
 * Read everything, on every surface, regardless of which one we think we are on.
 *
 * A listing read on a topic page costs nothing and buys a diagnosis: a topic
 * capture that came back holding thirty listing rows and no posts never left the
 * board, which is a different bug from a topic that would not load.
 */
export function readPantipPage(limits: PantipReadLimits): PantipPageRead {
  const globals = window as unknown as Record<string, unknown>

  const stateKeys: string[] = []
  let state: string | null = null
  let stateLength: number | null = null
  for (const name of ["__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "PANTIP"]) {
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
  // Next.js writes its payload into a script tag rather than a global on some
  // builds. Reading the tag's text is a copy, not an interpretation.
  if (state === null) {
    const tag = document.querySelector("script#__NEXT_DATA__")
    const text = tag === null ? "" : (tag.textContent ?? "")
    if (text.length > 0) {
      stateKeys.push("script#__NEXT_DATA__")
      stateLength = text.length
      state = text.slice(0, 200000)
    }
  }

  /**
   * What the blob is *actually* called, when none of the names above is it. Names
   * only — never values — sorted so two captures compare, and capped so a page with
   * a thousand globals cannot turn a diagnostic into the payload. P1.5 paid a
   * session to learn that a diagnostic reporting only which guesses were right stops
   * one question short of the useful one.
   */
  const stateCandidates: string[] = []
  for (const key of Object.keys(globals)) {
    if (stateCandidates.length >= 200) break
    if (/^(?:__|_page|PANTIP|APP_)/.test(key) || /^[A-Z][A-Z0-9_]{7,}$/.test(key)) {
      stateCandidates.push(key)
    }
  }
  stateCandidates.sort()
  stateCandidates.length = Math.min(stateCandidates.length, 40)

  const nodeCounts: Record<string, number> = {}
  let fragmentsStored = 0

  /**
   * Selector guesses, ordered most-durable-first.
   *
   * Pantip's classes are hand-written rather than compiler-generated, which is why
   * the plan calls this "plain HTML, good signal" — but hand-written classes are
   * still renamed by hand. Every hit is counted, so correcting one after a real
   * capture is a one-line edit rather than a rewrite.
   */
  const topicPlan: Array<[string, string[], string]> = [
    ["authorName", ['a[href*="/profile/"]', '[class*="owner"]', '[class*="author"]'], "text"],
    ["authorHref", ['a[href*="/profile/"]'], "href"],
    ["timeLabel", ["abbr[title]", "time[datetime]", '[class*="date"]', '[class*="time"]'], "text"],
    ["voteLabel", ['[class*="vote"]', '[class*="like"]', '[class*="point"]'], "count"],
    ["commentLabel", ['[class*="comment"]', '[class*="reply"]'], "count"],
    ["viewLabel", ['[class*="view"]', '[class*="read"]', '[class*="hit"]'], "count"],
    ["excerpt", ['[class*="detail"]', '[class*="excerpt"]', '[class*="desc"]', "p"], "text"],
  ]

  const topics: PantipTopicNode[] = []
  const seenHref: Record<string, boolean> = {}
  let topicAnchors = 0
  for (const anchor of Array.from(document.querySelectorAll('a[href*="/topic/"]'))) {
    const href = anchor.getAttribute("href") ?? ""
    if (href.length === 0) continue
    if (seenHref[href]) continue
    seenHref[href] = true
    topicAnchors += 1

    // The row, not the link. `closest` walks up to whatever wraps it, and the list
    // of tags is deliberately generic: an `li` on one build is a `div` on the next.
    const row = anchor.closest("li, article, tr, div[class]") ?? anchor

    const fields: Record<string, string> = {}
    for (const [field, selectors, how] of topicPlan) {
      let found = false
      for (const selector of selectors) {
        if (found) break
        // Every match for the selector, not merely the first. A selector that
        // matches on a substring of a class name matches `pt-view-count` and
        // `pt-preview` alike, and taking only the first match would let a decoy
        // earlier in the row cost the field entirely.
        for (const node of Array.from(row.querySelectorAll(selector))) {
          let value = ""
          if (how === "href") value = node.getAttribute("href") ?? ""
          else value = node.textContent ?? ""
          value = value.trim()
          if (value.length === 0) continue
          // A count label with no digit in it is not a count label. Requiring a
          // digit is a rule about which node to copy, not a reading of what the
          // copy means — the reading still happens in `parse.ts`.
          if (how === "count" && !/\d/.test(value)) continue
          fields[field] = value
          nodeCounts[selector] = (nodeCounts[selector] ?? 0) + 1
          found = true
          break
        }
      }
    }

    const tagLabels: string[] = []
    for (const tag of Array.from(row.querySelectorAll('a[href*="/tag/"]'))) {
      const label = (tag.textContent ?? "").trim()
      if (label.length > 0) tagLabels.push(label)
    }

    let fragment: string | null = null
    if (fragmentsStored < limits.maxFragments) {
      const clone = row.cloneNode(true) as Element
      for (const noisy of Array.from(clone.querySelectorAll("script, style, noscript, iframe"))) {
        noisy.remove()
      }
      fragment = clone.outerHTML.slice(0, limits.fragmentChars)
      fragmentsStored += 1
    }

    topics.push({
      href,
      title: (anchor.textContent ?? "").trim() || null,
      authorName: fields.authorName ?? null,
      authorHref: fields.authorHref ?? null,
      tagLabels,
      timeLabel: fields.timeLabel ?? null,
      voteLabel: fields.voteLabel ?? null,
      commentLabel: fields.commentLabel ?? null,
      viewLabel: fields.viewLabel ?? null,
      excerpt: fields.excerpt ?? null,
      fragment,
    })
  }
  nodeCounts['a[href*="/topic/"]'] = topicAnchors

  const posts: PantipPostNode[] = []
  const openingSelectors = [
    '[class*="display-post-story"]',
    '[itemprop="articleBody"]',
    '[class*="post-story"]',
    "article",
  ]
  const replySelectors = [
    '[id^="comment-"]',
    "[data-cid]",
    '[class*="display-post-wrapper"]',
    '[class*="comment-item"]',
  ]

  const postNodes: Array<[Element, string]> = []
  for (const selector of openingSelectors) {
    const found = document.querySelector(selector)
    nodeCounts[selector] = found === null ? 0 : 1
    if (found !== null && postNodes.length === 0) postNodes.push([found, "opening"])
  }
  const seenReply: Record<string, boolean> = {}
  for (const selector of replySelectors) {
    const found = Array.from(document.querySelectorAll(selector))
    nodeCounts[selector] = found.length
    for (const node of found) {
      // Document order puts a container before anything nested inside it, so the
      // first selector to claim a node keeps it and a later, looser one does not
      // store the same reply twice under a different name.
      const key = node.getAttribute("id") ?? node.getAttribute("data-cid") ?? ""
      if (key.length > 0 && seenReply[key]) continue
      if (key.length > 0) seenReply[key] = true
      // Overlap in either direction is one post, not two. A later, looser selector
      // can match a box *around* something already claimed just as easily as a box
      // inside it — the opening post's wrapper is literally called
      // `display-post-wrapper`, which is also how a reply is named.
      let nested = false
      for (const [already] of postNodes) {
        if (already === node) continue
        if (already.contains(node) || node.contains(already)) nested = true
      }
      if (nested) continue
      postNodes.push([node, "reply"])
    }
  }

  const postPlan: Array<[string, string[], string]> = [
    ["authorName", ['a[href*="/profile/"]', '[class*="owner"]', '[class*="author"]'], "text"],
    ["authorHref", ['a[href*="/profile/"]'], "href"],
    ["timeLabel", ["abbr[title]", "time[datetime]", '[class*="date"]', '[class*="time"]'], "text"],
    ["voteLabel", ['[class*="vote"]', '[class*="like"]', '[class*="point"]'], "count"],
    ["text", ['[class*="story"]', '[class*="message"]', '[class*="detail"]'], "text"],
  ]

  for (const [node, role] of postNodes) {
    /**
     * The box around the post, not the body of it — for the opening post only.
     *
     * `[class*="display-post-story"]` finds the writing, and on this page the
     * byline sits *beside* the writing rather than inside it, so every field but
     * `text` would come back null and the stored fragment would not contain the
     * answer either. That last part is what makes it worth the four lines: the
     * fragment exists so a wrong selector costs a re-parse instead of a session,
     * and a fragment cropped to the body cannot repay that. Widened one step from
     * the parent and only across Pantip's own `display-post` wrappers, because
     * widening to `main` would make one post's text the whole page's.
     */
    let scope = node
    if (role === "opening" && node.parentElement !== null) {
      const wrapper = node.parentElement.closest('[class*="display-post"], article')
      if (wrapper !== null) scope = wrapper
    }

    const fields: Record<string, string> = {}
    for (const [field, selectors, how] of postPlan) {
      let found = false
      for (const selector of selectors) {
        if (found) break
        for (const inner of Array.from(scope.querySelectorAll(selector))) {
          let value = ""
          if (how === "href") value = inner.getAttribute("href") ?? ""
          else value = inner.textContent ?? ""
          value = value.trim()
          if (value.length === 0) continue
          if (how === "count" && !/\d/.test(value)) continue
          fields[field] = value
          nodeCounts[`post ${selector}`] = (nodeCounts[`post ${selector}`] ?? 0) + 1
          found = true
          break
        }
      }
    }
    // The node's own text when no inner selector claimed it. A post whose body we
    // could not locate precisely is still worth more than a null.
    if (fields.text === undefined) {
      const own = (scope.textContent ?? "").trim()
      if (own.length > 0) fields.text = own
    }

    const mediaRefs: string[] = []
    for (const image of Array.from(scope.querySelectorAll("img"))) {
      // The author's avatar is a picture of a person, not evidence about anything.
      if (image.closest('a[href*="/profile/"]') !== null) continue
      const src = image.getAttribute("src") ?? ""
      if (src.length > 0) mediaRefs.push(src)
    }

    let fragment: string | null = null
    if (fragmentsStored < limits.maxFragments) {
      const clone = scope.cloneNode(true) as Element
      for (const noisy of Array.from(clone.querySelectorAll("script, style, noscript, iframe"))) {
        noisy.remove()
      }
      fragment = clone.outerHTML.slice(0, limits.fragmentChars)
      fragmentsStored += 1
    }

    posts.push({
      role: role === "opening" ? "opening" : "reply",
      postId: scope.getAttribute("id") ?? scope.getAttribute("data-cid"),
      authorName: fields.authorName ?? null,
      authorHref: fields.authorHref ?? null,
      timeLabel: fields.timeLabel ?? null,
      text: fields.text ?? null,
      mediaRefs,
      voteLabel: fields.voteLabel ?? null,
      fragment,
    })
  }

  // Counted, never clicked. See the header.
  nodeCounts["pager candidate"] = document.querySelectorAll(
    '[class*="comment"] button, [class*="comment"] [class*="more"], button[class*="more"]',
  ).length

  const captcha =
    document.querySelector("#challenge-form, #cf-wrapper, [id*='captcha']") !== null ||
    location.pathname.includes("/cdn-cgi/")
  const login = document.querySelector('form input[type="password"]') !== null
  const wall = captcha ? "captcha" : login ? "login" : null

  return {
    topics,
    posts,
    state,
    stateLength,
    stateKeys,
    stateCandidates,
    nodeCounts,
    fragmentsStored,
    wall,
    title: document.title,
    href: location.href,
  }
}

/** Scroll to the bottom and report the document height, so the caller can stop. */
export function scrollPantipPage(): number {
  window.scrollTo(0, document.body.scrollHeight)
  return document.body.scrollHeight
}
