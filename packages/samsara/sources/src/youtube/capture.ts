import type { Capture, CaptureContext } from "../adapter.js"
import { type PageRead, readInitialData } from "./inpage.js"
import type { YouTubePayload } from "./types.js"

/**
 * The half that spends.
 *
 * **It reads `ytInitialData`, not the DOM.** YouTube embeds the JSON its own front
 * end renders from in a script tag in the initial document, which has two
 * consequences worth the whole file. First, the data is present at
 * `domcontentloaded` — there is no waiting for results to paint, and the lab's
 * signal-matrix surface pays a flat 3.5-second settle per cell that this adapter
 * does not. On a clock that bills by the minute, a settle is a line item. Second,
 * the JSON's renderer names change far more slowly than the markup around them,
 * so a parser written against it survives redesigns that would break a DOM scrape.
 *
 * What it stores is narrowed before it leaves this function. `@samsara/sources`'
 * fixture module says plainly why: a whole document served to a session this
 * project opened can carry a session id, and this repository is public. The
 * narrowing here is by *key name* — see `REDACTED_KEYS` — which is a deliberate
 * distinction. Stripping `clickTrackingParams` is redaction; navigating to
 * `contents.twoColumnSearchResultsRenderer` and storing only that would be
 * *parsing*, done in the expensive half, and would mean that every future change
 * to YouTube's layout required a new browser session instead of a new parser.
 * The split this package exists for would be gone, one helpful refactor at a time.
 */

/** The slice of Playwright's `Page` this adapter uses — and therefore the slice a fake must fake. */
export interface YouTubePage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  url(): string
  evaluate<R>(fn: () => R): Promise<R>
}

/**
 * Keys removed from the stored payload, wherever they appear.
 *
 * Every one of these is per-request or per-session state: click-tracking blobs,
 * the visitor identifier, experiment bucketing, opaque continuation tokens. None
 * of it is read by the parser, all of it would be in a public fixture, and
 * `responseContext` alone is a third of the response by size.
 */
const REDACTED_KEYS = new Set([
  "clickTrackingParams",
  "trackingParams",
  "loggingDirectives",
  "loggingContext",
  "visitorData",
  "sessionId",
  "responseContext",
  "serializedShareEntity",
  "adSlotRenderer",
  "adSlots",
  "playerAds",
  "serviceTrackingParams",
])

const MAX_DEPTH = 40

export interface YouTubeCaptureOptions {
  /** Overridable so a test does not wait thirty seconds to find out a fake failed. */
  timeoutMs?: number
}

export function buildSearchUrl(
  query: string,
  persona: { country: string; locale: string },
): string {
  const url = new URL("https://www.youtube.com/results")
  url.searchParams.set("search_query", query)
  url.searchParams.set("gl", persona.country.toUpperCase())
  url.searchParams.set("hl", localeToHl(persona.locale))
  // Without `persist_*` the hint applies to the first render and is dropped on the
  // in-page navigation YouTube performs after it — measured in P1.0, where it
  // would otherwise have made a whole axis of the experiment report a clean zero.
  url.searchParams.set("persist_gl", "1")
  url.searchParams.set("persist_hl", "1")
  return url.toString()
}

export function buildTrendingUrl(persona: { country: string; locale: string }): string {
  const url = new URL("https://www.youtube.com/feed/trending")
  url.searchParams.set("gl", persona.country.toUpperCase())
  url.searchParams.set("hl", localeToHl(persona.locale))
  url.searchParams.set("persist_gl", "1")
  url.searchParams.set("persist_hl", "1")
  return url.toString()
}

/** `th-TH` → `th`. YouTube's `hl` is a language, not a locale, and rejects the pair. */
function localeToHl(locale: string): string {
  return (locale.split("-")[0] ?? locale).toLowerCase()
}

export async function captureYouTube(
  ctx: CaptureContext,
  query: string,
  surface: "search" | "trending",
  options: YouTubeCaptureOptions = {},
): Promise<Capture<YouTubePayload>> {
  const page = ctx.page as YouTubePage
  const url =
    surface === "search" ? buildSearchUrl(query, ctx.persona) : buildTrendingUrl(ctx.persona)

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30_000 })

  const read = await page.evaluate(readInitialData)

  const payload: YouTubePayload = {
    initialData: redact(read.data, 0),
    pageTitle: read.title,
    surface,
  }

  const capture: Capture<YouTubePayload> = {
    sourceId: `youtube.${surface}`,
    query,
    // The URL after redirects, which is where a consent bounce becomes visible.
    url: read.href || url,
    capturedAt: new Date(),
    payload,
  }

  const refusedBy = refusal(read)
  // Spread rather than `refusedBy: undefined`: `exactOptionalPropertyTypes` is on,
  // and "absent" is the shape the orchestrator tests for.
  return refusedBy ? { ...capture, refusedBy } : capture
}

/**
 * What counts as a refusal, and — the more important half — what does not.
 *
 * A consent wall, a captcha, a bounce to a different host, or a response with no
 * `ytInitialData` in it at all: the page we were served is not the page we asked
 * for, and the bytes are evidence of that rather than of what the source thinks
 * about the query.
 *
 * **Zero results is not a refusal.** It is an honest answer to a bad query, and
 * the orchestrator already has an `empty` outcome that says exactly that. Folding
 * the two together would mean every misspelled query degraded a persona's health,
 * and — worse — that a genuine region block and a typo produced the same row.
 */
function refusal(read: PageRead): string | undefined {
  if (read.walled) return "consent-or-captcha"
  if (read.href && !read.href.includes("youtube.com")) return `redirected to ${hostOf(read.href)}`
  if (read.data === null) return `no ytInitialData (title: ${read.title || "none"})`
  return undefined
}

function hostOf(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href.slice(0, 40)
  }
}

/** Drop the redacted keys wherever they appear, keeping everything else in place. */
function redact(node: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return node
  if (Array.isArray(node)) return node.map((entry) => redact(entry, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key)) continue
    out[key] = redact(value, depth + 1)
  }
  return out
}
