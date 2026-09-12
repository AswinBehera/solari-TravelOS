import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  blankComments,
  checkSeam,
  formatReport,
  MAX_ALLOWS,
  type SeamReport,
  scanSource,
  segments,
} from "./check-seam.js"

/**
 * PLAN §0.7 asks for the check to be tested both ways: a fixture with a forbidden
 * word fails, and the real tree passes. Both are here, and the second one is the
 * more valuable of the two — it is the assertion that turns a convention into a
 * property, and the one that will fail on somebody else's branch six months from now.
 */

const ts = (source: string) => scanSource("fake.ts", source, { stripComments: true })
const terms = (source: string) => ts(source).hits.map((h) => h.term)

const root = resolve(import.meta.dirname, "..")
const temps: string[] = []
function fixtureTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seam-"))
  temps.push(dir)
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe("the real tree", () => {
  it("passes", () => {
    const report = checkSeam(root)
    expect(report.hits).toEqual([])
    expect(report.badImports).toEqual([])
    expect(report.badDependencies).toEqual([])
    expect(report.errors).toEqual([])
    expect(formatReport(report).ok).toBe(true)
  })

  it("actually scanned something", () => {
    // A check that silently walks an empty directory passes forever. This is the
    // assertion that catches a renamed folder or a broken walk.
    expect(checkSeam(root).filesScanned).toBeGreaterThan(20)
  })
})

describe("the unambiguous half of the lexicon", () => {
  it("catches a travel word in code", () => {
    expect(terms('const hotelId = "x"')).toContain("hotel")
  })

  it("catches one in a string literal, because a prompt is code", () => {
    expect(terms('const p = "rank these hotels by walkability"')).toContain("hotel")
  })

  it("catches one in a comment, because that is where the engine leaks first", () => {
    // The case that made the two-tier split necessary: the engine's own comments
    // explaining a data table in terms of the product's first city.
    expect(terms("// the plan names Bangkok as the first city")).toContain("bangkok")
  })
})

describe("the ordinary-English half", () => {
  it("catches it as an identifier", () => {
    expect(terms("const placeId = 1")).toContain("place")
    expect(terms("const t = { trip: 1 }")).toContain("trip")
  })

  it("does not catch it as prose", () => {
    expect(terms("// one round trip, not two")).toEqual([])
    expect(terms("// cancelled mid-flight")).toEqual([])
    expect(terms("/* the only place this happens */")).toEqual([])
  })
})

describe("segment matching", () => {
  it("sees inside camelCase and snake_case", () => {
    expect(segments("resolvePlaceId")).toContain("place")
    expect(segments("place_id")).toContain("place")
    expect(segments("Asia/Bangkok")).toContain("bangkok")
  })

  it("does not fire on a word that merely contains one", () => {
    // `\btravel\b` would miss `travelPack`; a substring match would flag `replace`
    // and `displacement`. Segment matching is the only rule that gets both right.
    expect(terms("s.replace(/a/, 'b')")).toEqual([])
    expect(terms("const displacement = 1")).toEqual([])
    expect(terms("const travelPack = 1")).toContain("travel")
  })

  it("folds a simple plural", () => {
    expect(terms("const places = []")).toContain("place")
  })
})

describe("comment blanking", () => {
  it("is not fooled by a URL", () => {
    // The bug this exists to prevent: a naive strip cuts the line at the `//` in
    // `https://` and stops looking, so anything after a URL is invisible.
    const src = 'const u = "https://example.com/x"; const hotelId = 1'
    expect(blankComments(src)).toContain("hotelId")
    expect(terms(src)).toContain("hotel")
  })

  it("keeps template literals and their interpolations", () => {
    // These strings are TypeScript source under test, not strings that forgot to
    // be templates.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source under test
    expect(terms("const q = `find a ${kind} hotel`")).toContain("hotel")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source under test
    expect(terms("const q = `${a} // not a comment ${placeId}`")).toContain("place")
  })

  it("keeps line and column numbers aligned", () => {
    const hits = ts("// prose\n/* block */\nconst hotelId = 1").hits
    expect(hits[0]?.line).toBe(3)
  })
})

describe("the escape hatch", () => {
  it("suppresses the line and is counted", () => {
    const r = ts("const hotelId = 1 // seam:allow provider field name, not ours")
    expect(r.hits).toEqual([])
    expect(r.allows).toHaveLength(1)
    expect(r.allows[0]?.used).toBe(true)
    expect(r.allows[0]?.reason).toBe("provider field name, not ours")
  })

  it("demands a reason", () => {
    const r = ts("const hotelId = 1 // seam:allow")
    expect(r.errors.join()).toContain("needs a reason")
  })

  it("rejects one that suppresses nothing", () => {
    // Otherwise allows accumulate as dead comments and the count against the
    // ceiling stops describing anything real.
    const r = ts("const x = 1 // seam:allow leftover from a rename")
    expect(r.errors.join()).toContain("suppresses nothing")
  })

  it("fails above the ADR-0009 ceiling", () => {
    const allow = (line: number) => ({ file: "f.ts", line, reason: "r", used: true })
    const base: SeamReport = {
      filesScanned: 1,
      hits: [],
      allows: [],
      badDependencies: [],
      badImports: [],
      errors: [],
    }
    const at = (n: number) =>
      formatReport({ ...base, allows: Array.from({ length: n }, (_, i) => allow(i)) })
    expect(at(MAX_ALLOWS).ok).toBe(true)
    expect(at(MAX_ALLOWS + 1).ok).toBe(false)
    expect(at(MAX_ALLOWS + 1).text).toContain("Redesign it")
  })
})

describe("dependency direction", () => {
  it("fails on a travel-scope dependency in an engine package.json", () => {
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({
        name: "@samsara/fake",
        dependencies: { "@dt/db": "workspace:*" },
      }),
      "packages/samsara/fake/src/index.ts": "export const x = 1\n",
    })
    const report = checkSeam(dir)
    expect(report.badDependencies).toEqual([
      { file: "packages/samsara/fake/package.json", dependency: "@dt/db" },
    ])
    expect(formatReport(report).ok).toBe(false)
  })

  it("fails on a travel-scope import the lexicon could never see", () => {
    // `@dt/db` contains no forbidden word. Without this check the engine could
    // import the whole product and the lexicon would report a clean tree.
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({ name: "@samsara/fake" }),
      "packages/samsara/fake/src/index.ts": 'import { db } from "@dt/db"\nexport const x = db\n',
    })
    const report = checkSeam(dir)
    expect(report.hits).toEqual([])
    expect(report.badImports).toHaveLength(1)
    expect(report.badImports[0]?.line).toBe(1)
    expect(formatReport(report).ok).toBe(false)
  })

  it("does not fire on a comment that merely mentions the scope", () => {
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({ name: "@samsara/fake" }),
      "packages/samsara/fake/src/index.ts": '// never import from "@dt/db"\nexport const x = 1\n',
    })
    expect(checkSeam(dir).badImports).toEqual([])
  })
  it("sees a city name written in Thai, which segmentation erases", () => {
    // The regression this tier exists for. `segments` splits on [^A-Za-z0-9]+, so
    // before FORBIDDEN_SUBSTRINGS this line scanned as an empty list of words and
    // the file passed clean — a banned proper noun, in the tier scanned everywhere.
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({ name: "@samsara/fake" }),
      "packages/samsara/fake/src/index.ts": 'export const q = "ที่เที่ยวกรุงเทพ"\n',
    })
    const report = checkSeam(dir)
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0]?.term).toBe("กรุงเทพ")
  })

  it("sees the Vietnamese spelling whatever its case", () => {
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({ name: "@samsara/fake" }),
      "packages/samsara/fake/src/index.ts": "// the plan starts in Hà Nội\nexport const x = 1\n",
    })
    expect(checkSeam(dir).hits.map((h) => h.term)).toEqual(["hà nội"])
  })

  it("leaves ordinary non-Latin text alone", () => {
    // The tier must not become "any Thai string is suspicious". A greeting is not
    // domain vocabulary, and an engine test is allowed to prove UTF-8 survives.
    const dir = fixtureTree({
      "packages/samsara/fake/package.json": JSON.stringify({ name: "@samsara/fake" }),
      "packages/samsara/fake/src/index.ts": 'export const q = "สวัสดีชาวโลก"\n',
    })
    expect(checkSeam(dir).hits).toEqual([])
  })
})
