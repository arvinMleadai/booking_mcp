---
name: mcp-server-integration
description: Creates or integrates MCP servers in Cursor with best practices. Use when the user asks to add/connect an MCP server, implement MCP tools/resources, generate tool schemas/descriptors, wire auth, or debug MCP tool-calling. Enforces schema-first workflow, safe tool design, typed I/O validation, timeouts/retries, and secrets-safe adapters.
---

# MCP Server Integration

## Quick start (default workflow)

- **Goal**: create or integrate an MCP server, then expose safe, well-typed tools/resources that Cursor can call reliably.
- **Non-negotiables**:
  - **Schema-first**: always read the tool schema/descriptor before calling any MCP tool.
  - **Validate everything**: treat model output as untrusted; validate tool args and external responses.
  - **Safe by default**: deny-by-default for risky operations; require explicit user intent for destructive actions.
  - **No secret leakage**: never log secrets; never return secrets in tool outputs.

### Implementation steps

1. **Pick scope**
   - Prefer **project-level** integration (checked into repo) unless the user asks for personal-only.

2. **Inventory what exists**
   - Locate the MCP server folder(s) and existing tool/resource descriptors.
   - Identify required auth (if any) and the current transport (stdio/http).

3. **Design tools and resources**
   - Keep tools **small, single-purpose, deterministic**.
   - Define **typed input/output contracts** (zod or JSON schema).
   - Add **guardrails** (allowlists, timeouts, concurrency limits).

4. **Wire ports/adapters**
   - Implement tool handlers behind an interface/port.
   - Keep SDKs/clients in infrastructure; keep orchestration in application layer.

5. **Test and harden**
   - Add smoke tests for at least one tool and one resource.
   - Verify error mapping, retries/backoff, idempotency (if writing), and redaction.

## Tool design checklist (copy/paste)

- [ ] **Name** is stable, kebab-case, explicit (e.g., `booking-create-appointment` not `create`)
- [ ] **Input schema** is strict (no unknown keys unless needed)
- [ ] **Output schema** is strict (stable fields, versioned if necessary)
- [ ] **Errors**: predictable error shapes; includes `code` and safe `message`
- [ ] **Timeouts**: every external call has a timeout
- [ ] **Retries**: only for safe/idempotent operations; bounded attempts
- [ ] **Idempotency**: deterministic `idempotencyKey` when creating/updating external state
- [ ] **Secrets**: never in logs or output; redact tokens/keys
- [ ] **Safety**: destructive operations require explicit confirmation parameters

## Calling MCP tools safely (Cursor-specific)

When invoking an MCP tool:

1. **List and read its schema/descriptor file first**.
2. Build arguments to match the schema exactly.
3. Call the tool.
4. Validate the tool response against a schema before using it downstream.

## Auth handling

If the MCP server exposes an auth tool (commonly `mcp_auth`):

- Call it **before** any tool that needs authentication.
- Store only the minimum auth state required (prefer short-lived session state).
- Never echo tokens/keys back to the user.

## Additional resources

- For templates (descriptors, validation patterns, error contracts), see [reference.md](reference.md).
- For end-to-end examples (new server integration, adding a new tool), see [examples.md](examples.md).

