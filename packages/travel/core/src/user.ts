import { id, locale, timestamps } from "@samsara/core"
import { z } from "zod"

export const plan = z.enum(["free", "pro"])
export type Plan = z.infer<typeof plan>

/**
 * Per-user overrides on the kernel's budget ceilings. Absent means "use the global
 * default"; the guard reads these, it does not negotiate with them.
 */
export const budgetOverrides = z.object({
  solariMinutesPerDay: z.number().int().positive().nullable(),
  geocodeCallsPerDay: z.number().int().positive().nullable(),
})
export type BudgetOverrides = z.infer<typeof budgetOverrides>

/**
 * Auth and billing are app concerns. The engine only ever sees `ownerId: string` and
 * has no idea this table exists — which is the whole point of the seam.
 *
 * `id` is the Supabase Auth user id (the JWT's `sub`), not a separately generated key
 * (ADR-0013). One identity, one lifetime, no join table reconciling two id spaces.
 */
export const user = z
  .object({
    id,
    email: z.email(),
    plan,
    locale,
    budgetOverrides,
  })
  .extend(timestamps.shape)
export type User = z.infer<typeof user>
