import { z } from 'zod'

const BookingResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    booking: z.unknown(),
    message: z.string().optional()
  }),
  z.object({
    success: z.literal(false),
    conflict: z.literal(true),
    message: z.string(),
    suggestedSlots: z.array(z.unknown())
  }),
  z.object({
    success: z.literal(false),
    conflict: z.literal(false).optional(),
    error: z.string(),
    code: z.string(),
    details: z.unknown().optional()
  })
])

const SlotsResponseSchema = z.object({
  success: z.boolean(),
  slots: z.array(z.unknown()).optional(),
  agent: z.unknown().optional(),
  customer: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional()
})

const CancelResponseSchema = z.object({
  success: z.boolean(),
  eventId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional()
})

const RescheduleResponseSchema = z.object({
  success: z.boolean(),
  event: z.unknown().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional()
})

const CalculateDateResponseSchema = z.object({
  date: z.string(),
  description: z.string(),
  iso: z.string()
})

export const BookingMcpResponseSchemas = {
  booking: BookingResponseSchema,
  slots: SlotsResponseSchema,
  cancel: CancelResponseSchema,
  reschedule: RescheduleResponseSchema,
  calculateDate: CalculateDateResponseSchema
} as const

