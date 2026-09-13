/**
 * What a TikTok capture holds, and why it holds two things instead of one.
 *
 * The plan asks for "two strategies: rendered page scrape, then intercepted XHR
 * JSON". They are not alternatives to pick between at build time — they fail on
 * different days. The embedded state is absent when the page renders client-side
 * from an API call; the API responses are absent when the surface serves a fully
 * hydrated document and makes no call. Capturing both costs nothing extra once a
 * session is open — the response listener is passive — and it means a capture
 * taken on a day when one strategy was empty is still a capture that parses.
 *
 * Choosing one at capture time would be choosing with the *least* information
 * anyone will ever have about that page: before the browser has loaded it, in the
 * half that spends, with no way to revisit the decision without paying again.
 */
export interface TikTokPayload {
  /**
   * `__UNIVERSAL_DATA_FOR_REHYDRATION__` or the older `SIGI_STATE`, whichever the
   * document carried, with tracking keys removed. `null` when neither was present,
   * which is a fact worth storing rather than an error.
   */
  state: unknown
  /**
   * JSON bodies of the item-list API calls the page made while we watched. Kept in
   * arrival order, which is close enough to rank order for a first page and is the
   * only order available.
   */
  intercepted: readonly InterceptedBody[]
  /** The page title as served — evidence when a capture turns out refused. */
  pageTitle: string
  surface: TikTokSurface
  /** Which strategies actually produced anything. Read by the parser and by humans. */
  strategies: {
    state: boolean
    intercepted: number
  }
  /**
   * Rendered item tiles, counted in the page.
   *
   * Not read by the parser. It is here because the capture that most needs
   * explaining is the one that refused, and `state: null, intercepted: 0` alone
   * cannot tell "TikTok served a shell" apart from "TikTok rendered results and
   * this adapter could not find where it put them" — a provider problem and a
   * parser problem respectively, and a session each to tell apart by re-running.
   * One integer, already collected, settles it.
   */
  tiles: number
}

/**
 * One API response, with the path it came from.
 *
 * The path is kept because `/api/search/general/full/` and
 * `/api/explore/item_list/` shape their results differently, and because a capture
 * that stops parsing in six months should say which endpoint changed rather than
 * leaving somebody to guess from the body.
 */
export interface InterceptedBody {
  /** Path only. A TikTok API URL's query string carries device and session ids. */
  path: string
  body: unknown
}

/**
 * `search` asks a question; `explore` is what the surface pushes at an idle viewer
 * in a region. Separate ids for the same reason YouTube's two are separate: this
 * is the column a stored row is grouped and re-parsed by.
 */
export type TikTokSurface = "search" | "explore"
