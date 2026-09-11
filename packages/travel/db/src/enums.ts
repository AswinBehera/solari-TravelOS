import { placeCategory, plan, postcardKind, postcardState, tripStatus } from "@dt/core"
import { pgEnum } from "drizzle-orm/pg-core"

/** Derived from the Zod enums in `@dt/core`, for the same reason the engine's are. */
type Values = readonly [string, ...string[]]

export const userPlanEnum = pgEnum("user_plan", plan.options as unknown as Values)
export const tripStatusEnum = pgEnum("trip_status", tripStatus.options as unknown as Values)
export const postcardKindEnum = pgEnum("postcard_kind", postcardKind.options as unknown as Values)
export const postcardStateEnum = pgEnum(
  "postcard_state",
  postcardState.options as unknown as Values,
)
export const placeCategoryEnum = pgEnum(
  "place_category",
  placeCategory.options as unknown as Values,
)
