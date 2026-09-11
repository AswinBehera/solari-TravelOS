/**
 * One valid fixture per travel entity. Unlike the engine's fixtures, these are
 * allowed to be as travel-flavoured as they like — that is the whole point of
 * being on this side of the seam.
 */

import type { Place, Postcard, Trip, TripDocument, User } from "./index.js"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const at = new Date("2026-09-11T09:00:00.000Z")
const stamps = { createdAt: at, updatedAt: at }

export const userFixture: User = {
  id: uuid(1),
  email: "aswin@example.com",
  plan: "pro",
  locale: "en-IN",
  budgetOverrides: { solariMinutesPerDay: null, geocodeCallsPerDay: null },
  ...stamps,
}

export const tripFixture: Trip = {
  id: uuid(2),
  userId: uuid(1),
  title: "Bangkok, November",
  destinationCity: "Bangkok",
  startDate: new Date("2026-11-02T00:00:00.000Z"),
  endDate: new Date("2026-11-09T00:00:00.000Z"),
  status: "planning",
  ...stamps,
}

export const tripDocumentFixture: TripDocument = {
  id: uuid(3),
  tripId: uuid(2),
  content: { type: "doc", content: [{ type: "paragraph" }] },
  version: 1,
  ...stamps,
}

export const placeFixture: Place = {
  id: uuid(4),
  canonicalName: "Jay Fai",
  localName: "เจ๊ไฝ",
  city: "Bangkok",
  geo: { lat: 13.7527, lng: 100.5063 },
  // Tier 0: the post itself carried the pin. The cheapest and most accurate path.
  externalRef: { source: "artifact", id: "tiktok:7401234567890123456" },
  resolvedTier: 0,
  category: "food",
  tags: ["street food", "michelin"],
  scores: {
    local: {
      value: 0.41,
      because: [
        { factor: "mentioned by th personas", contribution: 0.3, evidenceIds: [uuid(9)] },
        { factor: "thai-language evidence", contribution: 0.11, evidenceIds: [uuid(9)] },
      ],
    },
    tourist: {
      value: 0.88,
      because: [{ factor: "appears in en listicles", contribution: 0.88, evidenceIds: [uuid(10)] }],
    },
  },
  firstSeenAt: at,
  lastSeenAt: at,
  evidenceCount: 2,
  ...stamps,
}

export const postcardFixture: Postcard = {
  id: uuid(5),
  tripId: uuid(2),
  kind: "place",
  placeId: uuid(4),
  payload: { note: "go before 18:00, queue after" },
  geo: { lat: 13.7527, lng: 100.5063 },
  time: { start: new Date("2026-11-03T10:00:00.000Z"), end: null },
  sourceRefs: [uuid(9), uuid(10)],
  state: "fresh",
  ...stamps,
}
