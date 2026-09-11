/**
 * The provider's residential proxy pool, as it actually is.
 *
 * Read from a live 400 on 11 September 2026, not from documentation:
 *
 *   POST /sessions -> 400 {"error":"Unsupported proxy country","country":"th",
 *     "supported":["au","br","ca","de","es","fr","gb","in","it","jp","kr",
 *                  "mx","nl","sg","us"]}
 *
 * **This list does not include `th`.** Plan section 1.4 names Bangkok as the first
 * city, so the premise that a persona can browse from a Thai address is not
 * available on this provider today. That is a product question (see section 10),
 * not something the kernel can paper over — and the kernel's job is to make it
 * fail immediately, by name, instead of at a launch that has already cost a round
 * trip.
 *
 * `jp` is present, which is why section 1.4's second city (Tokyo) is unaffected.
 *
 * Re-check before Phase 1: pools change, and this is the sort of list that gains
 * a country quietly. The check that reads it is one line; the list is the part
 * that goes stale.
 */
export const SUPPORTED_PROXY_COUNTRIES = [
  "au",
  "br",
  "ca",
  "de",
  "es",
  "fr",
  "gb",
  "in",
  "it",
  "jp",
  "kr",
  "mx",
  "nl",
  "sg",
  "us",
] as const

export type SupportedProxyCountry = (typeof SUPPORTED_PROXY_COUNTRIES)[number]

export const isSupportedProxyCountry = (country: string): country is SupportedProxyCountry =>
  (SUPPORTED_PROXY_COUNTRIES as readonly string[]).includes(country)

/**
 * Nearest available egress for a country the pool does not carry.
 *
 * Deliberately sparse and deliberately not clever: a wrong guess here silently
 * changes what content a persona sees, which is the one thing the Persona Lab
 * exists to measure. Callers must opt in explicitly; nothing substitutes a
 * country automatically.
 */
export const NEAREST_AVAILABLE: Readonly<Record<string, SupportedProxyCountry>> = {
  /** Thailand -> Singapore. Same region, ~1,400km, the closest the pool offers. */
  th: "sg",
  /** Vietnam, Malaysia, Indonesia, Philippines -> Singapore, for the same reason. */
  vn: "sg",
  my: "sg",
  id: "sg",
  ph: "sg",
}
