# ADR-0007: Google Places for geocoding, Nominatim as fallback

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

A Postcard without coordinates does not appear on the map (section 3.2), so resolution quality is
directly visible in the product. The hard case is a place named in native script, mentioned in a
TikTok caption, with no address — "the noodle shop near Saphan Taksin" in Thai. Google's index
resolves those; open datasets often do not.

Geocoding is also the third budget meter (section 8), which means it is refused when exhausted
rather than silently retried.

## Decision

Google Places API — Text Search to resolve a name to a candidate, Details to canonicalise it —
with Nominatim as a fallback for the cases Google misses or for when the meter is close to its
ceiling. Resolution happens once per entity and is cached on the `Place` row by `googlePlaceId`.

## Consequences

- Resolution is a per-entity cost, not a per-mention cost, which is what keeps the meter's 800-call
  ceiling plausible.
- **Unaffected by the Thai egress finding** (section 1.4): Places resolves Thai-script names from
  anywhere, because it is an API call, not a browsing session. The two are independent problems.
- Cost: Google's pricing changes and its free credit has been restructured before. Section 8 states
  the ceiling as a **count**, with the rate it was derived from in a comment.

## Open before Phase 2

Re-read Google's current Places pricing and free-tier credit, and re-derive the 800-call ceiling
from it. The number in section 8 was derived from a rate that must be confirmed before the meter
means anything.

## Swap point

Mapbox Geocoding, if Places pricing hurts. Nominatim alone is not sufficient for native-script
resolution and is a fallback, not an alternative.
