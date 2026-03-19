import { z } from 'zod'

const BookingMcpIdsSchema = z.object({
  clientId: z.coerce.number().optional(),
  agentId: z.string().optional(),
  boardId: z.string().optional(),
  stageId: z.string().optional(),
  dealId: z.coerce.number().optional(),
  timezone: z.string().optional()
}).strict()

type BookingMcpIds = z.infer<typeof BookingMcpIdsSchema>

type ResolveOk = {
  ok: true
  ids: BookingMcpIds
  instructionsText: string
}

type ResolveErr = {
  ok: false
  error: { code: string, error: string, details?: unknown }
  instructionsText: string
}

function tryExtractJsonObjectText (input: string): { ok: true, jsonText: string } | { ok: false } {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false }
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return { ok: true, jsonText: trimmed }
  }
  const firstBraceIndex = trimmed.indexOf('{')
  const lastBraceIndex = trimmed.lastIndexOf('}')
  if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
    return { ok: false }
  }
  return { ok: true, jsonText: trimmed.slice(firstBraceIndex, lastBraceIndex + 1) }
}

function parseLegacyIds (instructionsText: string): { ok: true, ids: BookingMcpIds } | { ok: false, details: unknown } {
  const extracted = tryExtractJsonObjectText(instructionsText)
  if (!extracted.ok) {
    return { ok: true, ids: {} }
  }
  try {
    const parsedUnknown: unknown = JSON.parse(extracted.jsonText)
    const parsed = BookingMcpIdsSchema.safeParse(parsedUnknown)
    if (parsed.success) {
      return { ok: true, ids: parsed.data }
    }
    return { ok: false, details: parsed.error.flatten() }
  } catch (error) {
    return { ok: false, details: error instanceof Error ? error.message : error }
  }
}

function buildInstructionsText (ids: BookingMcpIds, rawInstructionsText?: string): string {
  const hasInstructionsText = typeof rawInstructionsText === 'string' && rawInstructionsText.trim().length > 0
  if (hasInstructionsText) {
    return rawInstructionsText as string
  }
  return JSON.stringify({
    clientId: ids.clientId,
    agentId: ids.agentId,
    dealId: ids.dealId,
    boardId: ids.boardId,
    stageId: ids.stageId,
    timezone: ids.timezone
  })
}

export function resolveBookingMcpIds (input: {
  instructionsText?: string
  explicitIds: BookingMcpIds
  requiredKeys?: Array<keyof BookingMcpIds>
}): ResolveOk | ResolveErr {
  const legacyParse = typeof input.instructionsText === 'string'
    ? parseLegacyIds(input.instructionsText)
    : { ok: true as const, ids: {} }

  if (!legacyParse.ok) {
    const fallbackInstructionsText = buildInstructionsText(input.explicitIds, input.instructionsText)
    return {
      ok: false,
      instructionsText: fallbackInstructionsText,
      error: {
        code: 'INVALID_INSTRUCTIONS_JSON',
        error: 'instructionsText must contain a valid JSON object with booking IDs',
        details: legacyParse.details
      }
    }
  }

  const mergedIds: BookingMcpIds = {
    ...legacyParse.ids,
    ...input.explicitIds
  }

  const idsValidation = BookingMcpIdsSchema.safeParse(mergedIds)
  if (!idsValidation.success) {
    const fallbackInstructionsText = buildInstructionsText(mergedIds, input.instructionsText)
    return {
      ok: false,
      instructionsText: fallbackInstructionsText,
      error: {
        code: 'INVALID_IDS',
        error: 'Invalid booking IDs',
        details: idsValidation.error.flatten()
      }
    }
  }

  const requiredKeys = input.requiredKeys ?? []
  const missingKeys = requiredKeys.filter((key) => mergedIds[key] === undefined || mergedIds[key] === null)
  if (missingKeys.length > 0) {
    const fallbackInstructionsText = buildInstructionsText(mergedIds, input.instructionsText)
    return {
      ok: false,
      instructionsText: fallbackInstructionsText,
      error: {
        code: 'MISSING_IDS',
        error: `Missing required IDs: ${missingKeys.join(', ')}`,
        details: { missingKeys }
      }
    }
  }

  return {
    ok: true,
    ids: idsValidation.data,
    instructionsText: buildInstructionsText(idsValidation.data, input.instructionsText)
  }
}

