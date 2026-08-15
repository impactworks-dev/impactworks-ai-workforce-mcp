import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  AUDITFLOW_MCP_PROTOCOL_VERSION,
  buildProtectedResourceMetadata,
  createJwtBearerScopeResolver,
  createInMemoryAuditFlowRuntime,
  createProtectedResourceMetadataUrl,
  handleAuditFlowMcpHttpRequest,
} from "../packages/auditflow-mcp/src/index.ts";
import type { AuditFlowHttpRequest, JsonRpcSuccess } from "../packages/auditflow-mcp/src/index.ts";

const encoder = new TextEncoder();
const issuer = "https://auth.impactworks.test";
const resource = "https://mcp.impactworks.test/mcp";
const now = 1_786_830_000;

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64url");
}

async function keys() {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicJwk: { ...jwk, kid: "oauth-http-key", alg: "RS256", use: "sig" },
  };
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "oauth-http-key" }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

function request(token: string, body: unknown): AuditFlowHttpRequest {
  return {
    method: "POST",
    path: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  };
}

test("HTTP MCP endpoint exposes protected-resource metadata and WWW-Authenticate discovery", async () => {
  const runtime = createInMemoryAuditFlowRuntime();
  const metadata = buildProtectedResourceMetadata({
    resource,
    authorization_servers: [issuer],
    scopes_supported: ["auditflow:read", "auditflow:write"],
  });

  const metadataResponse = await handleAuditFlowMcpHttpRequest(
    { method: "GET", path: "/.well-known/oauth-protected-resource", headers: {} },
    {
      deps: runtime.deps,
      resolveBearerToken: () => null,
      protectedResourceMetadata: metadata,
    },
  );
  assert.equal(metadataResponse.status, 200);
  assert.deepEqual(JSON.parse(metadataResponse.body), metadata);

  const unauthorized = await handleAuditFlowMcpHttpRequest(
    {
      method: "POST",
      path: "/mcp",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    {
      deps: runtime.deps,
      resolveBearerToken: () => null,
      protectedResourceMetadata: metadata,
    },
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(
    unauthorized.headers["www-authenticate"],
    `Bearer resource_metadata="${createProtectedResourceMetadataUrl(resource)}"`,
  );
});

test("HTTP MCP endpoint validates OAuth JWTs before dispatching tools", async () => {
  const { privateKey, publicJwk } = await keys();
  const token = await sign(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: resource,
    exp: now + 600,
    scope: "auditflow:read auditflow:write",
    tenant_id: "ten_impactworks",
  });
  const runtime = createInMemoryAuditFlowRuntime();

  const response = await handleAuditFlowMcpHttpRequest(
    request(token, {
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
      resolveBearerToken: createJwtBearerScopeResolver({
        issuer,
        audience: resource,
        jwks: { keys: [publicJwk] },
        requiredScopes: ["auditflow:write"],
        now: () => now,
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["mcp-protocol-version"], AUDITFLOW_MCP_PROTOCOL_VERSION);
  const message = JSON.parse(response.body) as JsonRpcSuccess;
  const result = message.result as { structuredContent: { ok: true; output: { audit_id: string } } };
  assert.equal(result.structuredContent.output.audit_id, "aud_0001");

  const record = await runtime.repositories.audits.getAudit(
    { tenantId: "ten_impactworks", actorUserId: "usr_dante" },
    "aud_0001",
  );
  assert.equal(record?.createdByUserId, "usr_dante");
});

test("HTTP MCP endpoint returns 403 for insufficient OAuth scopes", async () => {
  const { privateKey, publicJwk } = await keys();
  const token = await sign(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: resource,
    exp: now + 600,
    scope: "auditflow:read",
    tenant_id: "ten_impactworks",
  });
  const runtime = createInMemoryAuditFlowRuntime();

  const response = await handleAuditFlowMcpHttpRequest(
    request(token, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    {
      deps: runtime.deps,
      resolveBearerToken: createJwtBearerScopeResolver({
        issuer,
        audience: resource,
        jwks: { keys: [publicJwk] },
        requiredScopes: ["auditflow:write"],
        now: () => now,
      }),
    },
  );

  assert.equal(response.status, 403);
  assert.match(response.body, /invalid_scope/);
});

