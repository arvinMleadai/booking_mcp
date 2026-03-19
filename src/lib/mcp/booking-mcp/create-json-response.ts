type McpTextContent = { type: 'text'; text: string }
type McpResponse = { content: McpTextContent[] }

export function createJsonResponse (payload: unknown): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text: `<json>${JSON.stringify(payload)}</json>`
      }
    ]
  }
}

