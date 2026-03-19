---
name: mcp-servers
description: Create or integrate MCP (Model Context Protocol) servers with best practices and current implementation patterns. Use when building MCP servers, adding MCP tools or resources, integrating with Cursor or other MCP clients, or when the user mentions MCP, Model Context Protocol, or MCP server.
---

# MCP Servers: Create & Integrate

Guidance for creating and integrating MCP servers using the official SDK and current best practices.

## When to Use This Skill

- Creating a new MCP server (stdio or HTTP).
- Adding tools, resources, or prompts to an existing server.
- Integrating an MCP server with Cursor or another MCP client.
- Debugging or improving MCP server security, validation, or error handling.

## Quick Start: Server Types

| Goal | Transport | Use case |
|------|------------|----------|
| Local, per-user (e.g. Cursor) | **stdio** | One process per user, strong isolation |
| Remote, shared API | **Streamable HTTP** | Scale-out, multi-tenant, gateways |

**Single responsibility:** One server = one bounded context (e.g. booking, files, DB). Avoid a single “mega-server” for unrelated domains.

## Implementation Options (TypeScript/Node)

### Option A: Official SDK (`@modelcontextprotocol/sdk`)

```bash
npm install @modelcontextprotocol/sdk zod
```

Zod is a peer dependency for input schemas. Server package is also available as `@modelcontextprotocol/server` in newer splits.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new Server({ name: 'my-server', version: '1.0.0' });

server.tool(
  'DoSomething',
  'Description for the model',
  { input: z.string().describe('Required input') },
  async ({ input }) => {
    return { content: [{ type: 'text', text: `Result: ${input}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Option B: HTTP in Next.js / Express (e.g. route handler)

Use Streamable HTTP for remote clients. SDK supports `StreamableHTTPTransport`; middleware exists for Express, Hono, and Node.

- **Next.js:** Implement the MCP HTTP endpoint (e.g. `/api/mcp`) that reads the request body/stream and runs the server’s request handler.
- **Cursor:** Configure the server in Cursor settings; for remote servers use the HTTP URL.

### Option C: Wrapper libraries (e.g. `mcp-handler`)

Libraries like `mcp-handler` provide a small wrapper (e.g. `createMcpHandler`) so you register tools with Zod schemas and plug into your framework. Use when it matches your stack; ensure they delegate to the official protocol so clients stay compatible.

## Tools, Resources, Prompts

- **Tools:** Actions the model can invoke (side effects, APIs, compute). Define name, description, and **Zod schema** for arguments. Return `{ content: [{ type: 'text', text: string }] }` (and optionally other content types).
- **Resources:** Read-only data (URIs). Expose via `server.resource()` and template URIs (e.g. `file:///path`, or custom `myapp://id`).
- **Prompts:** Reusable prompt templates; register with `server.prompt()`.

Keep tools small and single-purpose. Validate all inputs with Zod (or equivalent); never trust raw client input.

## Security & Resilience (Must-Do)

1. **Input validation:** Every tool argument must be validated (Zod schema). Reject invalid payloads with a clear error.
2. **No secrets in logs:** Do not log tokens, API keys, or PII. Log request IDs and tool names for debugging.
3. **Transport choice:** stdio = local only. For HTTP, use TLS and authentication (e.g. OAuth 2.1 / API keys as the spec evolves).
4. **Timeouts and cancellation:** Support timeouts and cancellation so clients can avoid hung requests.
5. **Idempotency:** Where possible, make tools idempotent and accept client-generated request IDs for retries.

## Error Handling

- Return structured, safe error messages to the client (no stack traces or internals).
- Log full details server-side with correlation/request IDs.
- Use consistent error shapes (e.g. `{ success: false, error: string, code?: string }`) in tool text responses so clients can parse them.

## Tool Response Shape

Return content in the format the SDK expects:

```typescript
return {
  content: [
    { type: 'text', text: JSON.stringify({ success: true, data: result }) }
  ],
  isError: false  // set true only for tool-level errors
};
```

Use `isError: true` only when the tool invocation itself failed (e.g. validation, permission), not for “no results” (that’s a normal result).

## Testing & Debugging

- **MCP Inspector:** Run `npx @modelcontextprotocol/inspector@latest` to test your server (stdio or URL).
- **Unit tests:** Call your tool handlers with valid/invalid inputs and assert on returned content and errors.
- **Contract:** Ensure your server responds to `initialize` and lists tools/resources per the MCP spec so Cursor and other clients can discover them.

## Cursor Integration

- **Local server:** Add the server to Cursor MCP settings (e.g. `~/.cursor/mcp.json` or project config) with the correct command (e.g. `node dist/server.js`) and env.
- **Remote server:** Use the Streamable HTTP URL in Cursor’s MCP config. Ensure the endpoint is HTTPS and authenticated if required.

## Checklist for New Servers

- [ ] One clear purpose (single responsibility).
- [ ] All tool inputs validated with Zod (or equivalent).
- [ ] Tool responses use `content` array and optional `isError`.
- [ ] No secrets or PII in logs.
- [ ] Timeouts/cancellation considered for long-running tools.
- [ ] Tested with MCP Inspector or integration test.
- [ ] Documented tool names and arguments for users of the client.

## Booking MCP pattern (chunked flow + customer messages)

For booking-style servers that talk to customers (e.g. voice or chat):

- **Chunk tools** so the agent can respond incrementally: e.g. `GetBookingContext` (resolve agent + calendar) → then `FindAvailableSlots` → then `BookAppointment` as the main booking tool.
- **Return `customerFacingMessage`** in every tool response: a short phrase the agent should say to the customer (e.g. "I'm checking Sarah's calendar.", "I found 3 times: Monday 2pm, Tuesday 10am. Which works for you?"). The agent reads this out instead of staying silent during long operations.
- **Recommended flow:** Call `GetBookingContext` → say `customerFacingMessage` to the customer → call `FindAvailableSlots` → say its `customerFacingMessage` with the options → call `BookAppointment` with the chosen slot → say confirmation from `customerFacingMessage`.

## Additional Resources

- For architecture, security layers, and production operations (monitoring, health checks, deployment), see [reference.md](reference.md).
- Official spec and SDK: [modelcontextprotocol.io](https://modelcontextprotocol.io), [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
