import type { Capture, CaptureContext } from "../adapter.js"
import { readTikTokState, type TikTokPageRead } from "./inpage.js"
import type { InterceptedBody, TikTokPayload, TikTokSurface } from "./types.js"

/**
 * The half that spends, on the surface this project expects to be refused by.
 *
 * The plan names TikTok as "the surface most likely to gate on IP geolocation, so
 * this is where the gap shows up if it shows up; report it as a gap rather than
 * working around it." That sentence is the design brief for this file, and it
 * rules out more than it rules in.
 *
 * **Nothing here tries to get past a wall.** No captcha solving, no signature
 * forging, no rotating through personas until one is let through, no headful
 * fingerprint theatre beyond the viewpoint the persona already carries. A refusal
 * is the measurement. P1.0 established that query language is the dominant signal
 * and egress is worth about as much as waiting five minutes; the open question
 * TikTok answers is whether that holds on a surface that actually enforces
 * geography. Working around the enforcement would delete the answer and replace it
 * with the sound of our own cleverness.
 *
 * So this distinguishes *which* wall it hit — login, captcha, region — and carries
 * that in `refusedBy`. Three refusals mean three different things: a login wall is
 * a product decision that applies to everyone, a captcha is a judgement about this
 * session, and a region block is the finding. Collapsing them to `blocked` would
 * make the interesting one unrecoverable from the row.
 *
 * **Two strategies, both always on.** The embedded state and the API responses fail
 * on different days and cost nothing to collect together — the response listener is
 * passive. See `types.ts`.
 */

/** The slice of Playwright's `Page` this adapter uses — and a fake must fake. */
export interface TikTokPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  url(): string
  evaluate<R>(fn: () => R): Promise<R>
  /** Passive. Registered before `goto` so the first response is not missed. */
  on(event: "response", handler: (response: TikTokResponse) => void): void
  off?(event: "response", handler: (response: TikTokResponse) => void): void
  waitForTimeout?(ms: number): Promise<void>
}

export interface TikTokResponse {
  url(): string
  status(): number
  json(): Promise<unknown>
}

/**
 * API paths whose bodies carry items. Matched as substrings of the pathname, so a
 * version bump from `/api/search/general/full/` to `.../v2/` still matches.
 *
 * Deliberately short. Every extra path is more public bytes in a fixture and more
 * chance of storing something that is about the session rather than the query.
 */
const ITEM_ENDPOINTS = [
  "/api/search/general",
  "/api/search/item",
  "/api/explore/item_list",
  "/api/recommend/item_list",
  "/api/post/item_list",
]

/**
 * Keys removed from the stored payload, wherever they appear.
 *
 * The same distinction as YouTube's: this is redaction by key name, not a
 * narrowing of the payload to the part the parser wants. TikTok's state carries
 * more session identity than YouTube's — `webIdLastTime`, the device id, an abuse
 * token, the whole `AppContext` — and this repository is public.
 */
const REDACTED_KEYS = new Set([
  "webIdLastTime",
  "odinId",
  "deviceId",
  "msToken",
  "verifyFp",
  "sessionId",
  "AppContext",
  "abTestVersion",
  "expIds",
  "sid_guard",
  "sid_tt",
  "secUid",
  "cookieLGWInfo",
  "installId",
  "csrfToken",
])

// Two near-misses worth recording, because both would have typechecked, passed
// every test, and quietly destroyed data:
//
// `signature` is not a request signature. On a TikTok author object it is the
// account's **bio** — free text, in the local language, which is exactly the kind
// of evidence this project harvests. It was on the first draft of the list above.
//
// `userInfo` is ambiguous: the viewer at the top level of `SIGI_STATE`, and a
// *result* in the search API's user results. Redacting by key name cannot tell
// those apart, and the viewer is already covered by `deviceId`, `odinId` and
// `webIdLastTime`. A denylist entry that is right half the time is not a
// half-measure; it is a silent data loss with a good reason attached.

const MAX_DEPTH = 40

export interface TikTokCaptureOptions {
  timeoutMs?: number
  /**
   * How long to let the page make its API calls after `domcontentloaded`.
   *
   * Unlike YouTube — whose data is in the first document, so the settle is zero —
   * TikTok frequently renders its list from an XHR, and a capture that leaves
   * immediately catches the document and none of the calls. This is a real cost on
   * a per-minute clock, which is why it is a named constant with a comment rather
   * than a number inside an await: three seconds across a twenty-run recording
   * window is a minute of billed time, and somebody should be able to see that.
   */
  settleMs?: number
}

export const DEFAULT_SETTLE_MS = 3_000

export function buildSearchUrl(query: string, persona: { locale: string }): string {
  const url = new URL("https://www.tiktok.com/search")
  url.searchParams.set("q", query)
  // `lang` is the only viewpoint parameter TikTok honours in the URL. There is no
  // `gl` equivalent: region comes from the egress IP, which is exactly why this
  // adapter is the one that tests ADR-0015's compromise rather than assuming it.
  url.searchParams.set("lang", localeToLang(persona.locale))
  return url.toString()
}

export function buildExploreUrl(persona: { locale: string }): string {
  const url = new URL("https://www.tiktok.com/explore")
  url.searchParams.set("lang", localeToLang(persona.locale))
  return url.toString()
}

/** `vi-VN` → `vi`. */
function localeToLang(locale: string): string {
  return (locale.split("-")[0] ?? locale).toLowerCase()
}

export async function captureTikTok(
  ctx: CaptureContext,
  query: string,
  surface: TikTokSurface,
  options: TikTokCaptureOptions = {},
): Promise<Capture<TikTokPayload>> {
  const page = ctx.page as TikTokPage
  const url =
    surface === "search" ? buildSearchUrl(query, ctx.persona) : buildExploreUrl(ctx.persona)

  const intercepted: InterceptedBody[] = []
  const pending: Promise<void>[] = []

  const onResponse = (response: TikTokResponse) => {
    const path = pathOf(response.url())
    if (!ITEM_ENDPOINTS.some((endpoint) => path.includes(endpoint))) return
    if (response.status() !== 200) return
    // Collected into a promise list rather than awaited here: this handler is
    // called synchronously by Playwright and an async handler that throws inside
    // it is an unhandled rejection that kills the session, which would turn a
    // malformed API response into a lost capture.
    pending.push(
      response
        .json()
        .then((body) => {
          intercepted.push({ path, body: redact(body, 0) })
        })
        .catch(() => {
          // A body that is not JSON is not evidence of anything. Dropped silently
          // rather than recorded as an error, because the strategy count in the
          // payload already says how many bodies were actually collected.
        }),
    )
  }

  page.on("response", onResponse)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30_000 })
    // See `settleMs`. Skipped entirely when the caller asks for zero, which is what
    // every test does.
    const settle = options.settleMs ?? DEFAULT_SETTLE_MS
    if (settle > 0 && page.waitForTimeout) await page.waitForTimeout(settle)
    await Promise.all(pending)
  } finally {
    page.off?.("response", onResponse)
  }

  const read = await page.evaluate(readTikTokState)

  const payload: TikTokPayload = {
    state: redact(read.state, 0),
    intercepted,
    pageTitle: read.title,
    surface,
    strategies: { state: read.state !== null, intercepted: intercepted.length },
  }

  const capture: Capture<TikTokPayload> = {
    sourceId: `tiktok.${surface}`,
    query,
    url: read.href || url,
    capturedAt: new Date(),
    payload,
  }

  const refusedBy = refusal(read, intercepted.length)
  return refusedBy ? { ...capture, refusedBy } : capture
}

/**
 * What counts as a refusal here, and what does not.
 *
 * The three walls are named separately because they are three different facts.
 * A **region** block is the one this adapter exists to find: it is ADR-0015's
 * compromise failing in the open, and it must be legible in the stored row without
 * anyone re-reading the capture. A **captcha** is a judgement about this session
 * and feeds the persona's health. A **login** wall is a product decision that
 * applies to every logged-out visitor and says nothing about the viewpoint — it
 * degrades a persona that did nothing wrong, which is a real cost of reporting it,
 * and it is still the correct thing to record, because a harvest that silently
 * returns nothing from behind a login wall is worse.
 *
 * **Zero items is not a refusal**, as everywhere else in this package: the
 * orchestrator has an `empty` outcome, and a typo must not read as a block.
 *
 * The last clause is the interesting one. Both strategies coming back empty —
 * no embedded state *and* no API body — is not an honest zero. It means we were
 * served a page this adapter does not recognise at all, and calling that `empty`
 * would report "TikTok has nothing about this" when the truth is "we cannot read
 * what TikTok sent".
 */
function refusal(read: TikTokPageRead, bodies: number): string | undefined {
  if (read.wall === "captcha") return "captcha"
  if (read.wall === "region") return "region-block"
  if (read.wall === "login") return "login-wall"
  if (!read.href.includes("tiktok.com")) return `redirected to ${hostOf(read.href)}`
  if (read.state === null && bodies === 0) {
    return `no state and no item api response (title: ${read.title || "none"})`
  }
  return undefined
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname
  } catch {
    return href
  }
}

function hostOf(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href.slice(0, 40)
  }
}

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
