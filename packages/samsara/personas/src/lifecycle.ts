import { randomUUID } from "node:crypto"
import {
  err,
  type Failure,
  failure,
  type Logger,
  now,
  ok,
  type Result,
  silentLogger,
} from "@samsara/kernel"
import { newProxySessionKey } from "./create.js"
import { assess, type HealthAssessment, SESSION_SCAN_DEPTH } from "./health.js"
import type { PersonaRecord, PersonaStore } from "./store.js"

/**
 * What happens to an identity after it exists: it is judged, it is moved to a new
 * address, or it is taken out of service.
 */

export interface LifecycleDeps {
  store: PersonaStore
  logger?: Logger
  newId?: () => string
}

/**
 * Re-judge a persona from its session history and write the verdict if it moved.
 *
 * Called after every session a persona takes part in. It is cheap — one bounded,
 * indexed read — and it is the only thing that ever writes `health`, which is what
 * keeps the rule in `health.ts` the single description of what the states mean.
 */
export async function reassess(
  deps: LifecycleDeps,
  personaId: string,
): Promise<Result<HealthAssessment, Failure>> {
  const logger = deps.logger ?? silentLogger
  const persona = await deps.store.byId(personaId)
  if (!persona) return err(failure("config", `no such persona: ${personaId}`))

  const recent = await deps.store.recentOutcomes(personaId, SESSION_SCAN_DEPTH)
  const verdict = assess(persona.health, recent)
  if (verdict.changed) {
    await deps.store.setHealth(personaId, verdict.health)
    logger.emit({
      at: now(),
      event: "persona.health",
      personaId,
      from: persona.health,
      to: verdict.health,
      reason: verdict.reason,
    })
  }
  return ok(verdict)
}

/**
 * Same identity, new address.
 *
 * The move worth making before giving up on a `degraded` persona: its cookies,
 * its history and its locale are intact and only its egress IP is burnt. It is
 * also the cheapest thing in this file — no session, no minutes, one UPDATE — and
 * so it is the first thing to try and the easiest to forget exists.
 *
 * Refused for `banned`, where the profile rather than the address is what the
 * surface recognises, and rotating would buy a second refusal at full price.
 */
export async function rotateProxySession(
  deps: LifecycleDeps,
  personaId: string,
): Promise<Result<string, Failure>> {
  const persona = await deps.store.byId(personaId)
  if (!persona) return err(failure("config", `no such persona: ${personaId}`))
  if (persona.health === "banned" || persona.health === "retired") {
    return err(
      failure(
        "config",
        `persona ${personaId} is ${persona.health}; rotating its IP changes nothing`,
      ),
    )
  }
  const key = newProxySessionKey(deps.newId ?? randomUUID)
  await deps.store.setProxySession(personaId, key)
  return ok(key)
}

/**
 * Take an identity out of service by our own decision.
 *
 * Distinct from `banned`, which is the surface's decision, and the distinction is
 * worth keeping: a fleet that is half retired because we changed strategy is
 * healthy, and one that is half banned is a system being detected. Collapsing
 * them into one terminal state loses exactly the number anybody would want.
 *
 * The provider profile is deleted, because it is the only part that costs storage
 * and the only part that cannot be reconstructed from the row.
 */
export async function retire(
  deps: LifecycleDeps & { profiles?: { delete(id: string): Promise<void> } },
  personaId: string,
): Promise<Result<PersonaRecord, Failure>> {
  const logger = deps.logger ?? silentLogger
  const persona = await deps.store.byId(personaId)
  if (!persona) return err(failure("config", `no such persona: ${personaId}`))
  if (persona.health === "retired") return ok(persona)

  if (persona.solariProfileId && deps.profiles) {
    try {
      await deps.profiles.delete(persona.solariProfileId)
      await deps.store.setProfile(personaId, null)
    } catch {
      // Left pointing at a profile that may or may not still exist. The row is
      // still retired below: refusing to retire because a cleanup call failed
      // would keep a persona we have decided against in the rotation.
    }
  }

  await deps.store.setHealth(personaId, "retired")
  logger.emit({
    at: now(),
    event: "persona.health",
    personaId,
    from: persona.health,
    to: "retired",
    reason: "retired by operator decision",
  })
  return ok({ ...persona, health: "retired" })
}
