/** What a surface needs in order to build a URL: the question, and any hints. */
export interface SurfaceRequest {
  query: string
  hints?: { gl: string; hl: string }
}

/**
 * The surface being asked, and how to read its answer.
 *
 * An interface rather than a hardcoded target, for one reason: the conclusion of
 * this experiment is "which signals move *this* surface", and the first question
 * anybody will ask of the table is whether it holds elsewhere. Re-pointing the
 * run at a second surface should cost a file, not a rewrite.
 */
export interface Surface {
  id: string
  buildUrl(request: SurfaceRequest): string
  /** Reads the ranked identifiers from a page that is already loaded. */
  readTop(page: PageLike, k: number): Promise<SurfaceReading>
}

export interface SurfaceReading {
  /** Ranked identifiers, best first. */
  items: string[]
  /**
   * Set when the page was not the page we asked for — a consent wall, a captcha,
   * an empty result. Carried rather than thrown: a cell that was refused is data
   * about the viewpoint, and dropping it would quietly turn a blocked viewpoint
   * into a missing row.
   */
  refusedBy?: string
}

/** The slice of Playwright's page the kernel hands through as `unknown`. */
export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  evaluate<R>(fn: () => R): Promise<R>
  waitForTimeout(ms: number): Promise<void>
}

/**
 * YouTube search, logged out.
 *
 * Chosen over web search for three reasons, in order: it is the surface P1.3
 * builds an adapter against, so the measurement lands where it will be used; its
 * results are stable ids rather than URLs carrying per-session tracking noise,
 * which matters because the whole metric is set intersection; and it honours
 * `gl`/`hl` as request parameters, which makes "stored region preference" a knob
 * that can be turned rather than a cookie we would have to warm a profile to get.
 *
 * The cost of that choice: the answer is YouTube's answer. The table has to say so.
 */
export const youtubeSearch: Surface = {
  id: "youtube.search",

  buildUrl({ query, hints }: SurfaceRequest): string {
    const url = new URL("https://www.youtube.com/results")
    url.searchParams.set("search_query", query)
    if (hints) {
      url.searchParams.set("gl", hints.gl)
      url.searchParams.set("hl", hints.hl)
      // `persist_*` is what keeps the hint applied across the in-page navigation
      // YouTube performs after first paint. Without it the parameter is honoured
      // for one render and then dropped, which would have left the `storedRegion`
      // axis measuring nothing while reporting a clean zero.
      url.searchParams.set("persist_gl", "1")
      url.searchParams.set("persist_hl", "1")
    }
    return url.toString()
  },

  async readTop(page: PageLike, k: number): Promise<SurfaceReading> {
    // Results arrive after first paint. A fixed settle is crude, and it is also
    // the same settle in every cell — which is what the comparison needs, because
    // a per-cell wait that adapts to load time would give slow cells more of the
    // list than fast ones and report the difference as a signal effect.
    await page.waitForTimeout(3_500)

    const reading = await page.evaluate(() => {
      const wall = document.querySelector(
        'form[action*="consent"], [href*="consent.youtube.com"], #captcha-form',
      )
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
      const ids: string[] = []
      for (const anchor of anchors) {
        const match = anchor.getAttribute("href")?.match(/[?&]v=([\w-]{11})/)
        if (match?.[1]) ids.push(match[1])
      }
      return { ids, walled: wall !== null, title: document.title }
    })

    const items: string[] = []
    for (const id of reading.ids) {
      if (!items.includes(id)) items.push(id)
      if (items.length === k) break
    }

    if (reading.walled) return { items, refusedBy: "consent-or-captcha" }
    if (items.length === 0) return { items, refusedBy: `no-results (title: ${reading.title})` }
    return { items }
  },
}
