# ADR-0017: Place resolution is tiered, and Google is not in it

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)
- **Supersedes:** ADR-0007 (Google Places geocoding, Nominatim as fallback)
- **Closes:** the last remaining credit-card exposure in section 8

## Context

ADR-0007 bought Google Places to solve a discovery problem: a place named in Thai script, mentioned
in a caption, with no address — "the noodle shop near Saphan Taksin". Google's index resolves those
and open datasets often do not, so the cost looked unavoidable.

**That premise does not survive the pipeline it sits in.** Discovery happens in the harvest. By the
time anything reaches the resolve stage (P2.3) a locally-situated persona has already read a
regional feed and the extraction step has already decided this place is worth keeping. We are not
asking a geocoder which places exist in Bangkok. We are asking it for a coordinate for a place we
have already chosen. That is a much smaller question, and it is not one Google is uniquely good at.

The cost of getting this wrong is concrete rather than theoretical. Google Places is the only vendor
in the entire system that **bills a credit card by default** once its free credit runs out. Solari
stops when its credit is gone; OpenRouter is prepaid and also stops. Section 8 has been carrying an
open obligation — set a hard quota cap in the Google Cloud console before Phase 2 — purely to
contain that one vendor.

## What "just a pin" hides

One thing must be said plainly, because dropping Google is easy to over-sell. Getting a coordinate
is the easy half. Deciding **which** POI a messy caption refers to — two shops share a name, one is
the branch the poster meant — is entity resolution, and no geocoder does it for us. Google would not
have solved it either. So it should not be what we pay a vendor for, and the tiering below is
ordered by how much *identity* each source carries, not by how precise its coordinates are.

## Decision

Resolution is tiered. Each tier runs only when the one above it returns nothing.

**Tier 0 — the pin is already in the harvest.** Geo-tagged posts carry coordinates. Captions and
bios carry map links and addresses. We are already driving a real browser with a Thai viewpoint
(ADR-0015), and a post about a street stall is exactly the kind that carries a location tag. This
costs nothing, touches no meter, and is *more* accurate than any name lookup, because the author
pinned it themselves. **This is the primary path**, and ADR-0007 did not mention it at all.

**Tier 1 — OpenStreetMap, in our own Postgres.** A named-POI extract for the target city — `name`,
`name:th`, coordinates, category — loaded into the database we already run, matched by trigram
similarity against the normalised mention. No API, no key, no rate limit, no third-party policy to
comply with, and it handles Thai script because OSM carries `name:th`. The extract is refreshed on
a schedule, not per query.

**Tier 2 — a hosted geocoder with a free tier**, for what Tiers 0 and 1 miss:
[LocationIQ](https://locationiq.com/pricing) (5,000/day) or
[Geoapify](https://www.geoapify.com/pricing/) (100,000/month). Chosen at P2.3 by measuring both
against real harvested mentions, per the ADR-0012 principle that the provider is an env var.

**Tier 3 — unresolvable.** A mention that survives all three is marked `unresolvable` and does not
appear on the map. ADR-0008 already says anything without geo is not a marker; this is that rule
holding rather than being escaped by spending money.

## Not the public Nominatim server

ADR-0007 named Nominatim as the fallback and section 8 made it the interim resolver. That safe
harbour is thinner than it looked. The [public Nominatim usage
policy](https://operations.osmfoundation.org/policies/nominatim/) caps scripts that run at regular
intervals at **4 requests per minute**, names systematic querying as grounds for a ban, and tells
services whose core function is geocoding to run their own instance. A nightly harvest resolving a
hundred mentions is precisely the pattern it discourages. We are not entitled to that server, and
building on it would be borrowing from a volunteer-funded project against its stated wishes.

Tier 1 is the honest version of the same idea: the same ODbL data, queried from our own copy.

## Consequences

- **The geocoding allocation drops from ~$5 to $0, and section 8's reserve grows from ~$4 to ~$9.**
  That reserve remains reserve against our own undercount. It is not now available to spend.
- **`geocode.calls` survives as a meter, with a different justification.** It no longer guards a
  bill; it guards a free tier's daily quota and, more usefully, guards *us*: a resolver making more
  than a few hundred hosted calls a day is failing at Tiers 0 and 1, and should be fixed rather than
  fed. The ceiling stays at 800 and its derivation comment in `ceilings.ts` changes accordingly.
- **The Google Cloud quota-cap obligation is closed** by deletion rather than by doing it. No Google
  API key is created, so there is nothing to cap. **No vendor in the system can now bill Aswin's
  card without someone deciding to spend.** That was the point.
- **We now own a data-loading job we did not own before** — fetch a city extract, filter to named
  POIs, load, refresh. That is a real cost of this decision and it lands in Phase 2, not Phase 0.
  It must also stay inside the size the free Supabase tier allows, which is a measurement to take
  at P2.3 rather than a number to assume here.
- **ODbL attribution is now a product requirement**, not just a map-control detail — Tier 1 and
  Tier 2 both serve OSM-derived data. It appears wherever a resolved coordinate is displayed.
- **The `resolve` stage stays generic.** Tiering is a property of the travel pack's `resolve`
  implementation (ADR-0010), not of the pipeline. `@samsara/*` learns nothing about places.

## Alternatives rejected

- **Keeping Google Places behind a hard quota cap.** Defensible, and it was the plan until the
  premise was re-examined. Rejected because the cap contains the damage rather than removing the
  exposure, and because it buys a discovery index for a pipeline that has already discovered.
- **Mapbox Geocoding**, ADR-0007's stated swap point. A better-behaved vendor than Google, and still
  a vendor with a card on file, bought to answer a question Tier 0 usually answers for free.
- **Self-hosting a full Nominatim instance.** Correct for a product with traffic; a heavy import and
  a box to run, to serve a query volume that a trigram index over a filtered POI table handles.
