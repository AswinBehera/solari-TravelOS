import type { Engagement, SourceId } from "@samsara/core"
import type { Logger } from "@samsara/kernel"

/**
 * What a source adapter is, and — more usefully — what it is not allowed to be.
 *
 * The plan's one-line version is `harvest(ctx, query): Promise<RawItem[]>`. This
 * file splits that in half and narrows the return type, for reasons stated below.
 * Both departures are load-bearing; neither is tidying.
 *
 * **The adapter does not know what the caller will do with the items.** It takes a
 * query string and returns what the source said. It does not score, filter, rank,
 * deduplicate, or decide what is interesting — those are a pack's opinions, and a
 * pack is a thing this package must never learn the existence of. Adapters are
 * per-source, not per-domain: one YouTube adapter serves every vertical that names
 * it, which is only possible while it has no vertical in it.
 */

/**
 * Everything an adapter is given, and nothing else.
 *
 * `page` is `unknown` for the same reason it is `unknown` in the kernel's ports:
 * its real type is Playwright's, and that library must stay unreachable from a
 * package the Workers runtime may one day have to load. Each adapter casts it to
 * the slice it actually uses, which is also the slice its fixtures have to fake.
 */
export interface CaptureContext {
  /** Already open, already carrying the persona's viewpoint. */
  page: unknown
  /** Whose eyes this is being read through. Read-only here — adapters never write. */
  persona: CapturePersona
  logger: Logger
  /** Aborted on SIGTERM (ADR-0014). Pass it to every await that takes one. */
  signal: AbortSignal
}

/**
 * The persona as an adapter needs it: the viewpoint, not the identity.
 *
 * Narrower than `PersonaRecord` on purpose. An adapter has a legitimate interest in
 * what language to ask in and what region to claim; it has none at all in the
 * persona's health, its provider profile id, or how many minutes it has spent. A
 * wider type here would make `@samsara/sources` depend on `@samsara/personas`, and
 * then an adapter could decide to retire an identity it found inconvenient.
 */
export interface CapturePersona {
  id: string
  country: string
  locale: string
  timezoneId: string
}

/**
 * One request to a source, stored exactly as it came back.
 *
 * This is the artefact `rawRef` points at, and it is also — the same bytes, no
 * second format — the fixture a parser test runs against. That identity is the
 * whole design: a fixture is produced by running the real thing once, so a parser
 * test cannot drift from the page it claims to parse into a hand-written
 * approximation that agrees with the parser because the same person wrote both.
 *
 * `payload` is the adapter's business. HTML for a scrape, parsed JSON for an
 * intercepted XHR, an array of either for a paginated read. The engine carries it
 * without reading it, and stores it without understanding it.
 */
export interface Capture<P = unknown> {
  sourceId: SourceId
  /** The question asked, verbatim, so a stored capture explains itself. */
  query: string
  /** The URL actually loaded — after redirects, including any consent bounce. */
  url: string
  capturedAt: Date
  payload: P
  /**
   * Set when the page was not the page we asked for: a consent wall, a captcha, an
   * age gate, a region block, an empty state that is clearly a refusal rather than
   * an honest zero.
   *
   * **Carried, not thrown.** A refusal is information about the viewpoint — it is,
   * in fact, the single most interesting thing a harvest can discover about one —
   * and an exception here would discard it along with the bytes that prove it. The
   * orchestrator turns this into a `blocked` outcome and a persona health verdict;
   * the adapter's job is only to notice.
   */
  refusedBy?: string
}

/**
 * What a parser produces: a `RawItem` minus everything it has no business knowing.
 *
 * Three fields are deliberately absent. `harvestRunId` belongs to a run the adapter
 * cannot see. `rawRef` is assigned by whoever archives the capture. And `id` is the
 * important one: if a parser minted ids, re-parsing a stored capture would produce
 * different rows every time, and re-parsing stored captures without re-opening a
 * browser is the single largest saving available to this project. The rule that
 * makes it work is that **parsing is pure** — same capture in, same drafts out,
 * no clock, no network, no randomness.
 *
 * `capturedAt` is absent for the same reason: it is a fact about the capture, and
 * reading it from a clock inside `parse` would make yesterday's fixture produce
 * today's timestamp.
 */
export interface ItemDraft {
  url: string
  title: string | null
  /** The text as the source rendered it, in its own script. Never translated here. */
  text: string
  /** What the source or a cheap detector claimed. Not authoritative. */
  languageGuess: string | null
  mediaRefs: readonly string[]
  engagement: Engagement | null
}

/**
 * A source, in two halves that are separated for cost rather than for neatness.
 *
 * `capture` needs a browser and therefore spends money. `parse` needs neither and
 * therefore does not. Every adapter this project ships will have its parser
 * rewritten several times as the source changes its markup, and under a $20
 * ceiling the difference between "iterate against stored bytes" and "re-open a
 * session per iteration" is the difference between a working adapter and an
 * abandoned one.
 *
 * Making that a *type* rather than a convention is the point. An adapter physically
 * cannot fetch from inside `parse`, because `parse` is handed a `Capture` and is
 * not `async`.
 */
export interface SourceAdapter<P = unknown> {
  id: SourceId
  /** The half that spends. */
  capture(ctx: CaptureContext, query: string): Promise<Capture<P>>
  /** The half that does not. Pure, synchronous, fixture-testable. */
  parse(capture: Capture<P>): readonly ItemDraft[]
}

/**
 * Run both halves. What the plan called `harvest(ctx, query)`.
 *
 * Provided as a free function rather than a method so that no adapter can override
 * it into something that fetches during parsing.
 */
export async function harvest<P>(
  adapter: SourceAdapter<P>,
  ctx: CaptureContext,
  query: string,
): Promise<{ capture: Capture<P>; items: readonly ItemDraft[] }> {
  const capture = await adapter.capture(ctx, query)
  // A refused capture is archived and reported, never parsed: running a parser
  // over a consent wall yields zero items, and zero items from a refusal is
  // indistinguishable from zero items from an honest empty result.
  const items = capture.refusedBy ? [] : adapter.parse(capture)
  return { capture, items }
}
