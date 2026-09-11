import { z } from "zod"
import { countryCode, id, locale, timestamps } from "./primitives.js"

/** How much history an identity carries. `anon` is disposable; `seeded` has been lived in. */
export const personaTier = z.enum(["anon", "seeded"])
export type PersonaTier = z.infer<typeof personaTier>

/**
 * `degraded` means still usable but showing signs — captchas, throttling, thinner
 * results. `banned` is terminal for the profile; `retired` is our own decision.
 */
export const personaHealth = z.enum(["healthy", "degraded", "banned", "retired"])
export type PersonaHealth = z.infer<typeof personaHealth>

export const personaStats = z.object({
  sessions: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  blocks: z.number().int().nonnegative(),
})
export type PersonaStats = z.infer<typeof personaStats>

/**
 * An identity the system can look through. Country is where it egresses; locality is
 * where it reads as being from, which is not always the same thing and is the more
 * interesting of the two.
 */
export const persona = z
  .object({
    id,
    name: z.string().min(1),
    /** Free text: the city or region this identity reads as being in. */
    locality: z.string().min(1),
    country: countryCode,
    locale,
    tier: personaTier,
    /** Solari profile holding this identity's cookies and storage, once it has any. */
    solariProfileId: z.string().min(1).nullable(),
    /** Sticky IP key, so one identity keeps one address across sessions. */
    proxySession: z.string().min(1).nullable(),
    health: personaHealth,
    seedPlanId: id.nullable(),
    lastAliveAt: z.date().nullable(),
    stats: personaStats,
  })
  .extend(timestamps.shape)
export type Persona = z.infer<typeof persona>
