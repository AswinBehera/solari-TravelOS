import { describe, expect, it } from "vitest"
import type { Capture } from "../adapter.js"
import { parsePantip } from "./parse.js"
import type { PantipPayload, PantipPostNode, PantipSurface, PantipTopicNode } from "./types.js"

/**
 * The free half. Everything here runs against bytes that are already paid for,
 * which is the whole reason `parse` is a separate method: being wrong about what a
 * vote label means costs a re-run of this file, not a browser session.
 */

function topic(over: Partial<PantipTopicNode> = {}): PantipTopicNode {
  return {
    href: "/topic/43210987",
    title: "คาเฟ่แถวอารีย์",
    authorName: "คุณนักชิม",
    authorHref: "/profile/1234567",
    tagLabels: ["อารีย์"],
    timeLabel: "2 ชั่วโมงที่แล้ว",
    voteLabel: null,
    commentLabel: null,
    viewLabel: null,
    excerpt: null,
    fragment: null,
    ...over,
  }
}

function post(over: Partial<PantipPostNode> = {}): PantipPostNode {
  return {
    role: "opening",
    postId: null,
    authorName: "คุณนักชิม",
    authorHref: "/profile/1234567",
    timeLabel: "3 วันที่แล้ว",
    text: "เดินหาที่นั่งทำงานแถวอารีย์มาทั้งวัน",
    mediaRefs: [],
    voteLabel: null,
    fragment: null,
    ...over,
  }
}

function capture(
  over: Partial<PantipPayload> = {},
  url = "https://pantip.com/topic/43210987",
  surface: PantipSurface = "topic",
): Capture<PantipPayload> {
  return {
    sourceId: `pantip.${surface}`,
    query: "43210987",
    url,
    capturedAt: new Date("2026-09-13T00:00:00Z"),
    payload: {
      surface,
      topics: [],
      posts: [],
      pageTitle: "คาเฟ่แถวอารีย์ - Pantip",
      state: null,
      stateLength: null,
      stateKeys: [],
      stateCandidates: [],
      nodeCounts: {},
      observedPaths: [],
      scrolls: 0,
      fragmentsStored: 0,
      strategies: { state: false, topics: 0, posts: 0 },
      ...over,
    },
  }
}

describe("identity", () => {
  it("builds the topic address from the number rather than copying the link", () => {
    // Two rows pointing at one thread carry different tracking. P1.8 measures URL
    // overlap between two personas; a URL that differed per row would have reported
    // no overlap and read like a finding.
    const drafts = parsePantip(
      capture(
        {
          surface: "tag",
          topics: [
            topic({ href: "/topic/43210987?ref=recommend" }),
            topic({ href: "https://pantip.com/topic/43210987?ref=tag&utm_source=x" }),
          ],
        },
        "https://pantip.com/tag/aree",
        "tag",
      ),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.url).toBe("https://pantip.com/topic/43210987")
  })

  it("drops a link that is not a topic rather than storing the address it found", () => {
    // Maps falls back to the raw link because a Maps address without a feature id
    // is still an address for something. A Pantip link without a topic number is
    // not a topic at all, and keeping it would put the board's own pagination into
    // the evidence.
    const drafts = parsePantip(
      capture(
        {
          surface: "forum",
          topics: [topic({ href: "/forum/food?page=2" }), topic({ href: null })],
        },
        "https://pantip.com/forum/food",
        "forum",
      ),
    )
    expect(drafts).toEqual([])
  })

  it("gives the opening post the topic's own address and a reply an anchor under it", () => {
    const drafts = parsePantip(
      capture({
        posts: [
          post(),
          post({ role: "reply", postId: "comment-1", text: "กาแฟดีมาก" }),
          post({ role: "reply", postId: "comment-2", text: "เห็นด้วย" }),
        ],
      }),
    )
    expect(drafts.map((draft) => draft.url)).toEqual([
      "https://pantip.com/topic/43210987",
      "https://pantip.com/topic/43210987#comment-1",
      "https://pantip.com/topic/43210987#comment-2",
    ])
  })

  it("drops a reply Pantip anchored nothing to", () => {
    // Without an id its URL would be the topic's, and it would collide with the
    // opening post and with every other unanchored reply under it.
    const drafts = parsePantip(
      capture({ posts: [post(), post({ role: "reply", postId: null, text: "ลอย ๆ" })] }),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.title).toBe("คาเฟ่แถวอารีย์")
  })

  it("puts the thread's title on the opening post and on nothing else", () => {
    // A reply has no headline, and copying the thread's title onto forty of them
    // would make forty copies of one claim.
    const drafts = parsePantip(
      capture({ posts: [post(), post({ role: "reply", postId: "comment-1" })] }),
    )
    expect(drafts[0]?.title).toBe("คาเฟ่แถวอารีย์")
    expect(drafts[1]?.title).toBeNull()
  })

  it("strips the site's name off the tab title and keeps everything else", () => {
    const title = (pageTitle: string) =>
      parsePantip(capture({ pageTitle, posts: [post()] }))[0]?.title
    expect(title("คาเฟ่แถวอารีย์ - Pantip")).toBe("คาเฟ่แถวอารีย์")
    expect(title("กาแฟเย็น | Pantip.com")).toBe("กาแฟเย็น")
    // No separator, no suffix: a title with a stray site name on it is a smaller
    // error than one truncated by a rule that guessed.
    expect(title("กาแฟเย็น")).toBe("กาแฟเย็น")
    expect(title("Pantip")).toBeNull()
    expect(title("   ")).toBeNull()
  })
})

describe("the counts", () => {
  it("reads Thai counts in powers of ten thousand", () => {
    // `5.6 หมื่น` is fifty-six thousand. `หมื่น` is ten thousand rather than a
    // thousand, which is why `counts.ts` exists and why nothing in `inpage.ts` is
    // allowed to do this: getting it wrong here costs a re-parse.
    const drafts = parsePantip(
      capture(
        {
          surface: "tag",
          topics: [topic({ viewLabel: "5.6 หมื่น", voteLabel: "12", commentLabel: "34 ความคิดเห็น" })],
        },
        "https://pantip.com/tag/aree",
        "tag",
      ),
    )
    expect(drafts[0]?.engagement).toEqual({ views: 56_000, likes: 12, comments: 34 })
  })

  it("keeps the three numbers independently nullable", () => {
    // A row that shows no view count has not told us it has no views. Zero and
    // unknown are different claims, and P1.8 reads these as evidence.
    const drafts = parsePantip(
      capture(
        { surface: "tag", topics: [topic({ commentLabel: "0 ความคิดเห็น" })] },
        "https://pantip.com/tag/aree",
        "tag",
      ),
    )
    expect(drafts[0]?.engagement).toEqual({ views: null, likes: null, comments: 0 })
  })

  it("returns no engagement at all rather than three nulls", () => {
    const listing = parsePantip(
      capture({ surface: "tag", topics: [topic()] }, "https://pantip.com/tag/aree", "tag"),
    )
    expect(listing[0]?.engagement).toBeNull()
    const thread = parsePantip(capture({ posts: [post()] }))
    expect(thread[0]?.engagement).toBeNull()
  })

  it("reads a post's votes as likes and claims nothing about views", () => {
    const drafts = parsePantip(capture({ posts: [post({ voteLabel: "21" })] }))
    expect(drafts[0]?.engagement).toEqual({ views: null, likes: 21, comments: null })
  })
})

describe("the draft", () => {
  it("guesses the language from the excerpt, falling back to the title", () => {
    const drafts = parsePantip(
      capture(
        {
          surface: "tag",
          topics: [topic({ excerpt: "ลองมาสามที่ ชอบที่นี่ที่สุด" }), topic({ href: "/topic/2" })],
        },
        "https://pantip.com/tag/aree",
        "tag",
      ),
    )
    expect(drafts[0]?.languageGuess).toBe("th")
    expect(drafts[0]?.text).toBe("ลองมาสามที่ ชอบที่นี่ที่สุด")
    // An excerpt is sometimes absent entirely; the title is the longer and more
    // reliable sample on a listing row.
    expect(drafts[1]?.languageGuess).toBe("th")
    expect(drafts[1]?.text).toBe("")
  })

  it("carries a post's images and leaves a listing row without any", () => {
    const drafts = parsePantip(
      capture({
        topics: [topic({ href: "/topic/99" })],
        posts: [post({ mediaRefs: ["https://f.ptcdn.info/story-one.jpg"] })],
      }),
    )
    expect(drafts[0]?.mediaRefs).toEqual(["https://f.ptcdn.info/story-one.jpg"])
    expect(drafts[1]?.mediaRefs).toEqual([])
  })

  it("lets the post win the id when a row on the same page points back at it", () => {
    // A topic page links itself, and the two drafts are not equally good: the
    // opening post has the writing in it and the row has a title and an excerpt.
    const drafts = parsePantip(capture({ topics: [topic()], posts: [post()] }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toBe("เดินหาที่นั่งทำงานแถวอารีย์มาทั้งวัน")
    expect(drafts[0]?.mediaRefs).toEqual([])
  })
})

describe("purity", () => {
  it("is a function of its argument and nothing else", () => {
    const input = capture({
      surface: "tag",
      topics: [topic({ viewLabel: "5.6 หมื่น" }), topic({ href: "/topic/2" })],
      posts: [post()],
    })
    const before = JSON.stringify(input)
    const once = parsePantip(input)
    const twice = parsePantip(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(twice).toEqual(once)
  })
})
