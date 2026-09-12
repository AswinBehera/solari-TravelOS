/**
 * Two IANA zone ids can name the same zone. `Asia/Ho_Chi_Minh` and `Asia/Saigon`
 * are one zone under two spellings — the first is IANA's canonical id since 2016,
 * the second is the older name kept as a link — and ICU, which is what every
 * browser and Node build resolves through, answers with the *older* one. So a
 * viewpoint launched with the canonical spelling comes back from the page wearing
 * the other, and a string comparison reports that the viewpoint failed to land
 * when it landed perfectly.
 *
 * Found live in P0.8, by the only test that asks a real page what it sees. It is
 * not a test detail: "did the viewpoint actually reach the page" is a check every
 * adapter after P1.0 has to make, and it is the check that decides whether an
 * Observation is interpretable. Getting it wrong in the direction of a false
 * negative is the expensive direction — it discards good data and sends someone
 * hunting a proxy bug that does not exist.
 *
 * The canonicaliser is `Intl` itself rather than a table we maintain: the aliases
 * change with the tzdb, and a hand-written map is a table that silently goes stale.
 * Whatever the runtime resolves through is also what the page resolves through,
 * which is the comparison we actually want.
 */

/**
 * The spelling this runtime's ICU uses for `id`, or `id` unchanged if it is not a
 * zone ICU knows. Never throws: callers are usually comparing, and a comparison
 * that throws on bad input is a comparison with a second failure mode.
 */
export function canonicalTimezoneId(id: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: id }).resolvedOptions().timeZone
  } catch {
    return id
  }
}

/** True when both ids name the same zone, whichever spelling each one uses. */
export function sameTimezone(a: string, b: string): boolean {
  return canonicalTimezoneId(a) === canonicalTimezoneId(b)
}
