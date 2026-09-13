/**
 * What a YouTube capture holds.
 *
 * `initialData` is the `ytInitialData` object the page embeds in a script tag —
 * the same JSON the site's own front end renders from. Typed as `unknown` rather
 * than modelled: writing an interface for it would be writing down a shape this
 * project does not control and cannot keep current, and the parser already treats
 * every field as "maybe". The type system cannot help here, so it should not
 * pretend to.
 *
 * What is *not* in here is as deliberate. No HTML, no cookies, no headers. See
 * `capture.ts` for what is stripped and why.
 */
export interface YouTubePayload {
  /** `ytInitialData`, with tracking keys removed. */
  initialData: unknown
  /** The page title as served — useful evidence when a capture turns out refused. */
  pageTitle: string
  /** Which YouTube surface this came from, so one parser can serve several. */
  surface: "search" | "trending"
}
