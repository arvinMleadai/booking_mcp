# MCP Servers: Reference (Architecture & Production)

Deep-dive material for architecture, security, and operations. Use when designing for production or hardening an existing server.

## Architectural Principles

### Single Responsibility

Each MCP server should have one well-defined purpose (e.g. booking, file access, one API). Benefits: clear ownership, isolated failures, independent scaling.

### Defense in Depth

Layer security controls:

1. **Network:** Bind to localhost for stdio; firewall/TLS for HTTP.
2. **Authentication:** Verify identity (API key, OAuth, mTLS) before handling requests.
3. **Authorization:** Check permissions per tool/resource (e.g. capability-based).
4. **Input validation:** Strict schema validation (Zod) on every tool argument.
5. **Output sanitization:** Avoid leaking internal errors or sensitive data in responses.
6. **Monitoring:** Audit logging, metrics, alerting.

### Fail-Safe Design

- **Circuit breakers** for downstream services to avoid cascading failures.
- **Caching** (with TTL) for read-heavy tools to reduce load and improve latency.
- **Rate limiting** to protect the server and backends.
- **Graceful degradation:** Return a safe, structured error instead of crashing; log full context server-side.

## Configuration

- Externalize config (env vars, config files). Use env-specific overrides (e.g. `MCP_*` prefix).
- Validate config at startup (e.g. required URLs, timeouts, feature flags).
- Never commit secrets; use a secret manager or env in production.

## Error Classification

- **Client error (4xx):** Invalid input, permission denied. Return clear message; do not retry blindly.
- **Server error (5xx):** Our bug or misconfiguration. Log, alert, return generic message.
- **External error (502/503):** Dependency failure. Consider retry with backoff; expose `retry_after` if applicable.

Structure errors in tool responses consistently (e.g. `code`, `message`, optional `details`) so clients can handle them.

## Performance

- **Connection pooling** for DB/HTTP clients used by tools.
- **Timeouts** on every external call (DB, HTTP, queues).
- **Pagination** for list-style tools; use opaque tokens for continuation.
- **Async/heavy work:** Prefer returning a task ID and letting the client poll, or use streaming if the protocol supports it, rather than blocking the transport.

## Monitoring & Health

- **Structured logging:** JSON logs with request ID, tool name, duration, status. No secrets or PII.
- **Metrics:** Request count, latency (p50/p95/p99), error rate per tool or endpoint.
- **Health checks:** `/health` (liveness) and `/ready` (readiness, e.g. DB and caches up). Use for orchestrators (Kubernetes, etc.).

## Remote HTTP & OAuth (Production)

For Streamable HTTP in production:

- **TLS** required. Prefer OAuth 2.1 (or current spec) for auth when the spec mandates it.
- **Resource indicators** (e.g. RFC 8707) to bind tokens to this server and avoid token reuse.
- **Rate limiting and quotas** per client or tenant to avoid abuse.

## Testing

- **Unit:** Tool handlers with valid/invalid inputs; mock external services.
- **Integration:** Real transport (stdio or HTTP) against a test backend.
- **Contract:** Verify `initialize`, `tools/list`, `resources/list` (and optionally `prompts/list`) match what clients expect.
- **Load:** Stress test with concurrent requests to validate limits and timeouts.

## Deployment

- **Containers:** Use a non-root user, minimal image, and health checks.
- **Orchestration:** Use readiness/liveness probes; set resource limits and consider HPA for HTTP servers.
- **Zero-downtime:** Prefer rolling updates and drain before shutdown.

## References

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP Best Practices (modelcontextprotocol.info)](https://modelcontextprotocol.info/docs/best-practices/)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
