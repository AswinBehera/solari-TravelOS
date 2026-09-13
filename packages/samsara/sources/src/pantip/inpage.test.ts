/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { type PantipPageRead, readPantipPage, scrollPantipPage } from "./inpage.js"

/**
 * The second file in this package that runs against a real DOM, and it is here for
 * the reason the first one is: this adapter extracts every field inside the browser,
 * so a selector that moved is a billed session rather than a re-parse, and a stub
 * would only test my model of a DOM rather than a DOM.
 *
 * `jsdom` is declared **per file** rather than for the package, so the rest of
 * `@samsara/sources` keeps compiling for a runtime that has no `document`.
 *
 * What it still cannot test is whether these selectors match *Pantip's* markup. The
 * fragments below are my model of it, written without having loaded the page. That
 * is what `nodeCounts` and the stored fragments in the payload are for — and the
 * fragments are the part that is new here: on this source a wrong guess is meant to
 * be correctable from bytes we already hold.
 */

/** Exactly what Playwright does to it: the source crosses, the scope does not. */
function serialised<T>(fn: T): T {
  return new Function(`return (${String(fn)})`)() as T
}

const LIMITS = { maxFragments: 30, fragmentChars: 3_000 }

function render(html: string): void {
  document.body.innerHTML = html
}

/**
 * A listing, with the two details that matter in it: a row's link carries tracking
 * that differs per row, and a class-substring selector has decoys to walk past —
 * `pt-preview` contains the word the view-count selector matches on.
 */
const LISTING = `
  <ul class="pt-list">
    <li class="pt-list-item">
      <a class="pt-list-item__title" href="/topic/43210987?ref=recommend">คาเฟ่แถวอารีย์ ที่นั่งทำงานได้ทั้งวัน</a>
      <a class="pt-list-item__owner" href="/profile/1234567">คุณนักชิม</a>
      <span class="pt-list-item__date">2 ชั่วโมงที่แล้ว</span>
      <span class="pt-preview">พรีวิว</span>
      <span class="pt-list-item__vote">12</span>
      <span class="pt-list-item__comment">34 ความคิดเห็น</span>
      <span class="pt-list-item__view">5.6 หมื่น</span>
      <div class="pt-list-item__detail">ลองมาสามที่ ชอบที่นี่ที่สุด</div>
      <a href="/tag/อารีย์">อารีย์</a>
      <a href="/tag/คาเฟ่">คาเฟ่</a>
    </li>
    <li class="pt-list-item">
      <a class="pt-list-item__title" href="/topic/43210988?ref=tag">กาแฟเย็นแก้วไหนอร่อยสุด</a>
      <span class="pt-list-item__vote">3</span>
    </li>
  </ul>
`

/**
 * A topic, laid out the way Pantip lays one out: the opening post's byline sits
 * *beside* its body rather than inside it, and a reply is anchored by an `id` that
 * a second, looser selector also matches.
 */
const TOPIC = `
  <div class="display-post-wrapper-inner">
    <a class="display-post-name owner" href="/profile/1234567">คุณนักชิม</a>
    <abbr title="2026-09-10 09:12:00">3 วันที่แล้ว</abbr>
    <div class="display-post-story">
      เดินหาที่นั่งทำงานแถวอารีย์มาทั้งวัน
      <img src="https://f.ptcdn.info/story-one.jpg">
    </div>
    <span class="like-vote">21</span>
  </div>
  <div id="comment-1" class="display-post-wrapper comment-item">
    <a class="display-post-name" href="/profile/7654321">
      <img src="https://f.ptcdn.info/avatar-of-a-person.jpg">
      คุณกาแฟดำ
    </a>
    <abbr title="2026-09-10 11:30:00">3 วันที่แล้ว</abbr>
    <div class="display-post-story">กาแฟที่นี่ดีมาก นั่งได้ยาว ๆ</div>
    <span class="like-vote">4</span>
  </div>
  <div id="comment-2" class="display-post-wrapper comment-item">
    <div class="display-post-story">เห็นด้วยครับ</div>
  </div>
`

describe("what crosses into the page", () => {
  /**
   * The rule every in-page function in this package lives under, asserted rather
   * than trusted. TikTok paid two billed sessions to establish it: the bundler
   * rewrites a named inner function as `__name(fn, "…")`, and `__name` lives at
   * module scope, which does not cross.
   */
  for (const fn of [readPantipPage, scrollPantipPage]) {
    it(`${fn.name} declares no function of its own`, () => {
      const source = String(fn).slice(String(fn).indexOf("{"))
      expect(source).not.toMatch(/\bfunction\b/)
      expect(source).not.toContain("=>")
      expect(source).not.toContain("__name")
    })
  }

  it("survives serialisation and re-parsing through toString", () => {
    render(LISTING)
    expect(serialised(readPantipPage)(LIMITS).topics).toHaveLength(2)
  })

  it("takes its limits as an argument rather than closing over them", () => {
    // The whole reason the limits are a parameter: a module-scope constant read
    // inside an evaluated function is `undefined` in the page, and the failure
    // arrives on a clock that is already billing.
    render(LISTING)
    const read = serialised(readPantipPage)({ maxFragments: 1, fragmentChars: 20 })
    expect(read.fragmentsStored).toBe(1)
    expect(read.topics[0]?.fragment).toHaveLength(20)
    expect(read.topics[1]?.fragment).toBeNull()
  })
})

describe("reading a listing", () => {
  it("finds one row per topic link and keeps the link verbatim", () => {
    // Verbatim, tracking and all: turning `/topic/43210987?ref=recommend` into an
    // identity is `parse.ts`'s job, and doing it here would cost a session to undo.
    render(LISTING)
    const read = readPantipPage(LIMITS)
    expect(read.topics).toHaveLength(2)
    expect(read.topics[0]?.href).toBe("/topic/43210987?ref=recommend")
    expect(read.nodeCounts['a[href*="/topic/"]']).toBe(2)
  })

  it("copies the localised counts as strings and reads none of them", () => {
    render(LISTING)
    const [row] = readPantipPage(LIMITS).topics
    expect(row?.voteLabel).toBe("12")
    expect(row?.commentLabel).toBe("34 ความคิดเห็น")
    expect(row?.viewLabel).toBe("5.6 หมื่น")
  })

  it("walks past a decoy that matches the selector but holds no number", () => {
    // `pt-preview` contains the string the view selector matches on. Taking the
    // first match would have filed the word "พรีวิว" as a view count; requiring a
    // digit is a rule about which node to copy, not a reading of what it says.
    render(LISTING)
    expect(readPantipPage(LIMITS).topics[0]?.viewLabel).toBe("5.6 หมื่น")
  })

  it("reads the author and the tags the row printed", () => {
    render(LISTING)
    const [row] = readPantipPage(LIMITS).topics
    expect(row?.authorName).toBe("คุณนักชิม")
    expect(row?.authorHref).toBe("/profile/1234567")
    expect(row?.tagLabels).toEqual(["อารีย์", "คาเฟ่"])
    expect(row?.timeLabel).toBe("2 ชั่วโมงที่แล้ว")
  })

  it("returns nulls rather than guesses for a row that printed nothing", () => {
    render(LISTING)
    const row = readPantipPage(LIMITS).topics[1]
    expect(row?.title).toBe("กาแฟเย็นแก้วไหนอร่อยสุด")
    expect(row?.viewLabel).toBeNull()
    expect(row?.commentLabel).toBeNull()
    expect(row?.authorName).toBeNull()
    expect(row?.tagLabels).toEqual([])
  })

  it("stores the markup each row came from", () => {
    // The dividend this source pays and the others do not. A wrong selector above
    // is a re-parse of bytes already held rather than another browser session.
    render(LISTING)
    const read = readPantipPage(LIMITS)
    expect(read.fragmentsStored).toBe(2)
    expect(read.topics[0]?.fragment).toContain("pt-list-item__view")
  })

  it("keeps scripts out of a stored fragment", () => {
    // The markup around a row is content. An inline script inside it is where a
    // token would be, and it is removed in the page rather than on the way out.
    render(`<li class="row"><a href="/topic/1">x</a><script>var csrf="secret"</script></li>`)
    const [row] = readPantipPage(LIMITS).topics
    expect(row?.fragment).not.toContain("secret")
    expect(row?.fragment).toContain("/topic/1")
  })
})

describe("reading a topic", () => {
  it("widens the opening post to the box its byline is in", () => {
    // `display-post-story` is the writing; the name and the time sit beside it. A
    // fragment cropped to the body could not repay what the fragment is for.
    render(TOPIC)
    const [opening] = readPantipPage(LIMITS).posts
    expect(opening?.role).toBe("opening")
    expect(opening?.authorName).toBe("คุณนักชิม")
    expect(opening?.timeLabel).toBe("3 วันที่แล้ว")
    expect(opening?.voteLabel).toBe("21")
    expect(opening?.text).toContain("เดินหาที่นั่งทำงานแถวอารีย์")
  })

  it("does not store the opening post twice as a reply of itself", () => {
    // Its wrapper is called `display-post-wrapper-inner`, which is also how a reply
    // is named. Overlap in either direction is one post, not two.
    render(TOPIC)
    const read = readPantipPage(LIMITS)
    expect(read.posts).toHaveLength(3)
    expect(read.posts.filter((post) => post.role === "opening")).toHaveLength(1)
  })

  it("anchors a reply by the id Pantip gave it, once", () => {
    render(TOPIC)
    const replies = readPantipPage(LIMITS).posts.filter((post) => post.role === "reply")
    expect(replies.map((reply) => reply.postId)).toEqual(["comment-1", "comment-2"])
    expect(replies[0]?.text).toBe("กาแฟที่นี่ดีมาก นั่งได้ยาว ๆ")
  })

  it("collects the post's image and not the author's face", () => {
    render(TOPIC)
    const posts = readPantipPage(LIMITS).posts
    expect(posts[0]?.mediaRefs).toEqual(["https://f.ptcdn.info/story-one.jpg"])
    expect(posts[1]?.mediaRefs).toEqual([])
  })

  it("reads the listing on a topic page too", () => {
    // A topic capture holding thirty listing rows and no posts never left the
    // board, which is a different bug from a topic that would not load. Reading
    // both costs nothing and is what makes them distinguishable in the artifact.
    render(LISTING + TOPIC)
    const read = readPantipPage(LIMITS)
    expect(read.topics).toHaveLength(2)
    expect(read.posts.length).toBeGreaterThan(0)
  })
})

describe("what it refuses to press", () => {
  it("counts a pager candidate instead of clicking one", () => {
    // A selector loose enough to find an unseen "more comments" control is loose
    // enough to press something else. The next capture says what it is called.
    render(`
      <div class="comment-footer"><button class="btn-more">ดูความคิดเห็นเพิ่มเติม</button></div>
      <button class="show-more">อีก</button>
    `)
    let clicks = 0
    for (const button of document.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        clicks += 1
      })
    }
    // Two, not three: the three selectors overlap on the first button and
    // `querySelectorAll` returns a set of elements, so this counts controls rather
    // than matches — which is the number worth reading off a capture.
    expect(readPantipPage(LIMITS).nodeCounts["pager candidate"]).toBe(2)
    expect(clicks).toBe(0)
  })
})

describe("the blob and the walls", () => {
  it("stores the blob as a truncated string and says how long it really was", () => {
    const big = { rows: Array.from({ length: 30_000 }, (_, i) => `row-${i}`) }
    ;(window as unknown as Record<string, unknown>).__NEXT_DATA__ = big
    render(LISTING)
    const read = readPantipPage(LIMITS)
    expect(read.stateKeys).toContain("__NEXT_DATA__")
    expect(read.stateLength).toBe(JSON.stringify(big).length)
    expect(read.state).toHaveLength(200000)
    ;(window as unknown as Record<string, unknown>).__NEXT_DATA__ = undefined
  })

  it("falls back to the script tag, which is where Next.js usually puts it", () => {
    render(`<script id="__NEXT_DATA__" type="application/json">{"props":{"n":1}}</script>`)
    const read = readPantipPage(LIMITS)
    expect(read.stateKeys).toEqual(["script#__NEXT_DATA__"])
    expect(read.state).toBe(`{"props":{"n":1}}`)
  })

  it("reports what the blob might be called when every guess was wrong", () => {
    // P1.5 paid a session to learn that a diagnostic reporting only which guesses
    // were right stops one question short of the useful one. Names, never values.
    ;(window as unknown as Record<string, unknown>).PANTIP_BOOTSTRAP = { secret: "x" }
    render(LISTING)
    const read = readPantipPage(LIMITS)
    expect(read.stateKeys).toEqual([])
    expect(read.stateCandidates).toContain("PANTIP_BOOTSTRAP")
    expect(JSON.stringify(read.stateCandidates)).not.toContain("secret")
    ;(window as unknown as Record<string, unknown>).PANTIP_BOOTSTRAP = undefined
  })

  it("names the wall rather than reporting that there is one", () => {
    render(`<div id="cf-wrapper"></div>`)
    expect(readPantipPage(LIMITS).wall).toBe("captcha")
    render(`<form><input type="password" name="pass"></form>`)
    expect(readPantipPage(LIMITS).wall).toBe("login")
    render(LISTING)
    expect(readPantipPage(LIMITS).wall).toBeNull()
  })
})

describe("the shape of a read", () => {
  it("is the interface capture.ts consumes", () => {
    render(LISTING)
    const read: PantipPageRead = readPantipPage(LIMITS)
    expect(Object.keys(read).sort()).toEqual(
      [
        "fragmentsStored",
        "href",
        "nodeCounts",
        "posts",
        "state",
        "stateCandidates",
        "stateKeys",
        "stateLength",
        "title",
        "topics",
        "wall",
      ].sort(),
    )
  })

  it("scrolls the document and reports the height it reached", () => {
    // jsdom has no layout and therefore no `scrollTo`. Stubbed rather than skipped:
    // the assertion is about what the function reaches for, not about a pixel.
    let scrolled = false
    window.scrollTo = () => {
      scrolled = true
    }
    render(LISTING)
    expect(scrollPantipPage()).toBe(document.body.scrollHeight)
    expect(scrolled).toBe(true)
  })
})
