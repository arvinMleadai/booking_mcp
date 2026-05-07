import { createHmac, timingSafeEqual } from 'crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'

/** Default validity window for a slot intent (seconds). */
export const BOOKING_INTENT_TTL_SECONDS = 15 * 60

const AgentSnapshotSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  profileName: z.string(),
  title: z.string(),
  email: z.string().optional(),
  officeHours: z.record(z.string(), z.unknown()).nullable().optional(),
  timezone: z.string(),
})

export const BookingIntentPayloadV1Schema = z.object({
  v: z.literal(1),
  iat: z.number(),
  exp: z.number(),
  clientId: z.number(),
  agentId: z.string(),
  calendarId: z.string(),
  boardId: z.string().nullable(),
  stageId: z.string().nullable(),
  dealId: z.number().nullable(),
  timezone: z.string(),
  start: z.string(),
  end: z.string(),
  agent: AgentSnapshotSchema,
})

export type BookingIntentPayloadV1 = z.infer<typeof BookingIntentPayloadV1Schema>
export type BookingIntentAgentSnapshot = z.infer<typeof AgentSnapshotSchema>

/**
 * Server secret for HMAC. If unset, tokens are not minted and booking falls back to the full path.
 */
export function getBookingIntentSecretOrNull(): string | null {
  const s = process.env.BOOKING_INTENT_SECRET?.trim()
  return s && s.length > 0 ? s : null
}

function canonicalPayload(p: BookingIntentPayloadV1): string {
  return JSON.stringify(p)
}

/**
 * Signed opaque token returned on each slot from slots-find; pass unchanged to booking-create.
 */
export function mintBookingIntentToken(
  input: Omit<BookingIntentPayloadV1, 'v' | 'iat' | 'exp'> & { iat?: number; exp?: number },
  secret: string
): string {
  const iat = input.iat ?? Math.floor(Date.now() / 1000)
  const exp = input.exp ?? iat + BOOKING_INTENT_TTL_SECONDS
  const full: BookingIntentPayloadV1 = {
    v: 1,
    iat,
    exp,
    clientId: input.clientId,
    agentId: input.agentId,
    calendarId: input.calendarId,
    boardId: input.boardId ?? null,
    stageId: input.stageId ?? null,
    dealId: input.dealId ?? null,
    timezone: input.timezone,
    start: input.start,
    end: input.end,
    agent: input.agent,
  }
  const body = canonicalPayload(full)
  const sig = createHmac('sha256', secret).update(body, 'utf8').digest()
  const bodyB64 = Buffer.from(body, 'utf8').toString('base64url')
  const sigB64 = sig.toString('base64url')
  return `${bodyB64}.${sigB64}`
}

export function verifyBookingIntentToken(
  token: string,
  secret: string
): { ok: true; payload: BookingIntentPayloadV1 } | { ok: false; error: string } {
  const dot = token.indexOf('.')
  if (dot <= 0) {
    return { ok: false, error: 'Malformed token' }
  }
  const bodyB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  let body: string
  try {
    body = Buffer.from(bodyB64, 'base64url').toString('utf8')
  } catch {
    return { ok: false, error: 'Invalid encoding' }
  }
  let sigBuf: Buffer
  try {
    sigBuf = Buffer.from(sigB64, 'base64url')
  } catch {
    return { ok: false, error: 'Invalid signature encoding' }
  }
  const expectedSig = createHmac('sha256', secret).update(body, 'utf8').digest()
  if (sigBuf.length !== expectedSig.length || !timingSafeEqual(sigBuf, expectedSig)) {
    return { ok: false, error: 'Invalid signature' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  const result = BookingIntentPayloadV1Schema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, error: 'Invalid payload' }
  }
  const p = result.data
  const now = Math.floor(Date.now() / 1000)
  if (p.exp < now) {
    return { ok: false, error: 'Token expired' }
  }
  return { ok: true, payload: p }
}

export function instantsMatchIso(a: string, b: string): boolean {
  const da = DateTime.fromISO(a, { setZone: true })
  const db = DateTime.fromISO(b, { setZone: true })
  if (!da.isValid || !db.isValid) {
    return false
  }
  return da.toUTC().toMillis() === db.toUTC().toMillis()
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t && t.length > 0 ? t : null
}

function normalizeDealId(value: number | null | undefined): number | null {
  if (value === undefined || value === null || Number(value) === 0) {
    return null
  }
  return Number(value)
}

/**
 * Ensures the live request matches the signed intent (ids + same calendar + same slot instants).
 */
export function bookingIntentMatchesRequest(
  payload: BookingIntentPayloadV1,
  ids: {
    agentId: string
    clientId: number
    boardId?: string
    stageId?: string
    dealId?: number | null
  },
  startDateTime: string,
  endDateTime: string,
  calendarIdOverride?: string
): boolean {
  if (payload.agentId !== ids.agentId || payload.clientId !== ids.clientId) {
    return false
  }
  const override = normalizeOptionalString(calendarIdOverride ?? null)
  if (override !== null && override !== payload.calendarId) {
    return false
  }
  if (!instantsMatchIso(payload.start, startDateTime) || !instantsMatchIso(payload.end, endDateTime)) {
    return false
  }
  if (normalizeOptionalString(ids.boardId) !== normalizeOptionalString(payload.boardId)) {
    return false
  }
  if (normalizeOptionalString(ids.stageId) !== normalizeOptionalString(payload.stageId)) {
    return false
  }
  if (normalizeDealId(ids.dealId) !== normalizeDealId(payload.dealId)) {
    return false
  }
  return true
}
