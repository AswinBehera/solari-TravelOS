/// <reference lib="dom" />

/**
 * The one function in this folder that runs inside the browser.
 *
 * File-scoped `dom` lib, for the reason `youtube/inpage.ts` gives at length: the
 * body of a `page.evaluate` is genuinely DOM code, but `@samsara/sources` may have
 * to compile against the Workers runtime, and a package-wide `"lib": ["DOM"]`
 * would let every other file here reach for `document` and still typecheck.
 *
 * **It closes over nothing.** Playwright serialises the source; an import used
 * inside typechecks here and throws `x is not defined` in the page, on a clock
 * that is already billing.
 */

export interface TikTokPageRead {
  state: unknown
  /** What kind of wall, not merely that there is one. See `capture.ts`. */
  wall: "login" | "captcha" | "region" | null
  title: string
  href: string
  /** Rough count of rendered item tiles. Used only to tell empty from unrendered. */
  tiles: number
}

export function readTikTokState(): TikTokPageRead {
  const globals = window as unknown as {
    __UNIVERSAL_DATA_FOR_REHYDRATION__?: unknown
    SIGI_STATE?: unknown
  }

  // Two names, newest first. TikTok moved from `SIGI_STATE` to
  // `__UNIVERSAL_DATA_FOR_REHYDRATION__` and still serves the old shape to some
  // user agents, so both are read rather than one being assumed current.
  //
  // **The script tag is read before the global, and a candidate that is a DOM node
  // is rejected.** Both of these names are the `id` of a `<script>` tag, and HTML's
  // named access on `window` means `window.__UNIVERSAL_DATA_FOR_REHYDRATION__`
  // evaluates to *that script element* whenever no real property shadows it. The
  // first version of this function read the globals first and took the first
  // non-null answer, so it always got the element, never descended to the tag it
  // was standing on, and returned something that was not null — which meant
  // `capture.ts` saw `state !== null`, recorded the strategy as having worked, and
  // declined to call it a refusal. The recorded fixture was 381 bytes containing
  // the string `ref: <Node>`. A null would have been caught by the refusal check
  // on the first run; an element was worse than nothing precisely because it was
  // truthy.
  //
  // **The test is written out twice rather than put in a helper**, and that is not
  // a style choice. This function is serialised and evaluated in the page, so it
  // may not close over module scope — and a helper declared *inside* it does not
  // help either, because the bundler that ships this code rewrites named functions
  // as `__name(fn, "usable")` and `__name` lives at module scope. Two sessions
  // went to learning that in order: first `ReferenceError: usable is not defined`,
  // then `ReferenceError: __name is not defined`. The only shape that survives
  // serialisation is one with no function of its own in it. `inpage.test.ts` asserts that
  // shape, because a comment saying it is not a check that it is true.
  let state: unknown = null
  for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
    const candidates: unknown[] = []

    const tag = document.getElementById(id)
    if (tag?.textContent) {
      try {
        candidates.push(JSON.parse(tag.textContent))
      } catch {
        // Not JSON. The global may still hold the live object.
      }
    }
    candidates.push(
      id === "SIGI_STATE" ? globals.SIGI_STATE : globals.__UNIVERSAL_DATA_FOR_REHYDRATION__,
    )

    for (const candidate of candidates) {
      if (candidate === null || typeof candidate !== "object") continue
      if (Array.isArray(candidate) || candidate instanceof Node) continue
      if (Object.keys(candidate).length === 0) continue
      state = candidate
      break
    }
    if (state !== null) break
  }

  const text = document.body?.innerText?.slice(0, 4_000) ?? ""
  // Matched on structure first and words second: the selectors are what TikTok's
  // own code keys off, and the text is the fallback for a wall rendered by a
  // different team. Neither is reliable alone; both being wrong at once is the
  // case `state === null` already covers.
  const captcha =
    document.querySelector('[id*="captcha"], [class*="captcha"], [class*="secsdk"]') !== null
  const login =
    document.querySelector('[id*="login-modal"], [data-e2e="login-modal"]') !== null ||
    /log in to (continue|tiktok)/i.test(text)
  const region = /not available in your (country|region)/i.test(text)

  const wall = captcha ? "captcha" : region ? "region" : login ? "login" : null

  return {
    state,
    wall,
    title: document.title,
    href: location.href,
    tiles: document.querySelectorAll('[data-e2e*="item"], [data-e2e*="video"]').length,
  }
}
