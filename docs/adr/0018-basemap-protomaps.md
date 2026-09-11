# ADR-0018: The basemap is a PMTiles file we host

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)
- **Amends:** ADR-0008 (MapLibre GL for the map), which left the tile provider as a later choice

## Context

ADR-0008 chose MapLibre and explicitly deferred where the vector tiles come from, noting only that
the provider is "not metered in section 8 because it is not priced per call at this volume". That
deferral is now the last unbooked dependency on a map vendor, and ADR-0017 just removed the others.

## Decision

[Protomaps](https://docs.protomaps.com/deploy/cloudflare): a single `.pmtiles` extract of the target
region, stored as a Cloudflare static asset or in R2, read directly by MapLibre over HTTP range
requests. No tile server, no API key, no per-tile billing, no account with anyone.

## Consequences

- **No third map vendor**, which is the same shape as ADR-0014 (no Redis) and ADR-0017 (no Google):
  a dependency removed rather than a cheaper version of it bought.
- **Tile freshness becomes a job we run.** A basemap is a file we rebuild deliberately, not a stream
  that updates itself. For a demo this is a feature; the map cannot change under us mid-demo.
- **Size is a real constraint and must be measured.** A regional extract at full zoom runs to
  gigabytes; dropping the max zoom by one roughly halves it. Bangkok at the zoom range this product
  actually uses is the extract to build, and its size is measured at P3.x, not assumed here.
- **Fonts and sprites come from the Protomaps basemaps-assets bundle**, which is a second thing to
  host. Cheap, but it is not zero and it is easy to forget until labels render as boxes.
- **ODbL attribution stays in the map control**, non-removable. Same obligation ADR-0017 records for
  resolved coordinates; this is the other half of it.

## Alternatives rejected

- **MapTiler or Stadia free tiers.** Generous, and an account, a key, and a quota that a public demo
  can exhaust from traffic we do not control.
- **Google Maps tiles.** Rejected already by ADR-0008 on branding grounds, and now on vendor grounds.
