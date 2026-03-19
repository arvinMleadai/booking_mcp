# MCP Server Integration — Examples

## Example 1: Integrate an existing MCP server in a repo

1. Locate the server folder and its `tools/*.json` descriptor files.
2. Read the descriptor for the tool you want to call.
3. Build arguments to exactly match the schema.
4. Call the tool.
5. Validate the response with a schema before using it.

## Example 2: Add a new “safe read-only” tool

Use a read-only tool variant when the user is exploring or debugging.

**Tool name**: `customer-get-by-email`

**Args**:
- `email` (string, required)

**Result**:
- `customer` (object | null)

Guardrails:
- Validate email format
- Enforce row-level permissions (if applicable)
- Redact PII fields unless explicitly needed

## Example 3: Add a write tool with idempotency

**Tool name**: `booking-create-appointment.v1`

**Args**:
- `idempotencyKey` (string, required)
- `customer` (object)
- `startTime` (ISO string)

Guardrails:
- Validate time zone expectations
- Retry only on safe transient failures
- Return a stable confirmation payload

