import { webcrypto } from "node:crypto";
import {
  assertTenantScope,
  type TenantScope,
} from "../../auditflow-contracts/src/index.ts";
import type { AuditFlowBearerTokenResolver } from "./http.ts";

export type AuditFlowJwtAlgorithm = "RS256" | "ES256";

export interface AuditFlowJwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  scope?: string;
  scp?: string[];
  tenant_id?: string;
  actor_user_id?: string;
  [claim: string]: unknown;
}

export interface AuditFlowProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported: ["header"];
  resource_documentation?: string;
}

export interface AuditFlowJwtValidationOptions {
  issuer: string;
  audience: string;
  jwks: {
    keys: JsonWebKey[];
  };
  requiredScopes?: string[];
  allowedAlgorithms?: AuditFlowJwtAlgorithm[];
  clockToleranceSeconds?: number;
  tenantClaim?: string;
  actorUserClaim?: string;
  now?: () => number;
}

export type AuditFlowOAuthValidationFailureReason =
  | "malformed_token"
  | "unsupported_algorithm"
  | "unknown_key"
  | "invalid_signature"
  | "invalid_issuer"
  | "invalid_audience"
  | "expired_token"
  | "token_not_yet_valid"
  | "missing_subject"
  | "missing_scope"
  | "missing_tenant"
  | "invalid_scope";

export class AuditFlowOAuthValidationError extends Error {
  readonly reason: AuditFlowOAuthValidationFailureReason;
  readonly httpStatus: 401 | 403;

  constructor(reason: AuditFlowOAuthValidationFailureReason, message: string, httpStatus: 401 | 403 = 401) {
    super(message);
    this.name = "AuditFlowOAuthValidationError";
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function base64UrlToJson(value: string): Record<string, unknown> {
  const bytes = base64UrlToBytes(value);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
}

function splitJwt(token: string): [string, string, string] {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AuditFlowOAuthValidationError("malformed_token", "Access token must be a compact JWT.");
  }
  return parts as [string, string, string];
}

function algorithmParams(algorithm: AuditFlowJwtAlgorithm): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams {
  switch (algorithm) {
    case "RS256":
      return {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      };
    case "ES256":
      return {
        name: "ECDSA",
        namedCurve: "P-256",
      };
  }
}

function verifyParams(algorithm: AuditFlowJwtAlgorithm): AlgorithmIdentifier | EcdsaParams {
  if (algorithm === "ES256") {
    return {
      name: "ECDSA",
      hash: "SHA-256",
    };
  }
  return algorithmParams(algorithm) as AlgorithmIdentifier;
}

function requiredStringClaim(claims: AuditFlowJwtClaims, name: string): string {
  const value = claims[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuditFlowOAuthValidationError(
      name === "tenant_id" ? "missing_tenant" : "missing_subject",
      `Access token is missing required claim: ${name}.`,
    );
  }
  return value;
}

function tokenScopes(claims: AuditFlowJwtClaims): Set<string> {
  const scopes = new Set<string>();
  if (typeof claims.scope === "string") {
    for (const scope of claims.scope.split(" ").map((item) => item.trim()).filter(Boolean)) {
      scopes.add(scope);
    }
  }
  if (Array.isArray(claims.scp)) {
    for (const scope of claims.scp) scopes.add(scope);
  }
  return scopes;
}

function hasAudience(claims: AuditFlowJwtClaims, expectedAudience: string): boolean {
  if (typeof claims.aud === "string") return claims.aud === expectedAudience;
  if (Array.isArray(claims.aud)) return claims.aud.includes(expectedAudience);
  return false;
}

function keyMatchesHeader(key: JsonWebKey, header: Record<string, unknown>, algorithm: AuditFlowJwtAlgorithm): boolean {
  if (key.alg && key.alg !== algorithm) return false;
  if (key.use && key.use !== "sig") return false;
  if (header.kid && key.kid !== header.kid) return false;
  if (!header.kid && key.alg === algorithm) return true;
  return key.kid === header.kid;
}

async function importVerificationKey(key: JsonWebKey, algorithm: AuditFlowJwtAlgorithm): Promise<CryptoKey> {
  return webcrypto.subtle.importKey(
    "jwk",
    key,
    algorithmParams(algorithm),
    false,
    ["verify"],
  );
}

export async function validateJwtAccessToken(
  token: string,
  options: AuditFlowJwtValidationOptions,
): Promise<AuditFlowJwtClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = splitJwt(token);
  let header: Record<string, unknown>;
  let claims: AuditFlowJwtClaims;
  try {
    header = base64UrlToJson(encodedHeader);
    claims = base64UrlToJson(encodedPayload) as AuditFlowJwtClaims;
  } catch {
    throw new AuditFlowOAuthValidationError("malformed_token", "Access token header or payload is not valid JSON.");
  }

  const algorithm = header.alg;
  const allowedAlgorithms = options.allowedAlgorithms ?? ["RS256", "ES256"];
  if (
    typeof algorithm !== "string" ||
    !allowedAlgorithms.includes(algorithm as AuditFlowJwtAlgorithm)
  ) {
    throw new AuditFlowOAuthValidationError("unsupported_algorithm", "Access token uses an unsupported signing algorithm.");
  }

  const signingKey = options.jwks.keys.find((key) =>
    keyMatchesHeader(key, header, algorithm as AuditFlowJwtAlgorithm),
  );
  if (!signingKey) {
    throw new AuditFlowOAuthValidationError("unknown_key", "Access token signing key is not trusted.");
  }

  const cryptoKey = await importVerificationKey(signingKey, algorithm as AuditFlowJwtAlgorithm);
  const verified = await webcrypto.subtle.verify(
    verifyParams(algorithm as AuditFlowJwtAlgorithm),
    cryptoKey,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) {
    throw new AuditFlowOAuthValidationError("invalid_signature", "Access token signature is invalid.");
  }

  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSeconds ?? 60;
  if (claims.iss !== options.issuer) {
    throw new AuditFlowOAuthValidationError("invalid_issuer", "Access token issuer is not trusted.");
  }
  if (!hasAudience(claims, options.audience)) {
    throw new AuditFlowOAuthValidationError("invalid_audience", "Access token audience is not this MCP resource.");
  }
  if (typeof claims.exp !== "number" || claims.exp + tolerance < now) {
    throw new AuditFlowOAuthValidationError("expired_token", "Access token is expired.");
  }
  if (typeof claims.nbf === "number" && claims.nbf - tolerance > now) {
    throw new AuditFlowOAuthValidationError("token_not_yet_valid", "Access token is not valid yet.");
  }

  const requiredScopes = options.requiredScopes ?? [];
  if (requiredScopes.length > 0) {
    const scopes = tokenScopes(claims);
    if (scopes.size === 0) {
      throw new AuditFlowOAuthValidationError("missing_scope", "Access token has no scopes.", 403);
    }
    const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
    if (missingScopes.length > 0) {
      throw new AuditFlowOAuthValidationError(
        "invalid_scope",
        `Access token is missing required scope(s): ${missingScopes.join(", ")}.`,
        403,
      );
    }
  }

  return claims;
}

export function tenantScopeFromJwtClaims(
  claims: AuditFlowJwtClaims,
  options: Pick<AuditFlowJwtValidationOptions, "tenantClaim" | "actorUserClaim"> = {},
): TenantScope {
  const tenantClaim = options.tenantClaim ?? "tenant_id";
  const actorUserClaim = options.actorUserClaim ?? "actor_user_id";
  const scope = {
    tenantId: requiredStringClaim(claims, tenantClaim),
    actorUserId: typeof claims[actorUserClaim] === "string" && claims[actorUserClaim]
      ? claims[actorUserClaim] as string
      : claims.sub,
  };
  assertTenantScope(scope);
  return scope;
}

export function createJwtBearerScopeResolver(
  options: AuditFlowJwtValidationOptions,
): AuditFlowBearerTokenResolver {
  return async ({ token }) => tenantScopeFromJwtClaims(
    await validateJwtAccessToken(token, options),
    options,
  );
}

export function buildProtectedResourceMetadata(
  metadata: Omit<AuditFlowProtectedResourceMetadata, "bearer_methods_supported">,
): AuditFlowProtectedResourceMetadata {
  return {
    ...metadata,
    bearer_methods_supported: ["header"],
  };
}

export function createProtectedResourceMetadataUrl(
  resource: string,
  metadataPath = "/.well-known/oauth-protected-resource",
): string {
  const url = new URL(resource);
  url.pathname = metadataPath;
  url.search = "";
  url.hash = "";
  return url.toString();
}

