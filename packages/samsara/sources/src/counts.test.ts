import { describe, expect, it } from "vitest"
import { parseCount } from "./counts.js"

describe("parseCount", () => {
  it("reads the plain English forms", () => {
    expect(parseCount("1,234 views")).toBe(1234)
    expect(parseCount("1.2M views")).toBe(1_200_000)
    expect(parseCount("15K views")).toBe(15_000)
    expect(parseCount("2.4B views")).toBe(2_400_000_000)
    expect(parseCount("847 views")).toBe(847)
  })

  it("reads the Thai scale words, which are base ten-thousand", () => {
    // The reason the table is explicit. A parser that assumed every scale word
    // above a thousand meant a million would report this one a hundred times too
    // large, and nothing downstream would notice.
    expect(parseCount("1.2 ล้านครั้ง")).toBe(1_200_000)
    expect(parseCount("3 แสนครั้ง")).toBe(300_000)
    expect(parseCount("5 หมื่นครั้ง")).toBe(50_000)
    expect(parseCount("8 พันครั้ง")).toBe(8_000)
  })

  it("reads a Vietnamese comma as a decimal point, not a group separator", () => {
    // The whole reason the two readers are separate. `1,2` next to a scale word is
    // one point two; `1,200` on its own is twelve hundred. Same character.
    expect(parseCount("1,2 Tr lượt xem")).toBe(1_200_000)
    expect(parseCount("1,200 lượt xem")).toBe(1_200)
    expect(parseCount("15 nghìn lượt xem")).toBe(15_000)
  })

  it("treats a dot as a group separator when nothing scales it", () => {
    expect(parseCount("1.234.567 lượt xem")).toBe(1_234_567)
  })

  it("refuses a separator that groups nothing", () => {
    // `1,23` is not a number any of these locales writes, so it is far more likely
    // to be a string this parser does not understand than a count worth storing.
    expect(parseCount("1,23 views")).toBeNull()
  })

  it("returns null rather than a guess", () => {
    expect(parseCount("")).toBeNull()
    expect(parseCount(null)).toBeNull()
    expect(parseCount(undefined)).toBeNull()
    expect(parseCount("No views")).toBeNull()
    expect(parseCount("ไม่มียอดดู")).toBeNull()
  })

  it("does not confuse zero with unknown", () => {
    expect(parseCount("0 views")).toBe(0)
  })

  it("always returns a whole number", () => {
    // The column is an integer. Rounding here is visible; rounding at the driver
    // is not.
    const value = parseCount("1.25M views")
    expect(value).toBe(1_250_000)
    expect(Number.isInteger(value)).toBe(true)
  })

  it("handles the narrow space YouTube renders between digits and unit", () => {
    expect(parseCount("1 234 567 views")).toBe(1_234_567)
  })
})

describe("parseCount, the tail", () => {
  it("does not find a scale word in prose after the count", () => {
    // `" b"` appears in this string. Before the tail was anchored, it scaled the
    // answer by a billion.
    expect(parseCount("3 views by bob")).toBe(3)
    expect(parseCount("12 views, uploaded by a k-pop channel")).toBe(12)
  })
})

describe("parseCount, the word that starts with a scale word", () => {
  /**
   * Found by a Maps review count in the language this project targets, not by a
   * test written to probe the rule. `231 bài đánh giá` came back as 231 billion,
   * because the tail is anchored — which the test above establishes — but `b` is a
   * whole scale word and `bài` starts with it.
   *
   * The answer being wrong by a factor of a billion is the lucky version. The same
   * collision on `m`, `k` or `tr` produces a number that looks plausible, ranks
   * content, and is never questioned. That is the failure `counts.ts` exists to
   * avoid, so the gap was worth closing where the table lives rather than in the
   * adapter that tripped over it.
   */
  it("does not read a Vietnamese word as an English abbreviation", () => {
    expect(parseCount("231 bài đánh giá")).toBe(231)
    expect(parseCount("12 bình luận")).toBe(12)
    expect(parseCount("5 món")).toBe(5)
  })

  it("still scales when the word really is the scale word", () => {
    expect(parseCount("1.2M views")).toBe(1_200_000)
    expect(parseCount("3bn views")).toBe(3_000_000_000)
    expect(parseCount("1,2 Tr lượt xem")).toBe(1_200_000)
    expect(parseCount("4 triệu lượt xem")).toBe(4_000_000)
  })

  it("leaves Thai alone, which is written without the boundary this rule uses", () => {
    // `1.2 ล้านครั้ง` has a letter immediately after the scale word and is correct.
    // A general boundary rule would have broken the language the table was written
    // for, which is why the rule applies to Latin-script entries only.
    expect(parseCount("1.2 ล้านครั้ง")).toBe(1_200_000)
    expect(parseCount("3 หมื่นครั้ง")).toBe(30_000)
  })
})
