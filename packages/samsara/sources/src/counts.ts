/**
 * Reading a view count off a page that was rendered for somebody else's locale.
 *
 * YouTube does not put a number in its search response. It puts a *sentence* —
 * `"1.2M views"`, `"1,234 views"`, `"1.2 ล้านครั้ง"`, `"1,2 Tr lượt xem"` — rendered
 * in whatever language the request asked for. Since asking in the local language is
 * the one signal P1.0 measured as dominant, the localised form is not an edge case
 * here; it is the normal case.
 *
 * Two rules, and the second one is the interesting one:
 *
 * 1. A scale word (`M`, `ล้าน`, `Tr`) multiplies. The table below is deliberately
 *    short and explicit rather than clever.
 * 2. **`,` means different things in the two halves of that sentence.** `"1,234"`
 *    in English is one thousand two hundred; `"1,2 Tr"` in Vietnamese is one point
 *    two million. So the separator is read as a decimal point when a scale word is
 *    present and as a group separator when it is not — which is the actual rule
 *    those locales follow, not a heuristic.
 *
 * Anything that does not match returns `null`, and `null` is a real answer: the
 * schema says explicitly that zero is not the same as unknown. A locale-aware
 * parser that guessed would mis-scale by a factor of a hundred on the Thai form
 * (`หมื่น` is ten thousand, not a thousand) and produce a number that looks
 * perfectly reasonable, ranks content, and is wrong. A missing view count is
 * visibly missing. A wrong one is not.
 */

/** Scale words, lowercased. Only forms actually rendered by the target locales. */
const SCALES: ReadonlyArray<readonly [string, number]> = [
  // English, longest first so "b" does not match inside "bn".
  ["bn", 1e9],
  ["b", 1e9],
  ["m", 1e6],
  ["k", 1e3],
  // Thai. `พัน` 1e3, `หมื่น` 1e4, `แสน` 1e5, `ล้าน` 1e6 — a genuine base-10⁴
  // system, which is why guessing at it rather than tabulating it goes wrong.
  ["ล้าน", 1e6],
  ["แสน", 1e5],
  ["หมื่น", 1e4],
  ["พัน", 1e3],
  // Vietnamese, in both the abbreviated and written forms YouTube uses.
  ["tr", 1e6],
  ["triệu", 1e6],
  ["nghìn", 1e3],
  ["ngàn", 1e3],
]

const DIGITS = /(\d[\d.,  ]*)/

/**
 * Parse a rendered count into an integer, or `null` when it cannot be read.
 *
 * Returns a whole number: `"1.2M"` is 1,200,000, not 1,200,000.0000001. Callers
 * store this in an integer column, and a float that arrives there has already been
 * rounded by somebody — better here, where the rounding is visible.
 */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null
  const lower = text.toLowerCase()

  const found = DIGITS.exec(lower)
  const raw = found?.[1]
  if (!raw) return null

  // The scale word must come immediately after the digits, with at most a space
  // between: Thai renders `1.2 ล้านครั้ง` with no space at all, and Vietnamese puts
  // `lượt xem` *after* the scale word. Searching the whole tail instead would let
  // `"3 views by bob"` match `b` and report three billion, which is the kind of
  // wrong number this file exists to avoid producing.
  const rest = lower.slice((found.index ?? 0) + raw.length).trimStart()
  let multiplier = 1
  for (const [word, scale] of SCALES) {
    if (rest.startsWith(word)) {
      multiplier = scale
      break
    }
  }

  const digits = raw.replace(/[  ]/g, "").replace(/[.,]$/, "")
  const value = multiplier === 1 ? readGrouped(digits) : readDecimal(digits)
  if (value === null) return null

  const scaled = value * multiplier
  if (!Number.isFinite(scaled) || scaled < 0) return null
  return Math.round(scaled)
}

/**
 * No scale word, so every separator groups: `1,234,567` and `1.234.567` are the
 * same seven-digit number in different locales. A separator with one or two digits
 * after it is not a group and is refused rather than guessed at — `1,23` is not a
 * number any of these locales writes.
 */
function readGrouped(digits: string): number | null {
  const stripped = digits.replace(/[.,]/g, "")
  if (!/^\d+$/.test(stripped)) return null
  for (const group of digits.split(/[.,]/).slice(1)) {
    if (group.length !== 3) return null
  }
  return Number(stripped)
}

/** A scale word is present, so the separator is a decimal point: `1,2 Tr` → 1.2. */
function readDecimal(digits: string): number | null {
  const normalised = digits.replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null
  const value = Number(normalised)
  return Number.isNaN(value) ? null : value
}
