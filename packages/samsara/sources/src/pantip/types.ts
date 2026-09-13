/**
 * What a Pantip capture holds.
 *
 * Three surfaces over two shapes of page. A board listing and a tag listing are the
 * same page with different addresses, and a topic is the page where the writing
 * actually is — a listing gives titles, and titles are not what this project
 * collects. The split is the same one Maps made and for the same reason: one
 * `capture()` that listed a board and then opened every topic on it would be a
 * single session of unbounded length, invisible to a meter that bills per session.
 */
export type PantipSurface = "forum" | "tag" | "topic"

/**
 * One row in a listing.
 *
 * Every field is a string copied off the page or `null`, including the counts: the
 * in-page half is not allowed to read `2.5 หมื่น` as a number, because deciding what
 * that means is free here and costs a browser session there. `href` is stored
 * verbatim and the topic id is extracted in `parse.ts`, for the same reason.
 */
export interface PantipTopicNode {
  href: string | null
  title: string | null
  authorName: string | null
  authorHref: string | null
  /** Tags Pantip printed on the row, in its own script, in the order shown. */
  tagLabels: readonly string[]
  timeLabel: string | null
  voteLabel: string | null
  commentLabel: string | null
  viewLabel: string | null
  excerpt: string | null
  /** See `fragment` on `PantipPostNode`. */
  fragment: string | null
}

/**
 * The opening post, or one reply under it.
 *
 * `role` is not an interpretation of the content: the two are found by different
 * selectors, and recording which one matched is a fact about the read. A parser that
 * had to guess from position would be wrong the first time Pantip pinned something.
 */
export interface PantipPostNode {
  role: "opening" | "reply"
  /** Whatever Pantip anchors the node by — `id`, `data-cid` — copied as found. */
  postId: string | null
  authorName: string | null
  authorHref: string | null
  timeLabel: string | null
  text: string | null
  mediaRefs: readonly string[]
  voteLabel: string | null
  fragment: string | null
}

export interface PantipPayload {
  surface: PantipSurface
  topics: readonly PantipTopicNode[]
  posts: readonly PantipPostNode[]
  pageTitle: string
  /**
   * A named state blob, if this build ships one — `__NEXT_DATA__` and friends.
   *
   * Nothing reads it today and the DOM read above does not depend on it. It is here
   * because a surface that names its fields is worth more than one that does not: if
   * a capture comes back with this populated, the next parser can stop guessing at
   * class names entirely. Truncated, and scrubbed by shape. See `capture.ts`.
   */
  state: string | null
  stateLength: number | null
  stateKeys: readonly string[]
  /** Globals whose *names* look like state, for when all of `stateKeys` was wrong. */
  stateCandidates: readonly string[]
  /**
   * What each selector matched, including the ones that matched nothing.
   *
   * Every selector in `inpage.ts` is a guess written without having seen the page.
   * P1.5 established what that costs: a wrong guess is a browser session, so the
   * capture has to come back saying which guesses were wrong — including a capture
   * that came back with nothing in it, which is the one that most needs to.
   */
  nodeCounts: Readonly<Record<string, number>>
  observedPaths: readonly string[]
  scrolls: number
  /** How many item fragments were stored, against the cap. See `capture.ts`. */
  fragmentsStored: number
  strategies: { state: boolean; topics: number; posts: number }
}
