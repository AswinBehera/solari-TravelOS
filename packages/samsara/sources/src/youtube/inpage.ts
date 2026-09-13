/// <reference lib="dom" />

/**
 * The one function in this package that runs inside the browser.
 *
 * File-scoped `dom` lib rather than a package-wide one. The body of a
 * `page.evaluate` is genuinely DOM code — it is serialised across and executed
 * there — so hand-declaring `document` would trade a real type for a
 * plausible-looking one. But `@samsara/sources` may have to compile against the
 * Workers runtime, where `document` does not exist, and a package-level `"lib":
 * ["DOM"]` would let any file here reach for it and still typecheck. A triple-slash
 * reference is the narrowest version of that permission: this file, nothing else.
 *
 * **It closes over nothing.** Playwright serialises the function source and
 * evaluates it in a context that has none of this module's scope — an import used
 * inside would typecheck here and throw `x is not defined` in the page, on a clock
 * that is already billing. Everything it needs is either a browser global or
 * inline.
 */

export interface PageRead {
  data: unknown
  walled: boolean
  title: string
  href: string
}

export function readInitialData(): PageRead {
  const globals = window as unknown as { ytInitialData?: unknown }
  // Declared inside the function, not above it: see the header. A module-scope
  // helper typechecks and throws `ReferenceError` in the page.
  const usable = (value: unknown): boolean =>
    value !== null && typeof value === "object" && !(value instanceof Node)

  // Two ways in. The global is set by an inline script and is what the site's own
  // code renders from; the regex is the fallback for when the tag is present but
  // has not executed yet, which happens on a slow first paint.
  //
  // The `usable` guard is borrowed from the TikTok adapter, where it was not a
  // precaution: TikTok's state lives in a `<script>` whose `id` makes it a global
  // of the same name, so reading the global returned the element, and an element
  // is truthy, so every downstream check agreed the capture had worked. YouTube
  // sets `ytInitialData` with an assignment rather than an id today. "Today" is
  // the whole reason the guard is here.
  let data: unknown = usable(globals.ytInitialData) ? globals.ytInitialData : null
  if (data === null) {
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const match = script.textContent?.match(/var ytInitialData\s*=\s*(\{[\s\S]*\});/)
      if (match?.[1]) {
        try {
          data = JSON.parse(match[1])
        } catch {
          data = null
        }
        break
      }
    }
  }
  const wall = document.querySelector(
    'form[action*="consent"], [href*="consent.youtube.com"], #captcha-form',
  )
  return { data, walled: wall !== null, title: document.title, href: location.href }
}
