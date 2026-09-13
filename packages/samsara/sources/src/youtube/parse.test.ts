import { describe, expect, it } from "vitest"
import type { Capture } from "../adapter.js"
import { parseYouTube } from "./parse.js"
import type { YouTubePayload } from "./types.js"

/**
 * What these tests cover, and — because it matters more — what they do not.
 *
 * The trees below are **built by hand**. They cover the parser's own behaviour:
 * that it searches rather than paths, that document order survives, that a video
 * appearing twice is counted once, that a missing field produces a null and not a
 * crash. Every one of those is a property of this file's code, and a hand-made
 * tree tests them honestly.
 *
 * They do **not** establish that the shape is right. Only a recorded capture does
 * that, and the fixture test that will do it lives in `youtube.fixture.test.ts`,
 * which does not exist yet because recording it costs a browser session. Saying so
 * here rather than letting a green suite imply otherwise: a hand-written fixture
 * that agrees with the parser because the same person wrote both is precisely the
 * failure `adapter.ts` was split in half to prevent.
 */

function capture(initialData: unknown): Capture<YouTubePayload> {
  return {
    sourceId: "youtube.search",
    query: "xin chào",
    url: "https://www.youtube.com/results?search_query=xin+ch%C3%A0o",
    capturedAt: new Date("2026-09-12T10:00:00Z"),
    payload: { initialData, pageTitle: "xin chào - YouTube", surface: "search" },
  }
}

function video(id: string, extra: Record<string, unknown> = {}) {
  return {
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: `title ${id}` }] },
      ...extra,
    },
  }
}

/** The container nesting a real search response uses, abbreviated. */
function searchPage(items: unknown[]) {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] },
        },
      },
    },
  }
}

describe("parseYouTube", () => {
  it("finds videos wherever they sit in the tree", () => {
    // The reason the parser searches instead of walking a path: these two are at
    // different depths, in different containers, and both are on the page.
    const page = searchPage([
      video("aaaaaaaaaaa"),
      { shelfRenderer: { content: { verticalListRenderer: { items: [video("bbbbbbbbbbb")] } } } },
      { reelShelfRenderer: { items: [{ reelItemRenderer: { videoId: "ccccccccccc" } }] } },
    ])
    const items = parseYouTube(capture(page))
    expect(items.map((i) => i.url)).toEqual([
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      "https://www.youtube.com/watch?v=ccccccccccc",
    ])
  })

  it("keeps document order, because document order is rank", () => {
    const ids = ["zzzzzzzzzzz", "aaaaaaaaaaa", "mmmmmmmmmmm"]
    const items = parseYouTube(capture(searchPage(ids.map((id) => video(id)))))
    expect(items.map((i) => i.url.slice(-11))).toEqual(ids)
  })

  it("counts a video shown twice once, keeping its first rank", () => {
    const page = searchPage([
      video("aaaaaaaaaaa"),
      video("bbbbbbbbbbb"),
      { shelfRenderer: { content: { items: [video("aaaaaaaaaaa")] } } },
    ])
    const items = parseYouTube(capture(page))
    expect(items).toHaveLength(2)
    expect(items[0]?.url).toContain("aaaaaaaaaaa")
  })

  it("builds its own url instead of trusting the page's href", () => {
    // A YouTube href carries per-session click tracking, so the same video yields a
    // different URL in two captures — and a URL that cannot identify a video twice
    // cannot be used to tell that two harvests found the same thing.
    const page = searchPage([
      video("aaaaaaaaaaa", {
        navigationEndpoint: { commandMetadata: { url: "/watch?v=aaaaaaaaaaa&pp=TRACKING" } },
      }),
    ])
    expect(parseYouTube(capture(page))[0]?.url).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa")
  })

  it("reads both of the ways YouTube says a string", () => {
    const page = searchPage([
      { videoRenderer: { videoId: "aaaaaaaaaaa", title: { simpleText: "plain" } } },
      {
        videoRenderer: {
          videoId: "bbbbbbbbbbb",
          title: { runs: [{ text: "two " }, { text: "runs" }] },
        },
      },
    ])
    const items = parseYouTube(capture(page))
    expect(items[0]?.title).toBe("plain")
    expect(items[1]?.title).toBe("two runs")
  })

  it("falls back from snippet to title, never to an empty string", () => {
    const withSnippet = video("aaaaaaaaaaa", {
      detailedMetadataSnippets: [{ snippetText: { runs: [{ text: "the description" }] } }],
    })
    const bare = video("bbbbbbbbbbb")
    const items = parseYouTube(capture(searchPage([withSnippet, bare])))
    expect(items[0]?.text).toBe("the description")
    // A Short has no description. Storing "" would read as "this video has no
    // words in it", which is a different and false claim.
    expect(items[1]?.text).toBe("title bbbbbbbbbbb")
  })

  it("reports unknown engagement as null rather than zero", () => {
    const items = parseYouTube(
      capture(
        searchPage([
          video("aaaaaaaaaaa", { viewCountText: { simpleText: "1.2M views" } }),
          video("bbbbbbbbbbb"),
          video("ccccccccccc", { viewCountText: { simpleText: "0 views" } }),
        ]),
      ),
    )
    expect(items[0]?.engagement).toEqual({ views: 1_200_000, likes: null, comments: null })
    expect(items[1]?.engagement).toBeNull()
    // Zero is a measurement. Null is the absence of one. The schema says so and so
    // does this test.
    expect(items[2]?.engagement).toEqual({ views: 0, likes: null, comments: null })
  })

  it("guesses a script, and declines to guess a language it cannot see", () => {
    const items = parseYouTube(
      capture(
        searchPage([
          { videoRenderer: { videoId: "aaaaaaaaaaa", title: { simpleText: "สวัสดีชาวโลก" } } },
          { videoRenderer: { videoId: "bbbbbbbbbbb", title: { simpleText: "xin chào thế giới" } } },
          { videoRenderer: { videoId: "ccccccccccc", title: { simpleText: "hello world" } } },
        ]),
      ),
    )
    expect(items[0]?.languageGuess).toBe("th")
    expect(items[1]?.languageGuess).toBe("vi")
    // Not "en". "Probably English" is a claim, and the refinement stage can make a
    // better one with a real model than a regex can here.
    expect(items[2]?.languageGuess).toBeNull()
  })

  it("collects thumbnails and survives their absence", () => {
    const page = searchPage([
      video("aaaaaaaaaaa", {
        thumbnail: {
          thumbnails: [
            { url: "https://i.ytimg.com/vi/a/1.jpg" },
            { url: "https://i.ytimg.com/vi/a/2.jpg" },
          ],
        },
      }),
      video("bbbbbbbbbbb"),
    ])
    const items = parseYouTube(capture(page))
    expect(items[0]?.mediaRefs).toHaveLength(2)
    expect(items[1]?.mediaRefs).toEqual([])
  })

  it("ignores a renderer with no video id", () => {
    // Channels and playlists live in the same list and have no `videoId`. They are
    // not videos and must not become items with a broken URL.
    const page = searchPage([
      { channelRenderer: { channelId: "UC123" } },
      { videoRenderer: { title: { simpleText: "no id" } } },
      video("aaaaaaaaaaa"),
    ])
    expect(parseYouTube(capture(page))).toHaveLength(1)
  })

  it("returns nothing for a payload that is not a page", () => {
    expect(parseYouTube(capture(null))).toEqual([])
    expect(parseYouTube(capture({}))).toEqual([])
    expect(parseYouTube(capture("not json"))).toEqual([])
  })

  it("does not hang on a payload that refers to itself", () => {
    // A depth limit rather than a visited-set: cheaper, and a response nested forty
    // deep is already not a response this parser understands.
    const cyclic: Record<string, unknown> = { contents: [video("aaaaaaaaaaa")] }
    cyclic.self = cyclic
    expect(parseYouTube(capture(cyclic))).toHaveLength(1)
  })

  it("is pure: the same capture parses identically twice", () => {
    // The property the whole re-parse saving depends on. If this ever fails, a
    // re-parse of archived captures produces different rows than the harvest did.
    const page = searchPage([video("aaaaaaaaaaa"), video("bbbbbbbbbbb")])
    const once = parseYouTube(capture(page))
    const twice = parseYouTube(capture(page))
    expect(twice).toEqual(once)
  })
})
