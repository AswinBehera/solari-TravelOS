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

/**
 * Is this a state object, or is it the script tag the state was supposed to be in?
 *
 * `instanceof Node` and not a duck-typed check: the whole point is to reject a
 * thing that answers to `typeof === "object"` and would serialise across the
 * evaluate boundary as an unusable reference.
 */
function usable(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  if (value instanceof Node) return false
  return Object.keys(value).length > 0
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
  // **The script tag is read before the global, and the global is checked for
  // being a DOM node.** Both of these names are the `id` of a `<script>` tag, and
  // HTML's named access on `window` means `window.__UNIVERSAL_DATA_FOR_REHYDRATION__`
  // evaluates to *that script element* whenever no real property shadows it. The
  // first version of this function read the globals first and took the first
  // non-null answer, so it always got the element, never descended to the tag it
  // was standing on, and returned something that was not null — which meant
  // `capture.ts` saw `state !== null`, recorded the strategy as having worked, and
  // declined to call it a refusal. The recorded fixture was 381 bytes containing
  // the string `ref: <Node>`. A null would have been caught by the refusal check
  // on the first run; an element was worse than nothing precisely because it was
  // truthy.
  let state: unknown = null
  for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
    const tag = document.getElementById(id)
    if (tag?.textContent) {
      try {
        const parsed: unknown = JSON.parse(tag.textContent)
        if (usable(parsed)) {
          state = parsed
          break
        }
      } catch {
        // Not JSON. Fall through to the global, which may hold the live object.
      }
    }
    const global =
      id === "SIGI_STATE" ? globals.SIGI_STATE : globals.__UNIVERSAL_DATA_FOR_REHYDRATION__
    if (usable(global)) {
      state = global
      break
    }
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
