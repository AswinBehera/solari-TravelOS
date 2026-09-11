import { id, timestamps } from "@samsara/core"
import { z } from "zod"

/** Where the traveller is in the arc. Drives daemon cadence, not just a badge colour. */
export const tripStatus = z.enum(["dreaming", "planning", "travelling", "done"])
export type TripStatus = z.infer<typeof tripStatus>

export const trip = z
  .object({
    id,
    userId: id,
    title: z.string().min(1),
    /** Canonical, not as typed. "Bangkok", never "bkk". */
    destinationCity: z.string().min(1),
    startDate: z.date().nullable(),
    endDate: z.date().nullable(),
    status: tripStatus,
  })
  .extend(timestamps.shape)
export type Trip = z.infer<typeof trip>

/** One document per trip in v1. Content is Tiptap/ProseMirror JSON. */
export const tripDocument = z
  .object({
    id,
    tripId: id,
    content: z.unknown(),
    version: z.number().int().positive(),
  })
  .extend(timestamps.shape)
export type TripDocument = z.infer<typeof tripDocument>
