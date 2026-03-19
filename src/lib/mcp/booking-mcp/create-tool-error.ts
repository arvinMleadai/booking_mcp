import { createJsonResponse } from './create-json-response'

type McpTextContent = { type: 'text'; text: string }
type McpResponse = { content: McpTextContent[] }

export function createToolError (input: { code: string, error: string, details?: unknown }): McpResponse {
  return createJsonResponse({
    success: false,
    code: input.code,
    error: input.error,
    details: input.details
  })
}

