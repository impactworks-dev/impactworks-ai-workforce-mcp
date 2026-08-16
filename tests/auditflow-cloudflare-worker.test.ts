import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_MCP_PROTOCOL_VERSION,
  createAuditFlowCloudflareMcpWorker,
} from "../packages/auditflow-mcp/src/index.ts";
import type { AuditFlowCloudflareEnvironment, JsonRpcSuccess } from "../packages/auditflow-mcp/src/index.ts";

const env: AuditFlowCloudflareEnvironment = {
  IMPACTWORKS_MCP_BEARER_TOKEN: "local-token",
  IMPACTWORKS_TENANT_ID: "ten_impactworks",
  IMPACTWORKS_ACTOR_USER_ID: "usr_dante",
};

function mcpRequest(body: unknown, overrides: RequestInit = {}): Request {
  const { headers, ...rest } = overrides;
  return new Request("https://auditflow-mcp.impactworks.workers.dev/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer local-token",
      "content-type": "application/json",
      ...(headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
    ...rest,
  });
}

test("Cloudflare MCP worker adapter exposes health without reading a GET body", async () => {
  const worker = createAuditFlowCloudflareMcpWorker();
  const response = await worker.fetch(
    new Request("https://auditflow-mcp.impactworks.workers.dev/health"),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "impactworks-auditflow",
  });
});

test("Cloudflare MCP worker adapter lists AuditFlow tools over the /mcp endpoint", async () => {
  const worker = createAuditFlowCloudflareMcpWorker();
  const response = await worker.fetch(
    mcpRequest({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-protocol-version"), AUDITFLOW_MCP_PROTOCOL_VERSION);
  const message = await response.json() as JsonRpcSuccess;
  const result = message.result as { tools: { name: string }[] };
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    [
      "create_audit",
      "upsert_workflow",
      "score_opportunities",
      "estimate_roi",
      "recommend_solution_stack",
      "generate_roadmap",
      "get_audit_report",
    ],
  );
});

test("Cloudflare MCP worker adapter preserves runtime state across isolate requests", async () => {
  const worker = createAuditFlowCloudflareMcpWorker();
  const created = await worker.fetch(
    mcpRequest({
      jsonrpc: "2.0",
      id: "create",
      method: "tools/call",
      params: {
        name: "create_audit",
        arguments: {
          business: {
            name: "ImpactWorks",
            industry: "AI workforce strategy",
            employee_count: 2,
            primary_goal: "increase_capacity",
          },
        },
      },
    }),
    env,
  );
  assert.equal(created.status, 200);

  const report = await worker.fetch(
    mcpRequest({
      jsonrpc: "2.0",
      id: "report",
      method: "tools/call",
      params: {
        name: "get_audit_report",
        arguments: {
          audit_id: "aud_0001",
          audience: "owner",
          detail_level: "executive",
        },
      },
    }),
    env,
  );

  assert.equal(report.status, 200);
  const message = await report.json() as JsonRpcSuccess;
  const result = message.result as { structuredContent: { ok: true; output: { audit_id: string } } };
  assert.equal(result.structuredContent.output.audit_id, "aud_0001");
});

test("Cloudflare MCP worker adapter exposes OAuth resource metadata from environment", async () => {
  const worker = createAuditFlowCloudflareMcpWorker();
  const response = await worker.fetch(
    new Request("https://auditflow-mcp.impactworks.workers.dev/.well-known/oauth-protected-resource"),
    {
      ...env,
      IMPACTWORKS_MCP_RESOURCE: "https://auditflow-mcp.impactworks.workers.dev/mcp",
      IMPACTWORKS_AUTHORIZATION_SERVERS: "https://auth.impactworks.test",
      IMPACTWORKS_OAUTH_REQUIRED_SCOPES: "auditflow:read,auditflow:write",
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    resource: "https://auditflow-mcp.impactworks.workers.dev/mcp",
    authorization_servers: ["https://auth.impactworks.test"],
    scopes_supported: ["auditflow:read", "auditflow:write"],
    bearer_methods_supported: ["header"],
  });
});

test("Cloudflare MCP worker adapter keeps auth and origin checks at the edge boundary", async () => {
  const worker = createAuditFlowCloudflareMcpWorker();

  const missingToken = await worker.fetch(
    new Request("https://auditflow-mcp.impactworks.workers.dev/mcp", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    }),
    {
      ...env,
      IMPACTWORKS_MCP_RESOURCE: "https://auditflow-mcp.impactworks.workers.dev/mcp",
    },
  );
  assert.equal(missingToken.status, 401);
  assert.equal(
    missingToken.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://auditflow-mcp.impactworks.workers.dev/.well-known/oauth-protected-resource"',
  );

  const forbiddenOrigin = await worker.fetch(
    mcpRequest(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      { headers: { origin: "https://untrusted.example" } },
    ),
    {
      ...env,
      IMPACTWORKS_MCP_ALLOWED_ORIGINS: "https://app.impactworks.com",
    },
  );
  assert.equal(forbiddenOrigin.status, 403);
  assert.deepEqual(await forbiddenOrigin.json(), { error: "origin_forbidden" });
});
