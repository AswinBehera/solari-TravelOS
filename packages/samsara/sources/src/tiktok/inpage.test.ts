import { afterEach, describe, expect, it } from "vitest"
import { readTikTokState } from "./inpage.js"

/**
 * A stub, and honest about being one.
 *
 * `capture.test.ts` says a fake document would test my model of a DOM rather than
 * a DOM, and that remains true of anything this file could assert about how TikTok
 * lays out a page. It stopped being a reason not to test *this* function on the
 * day the first live capture came back holding the string `ref: <Node>`, because
 * the bug was not in a model of TikTok's DOM — it was in a rule of HTML that is
 * identical on every page ever written: an element with an `id` is reachable as a
 * global of the same name, so reading `window.SIGI_STATE` before the tag gets you
 * the tag itself, wrapped in a truthy object that silences every check downstream.
 *
 * So the stub models exactly two things — named access, and `instanceof Node` —
 * and claims nothing else. What the parser does with a real page is the fixture
 * test's job.
 */

class FakeNode {}

interface Stub {
  tags?: Record<string, string>
  globals?: Record<string, unknown>
  title?: string
  href?: string
  text?: string
}

const saved = new Map<string, unknown>()

function install(stub: Stub) {
  const tags = stub.tags ?? {}
  const elements: Record<string, FakeNode & { textContent: string }> = {}
  for (const [id, textContent] of Object.entries(tags)) {
    elements[id] = Object.assign(new FakeNode(), { textContent })
  }

  // Named access on `window`: every element with an id is also a global of that
  // name, unless a script has assigned a real property over it. That rule is the
  // whole reason this test exists.
  const globals: Record<string, unknown> = { ...elements, ...(stub.globals ?? {}) }

  const document = {
    getElementById: (id: string) => elements[id] ?? null,
    title: stub.title ?? "TikTok",
    body: { innerText: stub.text ?? "" },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
  }

  for (const [key, value] of [
    ["window", { ...globals }],
    ["document", document],
    ["location", { href: stub.href ?? "https://www.tiktok.com/search?q=x" }],
    ["Node", FakeNode],
  ] as const) {
    saved.set(key, (globalThis as Record<string, unknown>)[key])
    ;(globalThis as Record<string, unknown>)[key] = value
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
    else (globalThis as Record<string, unknown>)[key] = value
  }
  saved.clear()
})

describe("readTikTokState", () => {
  it("reads the script tag, not the global of the same name", () => {
    // No `globals` entry: the only thing named `__UNIVERSAL_DATA_FOR_REHYDRATION__`
    // is the tag, which is precisely the live case. The first version of this
    // function returned the element here and called it state.
    install({ tags: { __UNIVERSAL_DATA_FOR_REHYDRATION__: '{"__DEFAULT_SCOPE__":{"a":1}}' } })
    const read = readTikTokState()
    expect(read.state).toEqual({ __DEFAULT_SCOPE__: { a: 1 } })
  })

  it("never returns a DOM node as state, even when nothing else is there", () => {
    install({ globals: { SIGI_STATE: new FakeNode() } })
    expect(readTikTokState().state).toBeNull()
  })

  it("falls back to the global when the tag is not json", () => {
    // Both halves are real: `SIGI_STATE` has been a tag holding JSON and a script
    // assigning a live object, in different years.
    install({
      tags: { SIGI_STATE: "window.SIGI_STATE = {}" },
      globals: { SIGI_STATE: { ItemModule: { "1": {} } } },
    })
    expect(readTikTokState().state).toEqual({ ItemModule: { "1": {} } })
  })

  it("treats an empty object as no state, because it is", () => {
    install({ tags: { SIGI_STATE: "{}" } })
    expect(readTikTokState().state).toBeNull()
  })

  it("prefers the newer name when both are present", () => {
    install({
      tags: {
        __UNIVERSAL_DATA_FOR_REHYDRATION__: '{"new":true}',
        SIGI_STATE: '{"old":true}',
      },
    })
    expect(readTikTokState().state).toEqual({ new: true })
  })
})
