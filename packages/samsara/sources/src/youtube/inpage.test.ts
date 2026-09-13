import { afterEach, describe, expect, it } from "vitest"
import { type PageRead, readInitialData } from "./inpage.js"

/**
 * The two rules that hold for any page, asserted here so they are not comments.
 *
 * `tiktok/inpage.test.ts` explains at length what these cost to learn. The short
 * version: a function handed to `page.evaluate` crosses as source and nothing
 * else, so it may not reference module scope — and it may not declare a function
 * of its own either, because the bundler rewrites named functions as
 * `__name(fn, "…")` and `__name` is module scope. Nothing about that is specific
 * to TikTok, which is why it is checked on both adapters rather than on the one
 * that happened to pay for it.
 */

function body(fn: () => unknown): string {
  const source = fn.toString()
  return source
    .slice(source.indexOf("{"))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
}

/** Exactly what the provider does with it: keep the source, drop the scope. */
function serialised(): () => PageRead {
  return new Function(`return (${readInitialData.toString()})`)() as () => PageRead
}

class FakeNode {}

const saved = new Map<string, unknown>()

function install(globals: Record<string, unknown>, scripts: string[] = []) {
  const document = {
    querySelector: () => null,
    querySelectorAll: () => scripts.map((textContent) => ({ textContent })),
    title: "YouTube",
  }
  for (const [key, value] of [
    ["window", globals],
    ["document", document],
    ["location", { href: "https://www.youtube.com/results?search_query=x" }],
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

describe("readInitialData", () => {
  it("declares no function of its own", () => {
    const source = body(readInitialData)
    expect(source).not.toMatch(/=>/)
    expect(source).not.toMatch(/\bfunction\b/)
    expect(source).not.toMatch(/\bclass\b/)
  })

  it("carries no bundler helper into the page", () => {
    expect(readInitialData.toString()).not.toContain("__name")
  })

  it("runs with nothing but browser globals", () => {
    install({ ytInitialData: { contents: {} } })
    expect(serialised()().data).toEqual({ contents: {} })
  })

  it("falls back to the inline script when the global is missing", () => {
    install({}, ['var ytInitialData = {"contents":{"a":1}};'])
    expect(serialised()().data).toEqual({ contents: { a: 1 } })
  })

  it("will not accept a DOM node as data", () => {
    // The trap that caught TikTok: an element with an id is a global of that name,
    // and an element is truthy. YouTube does not do that today. The guard is for
    // the day it does, which nobody gets told about in advance.
    install({ ytInitialData: new FakeNode() })
    expect(serialised()().data).toBeNull()
  })
})
