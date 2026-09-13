import { silentLogger } from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import type { CaptureContext } from "../adapter.js"
import {
  buildExploreUrl,
  buildSearchUrl,
  captureTikTok,
  type TikTokPage,
  type TikTokResponse,
} from "./capture.js"
import type { TikTokPageRead } from "./inpage.js"

/**
 * A page that was never opened.
 *
 * `evaluate` is handed the real `readTikTokState` and ignores it, returning what
 * the test says the page contained. That is the honest boundary for this half:
 * everything `readTikTokState` does happens inside a browser, and a fake `document`
 * would be testing my model of a DOM rather than a DOM. What *is* testable here is
 * everything around it — which URL was asked for, which responses were kept, what
 * was stripped, and what counts as a refusal.
 *
 * That reasoning has one hole, and the first live capture found it: it is also the
 * reason nothing checked what `readTikTokState` *returns*. `inpage.test.ts` now
 * covers the part of that function which depends on no page in particular.
 */

function fakePage(read: Partial<TikTokPageRead>, responses: FakeResponse[] = []) {
  const handlers: ((response: TikTokResponse) => void)[] = []
  const visited: string[] = []
  let offCalls = 0

  const page: TikTokPage = {
    async goto(url: string) {
      visited.push(url)
      // Fired during `goto`, as Playwright does: a listener registered afterwards
      // would miss every response, which is why registration order is load-bearing
      // in `captureTikTok` and asserted below.
      for (const response of responses) {
        for (const handler of handlers) handler(response)
      }
      return null
    },
    url: () => visited[visited.length - 1] ?? "",
    async evaluate<R>(): Promise<R> {
      return {
        state: null,
        wall: null,
        title: "",
        href: "https://www.tiktok.com/search?q=x",
        tiles: 0,
        ...read,
      } as R
    },
    on(_event, handler) {
      handlers.push(handler)
    },
    off() {
      offCalls += 1
    },
  }
  return {
    page,
    visited,
    get offCalls() {
      return offCalls
    },
  }
}

interface FakeResponse extends TikTokResponse {}

function response(
  url: string,
  status: number,
  body: unknown | (() => Promise<unknown>),
): FakeResponse {
  return {
    url: () => url,
    status: () => status,
    json: () =>
      typeof body === "function" ? (body as () => Promise<unknown>)() : Promise.resolve(body),
  }
}

function context(page: TikTokPage): CaptureContext {
  return {
    page,
    persona: { id: "p1", country: "sg", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" },
    logger: silentLogger,
    signal: new AbortController().signal,
  }
}

const NO_SETTLE = { settleMs: 0 }

describe("buildSearchUrl", () => {
  it("carries the persona's language, which P1.0 measured as the dominant signal", () => {
    const url = new URL(buildSearchUrl("bánh mì", { locale: "vi-VN" }))
    expect(url.searchParams.get("q")).toBe("bánh mì")
    expect(url.searchParams.get("lang")).toBe("vi")
  })

  it("has no region parameter to carry, which is the finding rather than an omission", () => {
    // TikTok takes region from the egress IP. There is no `gl` to set, so this
    // adapter is the one that actually tests ADR-0015's `sg`-for-`th` compromise.
    const url = new URL(buildExploreUrl({ locale: "th-TH" }))
    expect(url.searchParams.get("lang")).toBe("th")
    expect([...url.searchParams.keys()]).toEqual(["lang"])
  })
})

describe("state that is not state", () => {
  /**
   * The live case, in one line. TikTok's state lives in a `<script>` whose `id`
   * makes it a global of the same name, so the first version of `readTikTokState`
   * came back holding the element. Across the evaluate boundary that serialised to
   * the string `ref: <Node>` — not null, so the refusal below stayed quiet, the
   * strategy was recorded as having worked, and the recorder wrote a 381-byte
   * fixture that read as a successful harvest of nothing.
   *
   * `inpage.ts` no longer returns a node. This asserts the second line of defence,
   * on this side of a serialiser nobody in this repository controls.
   */
  it("refuses a page whose state survived as something that is not an object", async () => {
    const { page } = fakePage({ state: "ref: <Node>" })
    const capture = await captureTikTok(context(page), "bánh mì", "search", { settleMs: 0 })

    expect(capture.payload.state).toBeNull()
    expect(capture.payload.strategies.state).toBe(false)
    expect(capture.refusedBy).toMatch(/no state and no item api response/)
  })

  it("still reports the strategy honestly when an api body arrived anyway", async () => {
    const { page } = fakePage({ state: "ref: <Node>" }, [
      response("https://www.tiktok.com/api/search/general/?q=x", 200, {
        data: [{ item: { id: "123", desc: "bánh mì", stats: { playCount: 5 } } }],
      }),
    ])
    const capture = await captureTikTok(context(page), "bánh mì", "search", { settleMs: 0 })

    expect(capture.payload.strategies.state).toBe(false)
    expect(capture.payload.strategies.intercepted).toBe(1)
    // Not a refusal: one strategy reading is a read.
    expect(capture.refusedBy).toBeUndefined()
  })
})

describe("captureTikTok", () => {
  it("keeps the item-list api bodies it saw", async () => {
    const fake = fakePage({}, [
      response("https://www.tiktok.com/api/search/general/full/?x=1", 200, { data: [1] }),
    ])
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.payload.intercepted).toHaveLength(1)
    expect(capture.payload.strategies.intercepted).toBe(1)
  })

  it("stores the api path without its query string, which carries device ids", async () => {
    const fake = fakePage({}, [
      response("https://www.tiktok.com/api/search/general/full/?msToken=secret", 200, {}),
    ])
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.payload.intercepted[0]?.path).toBe("/api/search/general/full/")
    expect(JSON.stringify(capture)).not.toContain("secret")
  })

  it("ignores responses that are not item lists, and ones that failed", async () => {
    const fake = fakePage({}, [
      response("https://www.tiktok.com/api/user/detail/", 200, { user: 1 }),
      response("https://www.tiktok.com/api/search/general/full/", 403, { blocked: 1 }),
    ])
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.payload.intercepted).toEqual([])
  })

  it("survives a response whose body is not json", async () => {
    // An async handler that rejects inside Playwright's synchronous `on` is an
    // unhandled rejection, which kills the session and loses the whole capture —
    // including the state, which may have been perfectly readable.
    const fake = fakePage({ state: { ItemModule: {} } }, [
      response("https://www.tiktok.com/api/explore/item_list/", 200, () =>
        Promise.reject(new Error("not json")),
      ),
    ])
    const capture = await captureTikTok(context(fake.page), "x", "explore", NO_SETTLE)
    expect(capture.payload.intercepted).toEqual([])
    expect(capture.payload.strategies.state).toBe(true)
    expect(capture.refusedBy).toBeUndefined()
  })

  it("stops listening when it is done", async () => {
    const fake = fakePage({ state: {} })
    await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(fake.offCalls).toBe(1)
  })

  it("strips session identity from the stored state", async () => {
    const fake = fakePage({
      state: { AppContext: { deviceId: "d1" }, nested: { msToken: "t", keep: "yes" } },
    })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    const json = JSON.stringify(capture)
    expect(json).not.toContain("msToken")
    expect(json).not.toContain("AppContext")
    expect(json).toContain("yes")
  })

  it("keeps an author's bio, which is content and not a request signature", async () => {
    // `signature` was on the first draft of the denylist. On a TikTok author it is
    // the account bio — free text, in the local language, exactly what we harvest.
    const fake = fakePage({ state: { author: { signature: "quán ăn Sài Gòn" } } })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(JSON.stringify(capture)).toContain("quán ăn Sài Gòn")
  })

  it("names which wall it hit, because three refusals mean three things", async () => {
    for (const [wall, expected] of [
      ["captcha", "captcha"],
      ["region", "region-block"],
      ["login", "login-wall"],
    ] as const) {
      const fake = fakePage({ wall, state: { some: "data" } })
      const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
      expect(capture.refusedBy).toBe(expected)
    }
  })

  it("archives the bytes of a refusal rather than discarding them", async () => {
    // A refused capture is the most valuable artefact a harvest produces, because
    // it is the evidence for what the viewpoint was refused by.
    const fake = fakePage({ wall: "region", state: { partial: true }, title: "unavailable" })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.refusedBy).toBe("region-block")
    expect(capture.payload.state).toEqual({ partial: true })
    expect(capture.payload.pageTitle).toBe("unavailable")
  })

  it("reports a bounce off the host", async () => {
    const fake = fakePage({ href: "https://www.google.com/sorry/index" })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.refusedBy).toBe("redirected to www.google.com")
  })

  it("refuses a page where neither strategy produced anything", async () => {
    // Not `empty`: a page we cannot read at all is not TikTok saying there is
    // nothing, it is us failing to hear what TikTok said.
    const fake = fakePage({ state: null, title: "TikTok" })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.refusedBy).toContain("no state and no item api response")
  })

  it("does not call zero results a refusal", async () => {
    const fake = fakePage({ state: { ItemModule: {} }, tiles: 0 })
    const capture = await captureTikTok(
      context(fake.page),
      "nothingmatchesthis",
      "search",
      NO_SETTLE,
    )
    expect(capture.refusedBy).toBeUndefined()
  })

  it("records the url after redirects, which is where a bounce is visible", async () => {
    const fake = fakePage({ state: {}, href: "https://www.tiktok.com/login?redirect=search" })
    const capture = await captureTikTok(context(fake.page), "x", "search", NO_SETTLE)
    expect(capture.url).toBe("https://www.tiktok.com/login?redirect=search")
  })

  it("says which surface it was, so one parser can serve both", async () => {
    const fake = fakePage({ state: {} })
    const capture = await captureTikTok(context(fake.page), "", "explore", NO_SETTLE)
    expect(capture.sourceId).toBe("tiktok.explore")
    expect(capture.payload.surface).toBe("explore")
    expect(fake.visited[0]).toContain("/explore")
  })
})
