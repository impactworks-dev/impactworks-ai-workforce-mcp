# Cloudflare MCP Wrapper

This document describes the first Cloudflare deployment seam for the ImpactWorks AuditFlow MCP server.

## Purpose

Cloudflare is the selected default direction for edge-agent and remote MCP deployment work, but the production adoption decision remains open until the technical spike validates cost, local development, auth, deployment, and operational fit.

This PR starts the technical spike by adding:

- a dependency-free Cloudflare Worker adapter around the existing AuditFlow HTTP MCP handler,
- a Worker entrypoint at `workers/auditflow-mcp/src/index.ts`,
- an example Wrangler configuration at `workers/auditflow-mcp/wrangler.example.toml`,
- tests that verify `/health`, `/mcp`, OAuth metadata, bearer auth, origin checks, and isolate-level in-memory continuity.

## Cloudflare guidance reflected here

Cloudflare's current remote MCP guidance recommends `createMcpHandler()` for new stateless MCP servers and exposes remote MCP servers through Streamable HTTP, normally at `/mcp`. The guide also recommends testing with MCP Inspector and deploying to a `workers.dev` URL before connecting remote clients.

The current adapter keeps our product code independent from a specific Cloudflare SDK while preserving the same deployment shape:

- `GET /health` returns a lightweight status response.
- `POST /mcp` accepts MCP JSON-RPC messages.
- `GET /.well-known/oauth-protected-resource` returns OAuth protected-resource metadata when `IMPACTWORKS_MCP_RESOURCE` is configured.
- All tool access still goes through the same bearer/OAuth resolver and tenant-scope boundary as the local Node HTTP server.

## Local deployment skeleton

When ready to run a Cloudflare local development proof:

```bash
cp workers/auditflow-mcp/wrangler.example.toml workers/auditflow-mcp/wrangler.toml
```

Then install the Cloudflare runtime dependencies in a dedicated PR and run Wrangler from the worker folder.

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `IMPACTWORKS_MCP_ENDPOINT_PATH` | Defaults to `/mcp`; override only if a host requires another path. |
| `IMPACTWORKS_MCP_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the endpoint. |
| `IMPACTWORKS_MCP_RESOURCE` | Public MCP resource URL used for OAuth protected-resource metadata. |
| `IMPACTWORKS_AUTHORIZATION_SERVERS` | Comma-separated OAuth authorization-server URLs. |
| `IMPACTWORKS_OAUTH_ISSUER` | Expected issuer for JWT access tokens. |
| `IMPACTWORKS_OAUTH_AUDIENCE` | Expected token audience; defaults to `IMPACTWORKS_MCP_RESOURCE` when omitted. |
| `IMPACTWORKS_OAUTH_JWKS_JSON` | JWKS used to verify JWT access-token signatures. |
| `IMPACTWORKS_OAUTH_REQUIRED_SCOPES` | Required scopes, normally `auditflow:read,auditflow:write` during the first proof. |
| `IMPACTWORKS_OAUTH_TENANT_CLAIM` | Optional trusted tenant-claim name. |
| `IMPACTWORKS_OAUTH_ACTOR_USER_CLAIM` | Optional trusted user-claim name. |

For local-only proof work, the existing static bearer-token variables may still be used, but production should use OAuth-backed validation.

## Technical-spike checklist

Before confirming Cloudflare as production adopted:

1. Replace the in-memory runtime with a tenant-scoped persistent repository.
2. Install and pin Cloudflare/Wrangler dependencies.
3. Validate local Wrangler development against MCP Inspector.
4. Deploy a non-production Worker URL.
5. Verify OAuth protected-resource metadata and JWT validation from the deployed URL.
6. Verify ChatGPT developer-mode connection against the deployed `/mcp` URL.
7. Confirm logging, redaction, rate limits, rollback, and off-switch behavior.
8. Estimate expected Cloudflare cost under internal proof, pilot, and scaled usage.

No client-facing production use should begin until this checklist passes and Dante approves Cloudflare production adoption.
