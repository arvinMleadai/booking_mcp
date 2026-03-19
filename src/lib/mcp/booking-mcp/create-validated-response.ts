import type { z } from 'zod'
import { createToolError } from './create-tool-error'
import { createJsonResponse } from './create-json-response'

type McpTextContent = { type: 'text'; text: string }
type McpResponse = { content: McpTextContent[] }

export function createValidatedResponse<TSchema extends z.ZodTypeAny> (schema: TSchema, payload: unknown): McpResponse {
  const parsed = schema.safeParse(payload)
  if (parsed.success) {
    return createJsonResponse(parsed.data)
  }
  return createToolError({
    code: 'INVALID_TOOL_RESPONSE',
    error: 'Tool returned an unexpected response shape',
    details: parsed.error.flatten()
  })
}

