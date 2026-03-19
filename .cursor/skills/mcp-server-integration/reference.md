# MCP Server Integration — Reference

## Recommended server architecture (portable)

Use a “ports + adapters” split so business rules do not depend on MCP libraries/SDKs.

### Suggested structure

```text
src/
  application/
    tools/
      tool-runner.ts
      tool-contracts.ts
    ports/
      mcp-tools.port.ts
      secrets.port.ts
      logger.port.ts
  infrastructure/
    mcp/
      server.ts
      handlers/
    secrets/
    logger/
```

## Tool contract pattern (TypeScript + Zod)

Use one schema for args and one for results. Keep them close to the tool definition.

```ts
import { z } from 'zod'

export const ExampleToolArgsSchema = z.object({
  input: z.string().min(1)
})

export type ExampleToolArgs = z.infer<typeof ExampleToolArgsSchema>

export const ExampleToolResultSchema = z.object({
  output: z.string()
})

export type ExampleToolResult = z.infer<typeof ExampleToolResultSchema>
```

## Error shape (stable + safe)

Prefer a small, predictable error contract.

```ts
import { z } from 'zod'

export const ToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
})

export type ToolError = z.infer<typeof ToolErrorSchema>
```

## Timeouts and retries (safe defaults)

- Always set a timeout for outbound requests.
- Retry only if the operation is idempotent and the failure is transient.
- Include an `idempotencyKey` in write tools whenever possible.

## Descriptor authoring guidelines

When generating MCP tool descriptors:

- Keep **titles/descriptions** explicit and stable.
- Include **required fields** and constraints (min/max, enums).
- Version public-facing tool names if you expect breaking changes (`*.v1`, `*.v2`).

## Safety guardrails

Use these patterns for risky tools:

- **Confirm parameters**: `confirm: true` or `dryRun: true` to prevent accidents.
- **Allowlists**: restrict domains/paths/table names.
- **Read-only mode**: expose separate `*-preview` tools.
- **Redaction**: redact secrets in logs and tool outputs.

## Security checklist

- [ ] No secrets in tool outputs
- [ ] No secrets in logs
- [ ] Input validation for every tool
- [ ] Parameterized SQL only
- [ ] URL allowlist for fetch-like tools
- [ ] Explicit authz checks for sensitive reads/writes

