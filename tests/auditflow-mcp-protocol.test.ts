import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_MCP_PROTOCOL_VERSION,
  createAuditFlowMcpProtocolServer,
  createEnvTenantScopeResolver,
  createInMemoryAuditFlowRuntime,
} from "../packages/auditflow-mcp/src/index.ts";
import type { JsonRpcResponse, JsonRpcSuccess } from "../packages/auditflow-mcp/src/index.ts";

const scope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};

function assertSuccess(response: JsonRpcResponse | null): asserts response is JsonRpcSuccess {
  assert.ok(response);
  assert.equal(response.jsonrpc, "2.0");
  assert.ok("result" in response);
}

test("AuditFlow MCP adapter initializes and lists deterministic tools", async () => {
  const runtime = createInMemoryAuditFlowRuntime();
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: () => scope,
  });

  const initialized = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: AUDITFLOW_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    },
  });
  assertSuccess(initialized);
  assert.deepEqual(initialized.result, {
    protocolVersion: AUDITFLOW_MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "impactworks-auditflow", version: "0.1.0" },
  });

  const listed = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assertSuccess(listed);
  const tools = (listed.result as { tools: { name: string; inputSchema: Record<string, unknown> }[] }).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
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
  assert.equal(JSON.stringify(tools[0].inputSchema).includes("tenant_id"), false);
  assert.equal(JSON.stringify(tools[0].inputSchema).includes("actorUserId"), false);
});

test("AuditFlow MCP adapter injects trusted scope and returns structured tool output", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now: "2026-08-15T21:00:00.000Z" });
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: () => scope,
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: "call-1",
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
  });

  assertSuccess(response);
  const result = response.result as {
    isError: boolean;
    structuredContent: { ok: true; output: { audit_id: string } };
  };
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.output.audit_id, "aud_0001");

  const record = await runtime.repositories.audits.getAudit(scope, "aud_0001");
  assert.equal(record?.tenantId, "ten_impactworks");
  assert.equal(record?.createdByUserId, "usr_dante");
});

test("AuditFlow MCP adapter returns tool errors as MCP tool results", async () => {
  const runtime = createInMemoryAuditFlowRuntime();
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: () => scope,
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "create_audit",
      arguments: {
        tenant_id: "ten_from_model",
        business: {
          name: "ImpactWorks",
          industry: "AI workforce strategy and implementation",
          employee_count: 2,
          primary_goal: "increase_capacity",
        },
      },
    },
  });

  assertSuccess(response);
  const result = response.result as {
    isError: boolean;
    structuredContent: { ok: false; error: { code: string; missing: string[] } };
  };
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "VALIDATION_FAILED");
  assert.ok(result.structuredContent.error.missing.includes("input.tenant_id is not allowed"));
});

test("AuditFlow MCP adapter rejects unknown tools as protocol parameter errors", async () => {
  const runtime = createInMemoryAuditFlowRuntime();
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: () => scope,
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "delete_everything",
      arguments: {},
    },
  });

  assert.ok(response);
  assert.equal(response.jsonrpc, "2.0");
  assert.ok("error" in response);
  assert.equal(response.error.code, -32602);
});

test("AuditFlow MCP stdio line handler and env scope resolver are deterministic", async () => {
  const runtime = createInMemoryAuditFlowRuntime();
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: createEnvTenantScopeResolver({
      IMPACTWORKS_TENANT_ID: "ten_env",
      IMPACTWORKS_ACTOR_USER_ID: "usr_env",
    }),
  });

  const responseLine = await server.handleJsonLine(JSON.stringify({
    jsonrpc: "2.0",
    id: "line-1",
    method: "tools/call",
    params: {
      name: "create_audit",
      arguments: {
        business: {
          name: "Env Tenant",
          industry: "Operations",
          employee_count: 3,
          primary_goal: "reduce_cost",
        },
      },
    },
  }));

  assert.ok(responseLine);
  const response = JSON.parse(responseLine) as JsonRpcSuccess;
  assert.equal(response.id, "line-1");
  const result = response.result as { structuredContent: { ok: true; output: { audit_id: string } } };
  assert.equal(result.structuredContent.output.audit_id, "aud_0001");

  const record = await runtime.repositories.audits.getAudit(
    { tenantId: "ten_env", actorUserId: "usr_env" },
    "aud_0001",
  );
  assert.equal(record?.createdByUserId, "usr_env");
});
