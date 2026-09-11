import { describe, expect, it } from "vitest"
import * as fx from "./fixtures.js"
import {
  countryCode,
  entityRef,
  evidence,
  harvestRun,
  mention,
  observation,
  persona,
  probeTarget,
  rawItem,
  scoreSet,
  seedPlan,
  session,
  sessionPurpose,
} from "./index.js"

describe("every engine schema parses its fixture", () => {
  const cases = [
    ["persona", persona, fx.personaFixture],
    ["seedPlan", seedPlan, fx.seedPlanFixture],
    ["session", session, fx.sessionFixture],
    ["harvestRun", harvestRun, fx.harvestRunFixture],
    ["rawItem", rawItem, fx.rawItemFixture],
    ["mention", mention, fx.mentionFixture],
    ["evidence", evidence, fx.evidenceFixture],
    ["probeTarget", probeTarget, fx.probeTargetFixture],
    ["observation", observation, fx.observationFixture],
  ] as const

  for (const [name, schema, fixture] of cases) {
    it(name, () => {
      expect(schema.parse(fixture)).toMatchObject(fixture as object)
    })
  }
})

describe("constraints that are load-bearing rather than decorative", () => {
  it("rejects an uppercase country, because the proxy layer takes lowercase", () => {
    expect(countryCode.safeParse("TH").success).toBe(false)
    expect(countryCode.safeParse("th").success).toBe(true)
  })

  it("keeps SessionPurpose closed, so adding a vertical cannot add a member", () => {
    expect(sessionPurpose.options).toEqual([
      "persona.seed",
      "persona.keepalive",
      "harvest",
      "probe",
      "agent",
    ])
    expect(sessionPurpose.safeParse("harvest.atlas").success).toBe(false)
  })

  it("holds an entity pointer as an opaque pair, never as a typed foreign key", () => {
    const ref = entityRef.parse({ domainId: "atlas", entityId: fx.evidenceFixture.entityId })
    expect(ref.domainId).toBe("atlas")
  })

  it("accepts any named score, because the engine does not know what a score means", () => {
    const parsed = scoreSet.parse({
      whatever: { value: 0.4, because: [{ factor: "f", contribution: 0.4, evidenceIds: [] }] },
    })
    expect(parsed.whatever?.value).toBe(0.4)
  })

  it("bounds confidence to 0..1", () => {
    expect(mention.safeParse({ ...fx.mentionFixture, confidence: 1.4 }).success).toBe(false)
  })
})
