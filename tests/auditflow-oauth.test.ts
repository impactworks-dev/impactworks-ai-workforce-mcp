import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  AuditFlowOAuthValidationError,
  createJwtBearerScopeResolver,
  tenantScopeFromJwtClaims,
  validateJwtAccessToken,
} from "../packages/auditflow-mcp/src/index.ts";

const encoder = new TextEncoder();
const issuer = "https://auth.impactworks.test";
const audience = "https://mcp.impactworks.test/mcp";
const now = 1_786_830_000;

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64url");
}

async function rsaFixture() {
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
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicJwk: {
      ...publicJwk,
      kid: "auditflow-key-1",
      alg: "RS256",
      use: "sig",
    },
  };
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const encodedHeader = base64Url(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    kid: "auditflow-key-1",
    ...header,
  }));
  const encodedPayload = base64Url(JSON.stringify(claims));
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  return `${encodedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

test("JWT access token validation derives tenant scope from trusted claims", async () => {
  const { privateKey, publicJwk } = await rsaFixture();
  const token = await signJwt(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: audience,
    exp: now + 600,
    scope: "auditflow:read auditflow:write",
    tenant_id: "ten_impactworks",
  });

  const claims = await validateJwtAccessToken(token, {
    issuer,
    audience,
    jwks: { keys: [publicJwk] },
    requiredScopes: ["auditflow:read"],
    now: () => now,
  });
  assert.equal(claims.sub, "usr_dante");
  assert.deepEqual(tenantScopeFromJwtClaims(claims), {
    tenantId: "ten_impactworks",
    actorUserId: "usr_dante",
  });

  const resolver = createJwtBearerScopeResolver({
    issuer,
    audience,
    jwks: { keys: [publicJwk] },
    requiredScopes: ["auditflow:write"],
    now: () => now,
  });
  assert.deepEqual(await resolver({ token, request: { method: "POST", path: "/mcp", headers: {} } }), {
    tenantId: "ten_impactworks",
    actorUserId: "usr_dante",
  });
});

test("JWT access token validation rejects wrong audience before tool dispatch", async () => {
  const { privateKey, publicJwk } = await rsaFixture();
  const token = await signJwt(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: "https://other-resource.example/mcp",
    exp: now + 600,
    scope: "auditflow:read",
    tenant_id: "ten_impactworks",
  });

  await assert.rejects(
    () => validateJwtAccessToken(token, {
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
      requiredScopes: ["auditflow:read"],
      now: () => now,
    }),
    (error) =>
      error instanceof AuditFlowOAuthValidationError &&
      error.reason === "invalid_audience" &&
      error.httpStatus === 401,
  );
});

test("JWT access token validation rejects expired and insufficient-scope tokens", async () => {
  const { privateKey, publicJwk } = await rsaFixture();
  const expired = await signJwt(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: audience,
    exp: now - 120,
    scope: "auditflow:read",
    tenant_id: "ten_impactworks",
  });
  await assert.rejects(
    () => validateJwtAccessToken(expired, {
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
      requiredScopes: ["auditflow:read"],
      now: () => now,
      clockToleranceSeconds: 0,
    }),
    (error) =>
      error instanceof AuditFlowOAuthValidationError &&
      error.reason === "expired_token" &&
      error.httpStatus === 401,
  );

  const insufficientScope = await signJwt(privateKey, {
    iss: issuer,
    sub: "usr_dante",
    aud: audience,
    exp: now + 600,
    scope: "auditflow:read",
    tenant_id: "ten_impactworks",
  });
  await assert.rejects(
    () => validateJwtAccessToken(insufficientScope, {
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
      requiredScopes: ["auditflow:write"],
      now: () => now,
    }),
    (error) =>
      error instanceof AuditFlowOAuthValidationError &&
      error.reason === "invalid_scope" &&
      error.httpStatus === 403,
  );
});

