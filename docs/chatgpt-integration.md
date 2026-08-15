# ChatGPT Integration

This document defines the first OpenAI/ChatGPT host integration for the ImpactWorks AuditFlow MCP server.

## Integration boundary

ChatGPT is treated as a compatible external host for the AuditFlow MCP capability layer. It is not the policy authority, tenant authority, or source of official calculations. AuditFlow remains responsible for trusted tenant scope, deterministic scoring, ROI, solution-stack recommendations, roadmap persistence, and report assembly.

The first implementation checkpoint is a connection contract, not a live production connection:

- AuditFlow exposes a Streamable HTTP MCP endpoint at `/mcp`.
- Tool metadata includes `readOnlyHint` annotations and OAuth security schemes.
- The repository provides a ChatGPT/Responses API remote MCP configuration builder.
- Mutating tools require approval by default.
- Read-only analytical/reporting tools are allowed by default, subject to host/user policy.

## OpenAI requirements reflected here

The current OpenAI guidance for connecting and testing a ChatGPT plugin requires the MCP server to be reachable by public HTTPS or a Secure MCP Tunnel, with a Streamable HTTP endpoint normally ending in `/mcp`. ChatGPT developer mode can then add the MCP server URL, scan the available tools, and refresh metadata after tool names, descriptions, schemas, annotations, auth, or UI change.

For OAuth-backed MCP servers, the server must expose protected-resource metadata, challenge unauthenticated requests with a `WWW-Authenticate` resource metadata URL, and verify incoming access tokens for issuer, audience, expiry, scopes, and trusted tenant/user claims before dispatching tools.

## Tool scopes

| Tool | Scope | Default approval |
| --- | --- | --- |
| `create_audit` | `auditflow:write` | Always |
| `upsert_workflow` | `auditflow:write` | Always |
| `score_opportunities` | `auditflow:read` | Never |
| `estimate_roi` | `auditflow:read` | Never |
| `recommend_solution_stack` | `auditflow:read` | Never |
| `generate_roadmap` | `auditflow:write` | Always |
| `get_audit_report` | `auditflow:read` | Never |

The approval defaults are intentionally conservative. A host or deployment policy may still require approval for any read-only tool, especially when sensitive client data is involved.

## Responses API configuration example

```ts
import { createChatGptResponsesApiExample } from "../packages/auditflow-mcp/src/index.ts";

const responseRequest = createChatGptResponsesApiExample({
  serverUrl: "https://mcp.impactworks.example/mcp",
  authorization: accessToken,
});
```

The generated request includes:

- `type: "mcp"`
- `server_label: "impactworks_auditflow"`
- `server_url` ending in `/mcp`
- all seven AuditFlow tool names in `allowed_tools`
- an approval policy that keeps mutating tools behind human approval
- optional `authorization` and `headers` passthroughs for the calling application

## Local development

Local HTTP is allowed only for loopback development:

```ts
createChatGptResponsesApiExample({
  serverUrl: "http://localhost:8787/mcp",
  allowHttpLocalhost: true,
});
```

Any non-local URL must use HTTPS.

## Live connection checklist

Before claiming ChatGPT is live, verify:

1. The MCP endpoint is reachable through public HTTPS or Secure MCP Tunnel.
2. The configured URL includes `/mcp`.
3. `/.well-known/oauth-protected-resource` returns the expected resource metadata.
4. The authorization server issues tokens with the expected issuer, audience/resource, scopes, tenant claim, and subject claim.
5. ChatGPT developer mode scans all seven tools with the expected descriptions, schemas, annotations, and security schemes.
6. A read-only report request can call `get_audit_report` after valid authentication.
7. A mutating request such as `generate_roadmap` prompts for approval before dispatch.
8. The server rejects missing, expired, wrong-audience, wrong-issuer, insufficient-scope, or cross-tenant tokens.

No external client writes, public publishing, proposals, messages, purchases, permission changes, or client-system mutations should occur without explicit Dante approval.
