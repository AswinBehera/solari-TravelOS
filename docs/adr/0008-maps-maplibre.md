# ADR-0008: MapLibre GL for the map

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

The map is a product surface, not a utility: it shows Postcards, it carries the brand palette, and
it sits inside a document. Section 1.4's premise is that a traveller can see at a glance which
places are local-weighted and which are tourist-weighted, which means the basemap has to recede and
the markers have to carry the design.

Google Maps' embed carries Google's branding and Google's styling limits.

## Decision

MapLibre GL with a styled vector basemap. Markers are Postcards; anything without geo is not on the
map at all.

## Consequences

- Free, and styleable down to the label font, so the map can be made quiet enough for the markers
  to be the content.
- No Google branding in a UI whose whole claim is a point of view.
- Vector tiles still come from somewhere; that provider is a separate, later choice and is not
  metered in section 8 because it is not priced per call at this volume.
- Cost: MapLibre is heavier than Leaflet and its API is less forgiving.

## Swap point

Leaflet, if MapLibre proves to be overkill — Aswin has Leaflet experience from the ARG project, so
this swap is genuinely cheap.
