import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_MCP_PROTOCOL_VERSION,
  createStaticBearerScopeResolver,
  handleAuditFlowMcpHttpRequest,
  createInMemoryAuditFlowRuntime,
} from "../packages/auditflow-mcp/src/index.ts";
import type {
  AuditFlowHttpRequest,
  AuditFlowHttpServerOptions,
  JsonRpcSuccess,
} from "../packages/auditflow-mcp/src/index.ts";

const scope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};

function baseRequest(body: unknown, headers: Record<string, string | undefined> = {}): AuditFlowHttpRequest {
  return {
    method: "POST",
    path: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: "Bearer dev-token",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function options(): AuditFlowHttpServerOptions {
  const runtime = createInMemoryAuditFlowRuntime({ now: "2026-08-15T21:30:00.000Z" });
  return {
    deps: runtime.deps,
    allowedOrigins: ["http://localhost:3000"],
    resolveBearerToken: createStaticBearerScopeResolver({
      "dev-token": scope,
    }),
  };
}

test("AuditFlow HTTP MCP endpoint initializes over authenticated POST", async () => {
  const response = await handleAuditFlowMcpHttpRequest(
    baseRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: AUDITFLOW_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "http-test", version: "0.0.0" },
      },
    }),
    options(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["mcp-protocol-version"], AUDITFLOW_MCP_PROTOCOL_VERSION);
  const message = JSON.parse(response.body) as JsonRpcSuccess;
  assert.equal(message.id, 1);
  assert.deepEqual(message.result, {
    protocolVersion: AUDITFLOW_MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "impactworks-auditflow", version: "0.1.0" },
  });
});

test("AuditFlow HTTP MCP endpoint requires bearer auth before tool access", async () => {
  const missing = await handleAuditFlowMcpHttpRequest(
    baseRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      { authorization: undefined },
    ),
    options(),
  );
  assert.equal(missing.status, 401);
  assert.equal(missing.headers["www-authenticate"], "Bearer");

  const invalid = await handleAuditFlowMcpHttpRequest(
    baseRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      },
      { authorization: "Bearer wrong-token" },
    ),
    options(),
  );
  assert.equal(invalid.status, 401);
});

test("AuditFlow HTTP MCP endpoint rejects untrusted origins and unsupported methods", async () => {
  const forbiddenOrigin = await handleAuditFlowMcpHttpRequest(
    baseRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      },
      { origin: "https://evil.example" },
    ),
    options(),
  );
  assert.equal(forbiddenOrigin.status, 403);

  const get = await handleAuditFlowMcpHttpRequest(
    {
      method: "GET",
      path: "/mcp",
      headers: {
        accept: "text/event-stream",
        authorization: "Bearer dev-token",
      },
    },
    options(),
  );
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, "POST");
});

test("AuditFlow HTTP MCP endpoint runs a scoped tool call", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now: "2026-08-15T21:45:00.000Z" });
  const response = await handleAuditFlowMcpHttpRequest(
    baseRequest({
      jsonrpc: "2.0",
      id: "create",
      method: "tools/call",
      params: {
        name: "create_audit",
        arguments: {
          business: {
            name: "ImpactWorks",
            industry: "AI workforce strategy and implementation",
            employee_count: 2,
            primary_goal: "increase_capacity",
          },
        },
      },
    }),
    {
      deps: runtime.deps,
      resolveBearerToken: createStaticBearerScopeResolver({
        "dev-token": scope,
      }),
    },
  );

  assert.equal(response.status, 200);
  const message = JSON.parse(response.body) as JsonRpcSuccess;
  const result = message.result as {
    isError: boolean;
    structuredContent: { ok: true; output: { audit_id: string } };
  };
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.output.audit_id, "aud_0001");

  const record = await runtime.repositories.audits.getAudit(scope, "aud_0001");
  assert.equal(record?.tenantId, "ten_impactworks");
  assert.equal(record?.createdByUserId, "usr_dante");
});

test("AuditFlow HTTP MCP endpoint handles malformed requests safely", async () => {
  const unauthenticatedInvalidJson = await handleAuditFlowMcpHttpRequest(
    {
      method: "POST",
      path: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: "{",
    },
    options(),
  );
  assert.equal(unauthenticatedInvalidJson.status, 401);

  const invalidJson = await handleAuditFlowMcpHttpRequest(
    {
      method: "POST",
      path: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: "Bearer dev-token",
      },
      body: "{",
    },
    options(),
  );
  assert.equal(invalidJson.status, 400);
  assert.match(invalidJson.body, /-32700/);

  const notification = await handleAuditFlowMcpHttpRequest(
    baseRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    options(),
  );
  assert.equal(notification.status, 202);
  assert.equal(notification.body, "");
});
