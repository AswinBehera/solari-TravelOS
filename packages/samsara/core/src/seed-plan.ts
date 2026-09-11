import { z } from "zod"
import { id, timestamps } from "./primitives.js"

/**
 * One action in a seeding session. The set is deliberately small: anything richer
 * belongs in an adapter, not in a plan that has to stay comparable across versions.
 */
export const seedStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visit"), url: z.url(), dwellSeconds: z.number().positive() }),
  z.object({ kind: z.literal("scroll"), times: z.number().int().positive() }),
  z.object({ kind: z.literal("search"), term: z.string().min(1) }),
])
export type SeedStep = z.infer<typeof seedStep>

/**
 * The recipe for giving an identity a history. Versioned because the whole point is
 * to compare how two identities drift, and that comparison is meaningless if the
 * recipe changed underneath it.
 */
export const seedPlan = z
  .object({
    id,
    locality: z.string().min(1),
    version: z.number().int().positive(),
    steps: z.array(seedStep).min(1),
  })
  .extend(timestamps.shape)
export type SeedPlan = z.infer<typeof seedPlan>
