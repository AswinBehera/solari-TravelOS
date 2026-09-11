// @dt/core — Zod schemas for the travel vertical (plan section 3.2).
//
// Everything in packages/travel/ may know it is about travel. Nothing in
// packages/samsara/ may know this file exists.

export * from "./place.js"
export * from "./postcard.js"
export * from "./trip.js"
export * from "./user.js"

export const PACKAGE = "@dt/core" as const
