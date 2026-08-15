import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_TOOL_NAMES,
  MUTATING_AUDITFLOW_TOOLS,
  READ_ONLY_AUDITFLOW_TOOLS,
  type AuditFlowToolName,
} from "../packages/auditflow-contracts/src/index.ts";
import {
  CHATGPT_AUDITFLOW_READ_SCOPE,
  CHATGPT_AUDITFLOW_SERVER_LABEL,
  CHATGPT_AUDITFLOW_WRITE_SCOPE,
  auditFlowToolScopes,
  createChatGptAuditFlowRemoteMcpTool,
  defaultChatGptApprovalPolicy,
  listAuditFlowMcpTools,
} from "../packages/auditflow-mcp/src/index.ts";
import type { ChatGptMcpApprovalPolicy } from "../packages/auditflow-mcp/src/index.ts";

test("AuditFlow MCP tool metadata advertises ChatGPT-compatible OAuth scopes", () => {
  const tools = listAuditFlowMcpTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    AUDITFLOW_TOOL_NAMES,
  );

  for (const tool of tools) {
    const expectedScope = READ_ONLY_AUDITFLOW_TOOLS.includes(tool.name)
      ? CHATGPT_AUDITFLOW_READ_SCOPE
      : CHATGPT_AUDITFLOW_WRITE_SCOPE;

    assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: [expectedScope] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
});

test("AuditFlow ChatGPT integration maps tool scopes by read/write behavior", () => {
  for (const toolName of READ_ONLY_AUDITFLOW_TOOLS) {
    assert.deepEqual(auditFlowToolScopes(toolName), [CHATGPT_AUDITFLOW_READ_SCOPE]);
  }

  for (const toolName of MUTATING_AUDITFLOW_TOOLS) {
    assert.deepEqual(auditFlowToolScopes(toolName), [CHATGPT_AUDITFLOW_WRITE_SCOPE]);
  }
});

test("AuditFlow ChatGPT remote MCP config uses bounded tools and approval defaults", () => {
  const config = createChatGptAuditFlowRemoteMcpTool({
    serverUrl: "https://mcp.impactworks.test/mcp",
    authorization: "oauth-access-token",
  });

  assert.equal(config.type, "mcp");
  assert.equal(config.server_label, CHATGPT_AUDITFLOW_SERVER_LABEL);
  assert.equal(config.server_url, "https://mcp.impactworks.test/mcp");
  assert.equal(config.authorization, "oauth-access-token");
  assert.deepEqual(config.allowed_tools, [...AUDITFLOW_TOOL_NAMES]);
  assert.deepEqual(config.require_approval, defaultChatGptApprovalPolicy());
});

test("AuditFlow ChatGPT approval defaults keep mutating tools behind approval", () => {
  const approval = defaultChatGptApprovalPolicy() as Exclude<ChatGptMcpApprovalPolicy, string>;

  assert.equal(approval.always?.read_only, false);
  assert.deepEqual(approval.always?.tool_names, [...MUTATING_AUDITFLOW_TOOLS]);
  assert.equal(approval.never?.read_only, true);
  assert.deepEqual(approval.never?.tool_names, [...READ_ONLY_AUDITFLOW_TOOLS]);
});

test("AuditFlow ChatGPT remote MCP config validates host URL and tool filters", () => {
  assert.throws(
    () => createChatGptAuditFlowRemoteMcpTool({ serverUrl: "http://mcp.impactworks.test/mcp" }),
    /must be HTTPS/,
  );

  assert.throws(
    () => createChatGptAuditFlowRemoteMcpTool({ serverUrl: "https://mcp.impactworks.test/api" }),
    /\/mcp endpoint/,
  );

  assert.doesNotThrow(() =>
    createChatGptAuditFlowRemoteMcpTool({
      serverUrl: "http://localhost:8787/mcp",
      allowHttpLocalhost: true,
    }),
  );

  assert.throws(
    () =>
      createChatGptAuditFlowRemoteMcpTool({
        serverUrl: "https://mcp.impactworks.test/mcp",
        allowedTools: ["create_audit", "delete_everything" as AuditFlowToolName],
      }),
    /Unsupported AuditFlow tool/,
  );
});
