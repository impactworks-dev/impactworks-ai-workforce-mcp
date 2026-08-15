import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  assertTenantScope,
  type TenantScope,
} from "../../auditflow-contracts/src/index.ts";
import {
  buildProtectedResourceMetadata,
  createJwtBearerScopeResolver,
  createProtectedResourceMetadataUrl,
  type AuditFlowJwtValidationOptions,
  type AuditFlowOAuthValidationError,
  type AuditFlowProtectedResourceMetadata,
} from "./oauth.ts";
import {
  AUDITFLOW_MCP_PROTOCOL_VERSION,
  createAuditFlowMcpProtocolServer,
  type AuditFlowMcpServerInfo,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./mcp.ts";
import { createInMemoryAuditFlowRuntime } from "./runtime.ts";

export interface AuditFlowHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface AuditFlowHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AuditFlowHttpAuthContext {
  token: string;
  request: AuditFlowHttpRequest;
  message?: JsonRpcRequest;
}

export type AuditFlowBearerTokenResolver = (
  context: AuditFlowHttpAuthContext,
) => TenantScope | null | Promise<TenantScope | null>;

export interface AuditFlowHttpServerOptions {
  deps: Parameters<typeof createAuditFlowMcpProtocolServer>[0]["deps"];
  resolveBearerToken: AuditFlowBearerTokenResolver;
  endpointPath?: string;
  allowedOrigins?: string[];
  serverInfo?: Partial<AuditFlowMcpServerInfo>;
  protectedResourceMetadata?: AuditFlowProtectedResourceMetadata;
  protectedResourceMetadataPath?: string;
  protectedResourceMetadataUrl?: string;
}

export interface AuditFlowHttpRuntimeOptions {
  env?: AuditFlowHttpEnvironment;
  port?: number;
  host?: string;
  endpointPath?: string;
  allowedOrigins?: string[];
}

export interface AuditFlowHttpEnvironment {
  IMPACTWORKS_MCP_BEARER_TOKEN?: string;
  IMPACTWORKS_TENANT_ID?: string;
  IMPACTWORKS_ACTOR_USER_ID?: string;
  IMPACTWORKS_MCP_PORT?: string;
  IMPACTWORKS_MCP_HOST?: string;
  IMPACTWORKS_MCP_ALLOWED_ORIGINS?: string;
  IMPACTWORKS_MCP_RESOURCE?: string;
  IMPACTWORKS_AUTHORIZATION_SERVERS?: string;
  IMPACTWORKS_OAUTH_ISSUER?: string;
  IMPACTWORKS_OAUTH_AUDIENCE?: string;
  IMPACTWORKS_OAUTH_JWKS_JSON?: string;
  IMPACTWORKS_OAUTH_REQUIRED_SCOPES?: string;
  IMPACTWORKS_OAUTH_TENANT_CLAIM?: string;
  IMPACTWORKS_OAUTH_ACTOR_USER_CLAIM?: string;
}

export interface StartedAuditFlowHttpServer {
  close(): Promise<void>;
  host: string;
  port: number;
  endpointPath: string;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
};

function lowerCaseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): AuditFlowHttpResponse {
  return {
    status,
    headers: {
      ...jsonHeaders,
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function emptyResponse(status: number, headers: Record<string, string> = {}): AuditFlowHttpResponse {
  return {
    status,
    headers,
    body: "",
  };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "" || accept.includes("*/*")) return true;
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.startsWith("application/json"));
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return contentType.toLowerCase().split(";")[0].trim() === "application/json";
}

function originAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined || origin.trim() === "") return true;
  return allowedOrigins.includes(origin);
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function unauthorized(options: AuditFlowHttpServerOptions): AuditFlowHttpResponse {
  const headers: Record<string, string> = {
    "www-authenticate": "Bearer",
  };
  const metadataUrl = options.protectedResourceMetadataUrl ??
    (options.protectedResourceMetadata
      ? createProtectedResourceMetadataUrl(
        options.protectedResourceMetadata.resource,
        options.protectedResourceMetadataPath,
      )
      : undefined);
  if (metadataUrl) {
    headers["www-authenticate"] =
      `Bearer resource_metadata="${metadataUrl}"`;
  }
  return jsonResponse(401, { error: "unauthorized" }, headers);
}

function forbidden(error: AuditFlowOAuthValidationError): AuditFlowHttpResponse {
  return jsonResponse(403, {
    error: "forbidden",
    reason: error.reason,
  });
}

function assertJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("JSON-RPC message must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0") {
    throw new Error("JSON-RPC version must be 2.0.");
  }
  if (typeof record.method !== "string") {
    throw new Error("JSON-RPC method must be a string.");
  }
  if (
    "id" in record &&
    typeof record.id !== "string" &&
    typeof record.id !== "number" &&
    record.id !== null
  ) {
    throw new Error("JSON-RPC id must be a string, number, or null.");
  }
  return value as JsonRpcRequest;
}

function requestId(value: unknown): string | number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

async function authenticatedScope(
  request: AuditFlowHttpRequest,
  message: JsonRpcRequest | undefined,
  options: AuditFlowHttpServerOptions,
): Promise<TenantScope | null> {
  const token = bearerToken(request.headers.authorization);
  if (!token) return null;
  const scope = await options.resolveBearerToken({ token, request, message });
  if (!scope) return null;
  assertTenantScope(scope);
  return scope;
}

export async function handleAuditFlowMcpHttpRequest(
  request: AuditFlowHttpRequest,
  options: AuditFlowHttpServerOptions,
): Promise<AuditFlowHttpResponse> {
  const endpointPath = options.endpointPath ?? "/mcp";
  const protectedResourceMetadataPath =
    options.protectedResourceMetadataPath ?? "/.well-known/oauth-protected-resource";

  if (request.path === "/health" && request.method === "GET") {
    return jsonResponse(200, { ok: true, service: options.serverInfo?.name ?? "impactworks-auditflow" });
  }

  if (
    options.protectedResourceMetadata &&
    request.path === protectedResourceMetadataPath &&
    request.method === "GET"
  ) {
    return jsonResponse(200, options.protectedResourceMetadata);
  }

  if (request.path !== endpointPath) {
    return jsonResponse(404, { error: "not_found" });
  }

  if (!originAllowed(request.headers.origin, options.allowedOrigins ?? [])) {
    return jsonResponse(403, { error: "origin_forbidden" });
  }

  if (request.method === "GET") {
    return emptyResponse(405, { allow: "POST" });
  }

  if (request.method !== "POST") {
    return emptyResponse(405, { allow: "POST" });
  }

  if (!acceptsJson(request.headers.accept)) {
    return jsonResponse(406, { error: "not_acceptable" });
  }

  if (!isJsonContentType(request.headers["content-type"])) {
    return jsonResponse(415, { error: "unsupported_media_type" });
  }

  let scope: TenantScope | null;
  try {
    scope = await authenticatedScope(request, undefined, options);
    if (!scope) {
      return unauthorized(options);
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AuditFlowOAuthValidationError"
    ) {
      const oauthError = error as AuditFlowOAuthValidationError;
      return oauthError.httpStatus === 403 ? forbidden(oauthError) : unauthorized(options);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body ?? "");
  } catch {
    return jsonResponse(400, jsonRpcError(null, -32700, "Invalid JSON."));
  }

  let message: JsonRpcRequest;
  try {
    message = assertJsonRpcRequest(parsed);
  } catch (error) {
    return jsonResponse(
      400,
      jsonRpcError(
        requestId(parsed),
        -32600,
        error instanceof Error ? error.message : "Invalid JSON-RPC request.",
      ),
    );
  }

  if (isNotification(message)) {
    return emptyResponse(202);
  }

  const server = createAuditFlowMcpProtocolServer({
    deps: options.deps,
    serverInfo: options.serverInfo,
    resolveScope: () => scope,
  });
  const result = await server.handleMessage(message);
  if (!result) return emptyResponse(202);
  return jsonResponse(200, result, {
    "mcp-protocol-version": AUDITFLOW_MCP_PROTOCOL_VERSION,
  });
}

export function createStaticBearerScopeResolver(
  scopesByToken: ReadonlyMap<string, TenantScope> | Record<string, TenantScope>,
): AuditFlowBearerTokenResolver {
  const map = scopesByToken instanceof Map ? scopesByToken : new Map(Object.entries(scopesByToken));
  return ({ token }) => map.get(token) ?? null;
}

export function createEnvBearerScopeResolver(
  env: AuditFlowHttpEnvironment = process.env,
): AuditFlowBearerTokenResolver {
  return ({ token }) => {
    if (!env.IMPACTWORKS_MCP_BEARER_TOKEN || token !== env.IMPACTWORKS_MCP_BEARER_TOKEN) {
      return null;
    }
    const scope = {
      tenantId: env.IMPACTWORKS_TENANT_ID,
      actorUserId: env.IMPACTWORKS_ACTOR_USER_ID,
    };
    assertTenantScope(scope);
    return scope;
  };
}

function commaSeparated(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createEnvOAuthScopeResolver(
  env: AuditFlowHttpEnvironment = process.env,
): AuditFlowBearerTokenResolver {
  const issuer = env.IMPACTWORKS_OAUTH_ISSUER;
  const audience = env.IMPACTWORKS_OAUTH_AUDIENCE ?? env.IMPACTWORKS_MCP_RESOURCE;
  const jwksJson = env.IMPACTWORKS_OAUTH_JWKS_JSON;
  if (!issuer || !audience || !jwksJson) {
    return createEnvBearerScopeResolver(env);
  }
  const validationOptions: AuditFlowJwtValidationOptions = {
    issuer,
    audience,
    jwks: JSON.parse(jwksJson) as { keys: JsonWebKey[] },
    requiredScopes: commaSeparated(env.IMPACTWORKS_OAUTH_REQUIRED_SCOPES),
    tenantClaim: env.IMPACTWORKS_OAUTH_TENANT_CLAIM,
    actorUserClaim: env.IMPACTWORKS_OAUTH_ACTOR_USER_CLAIM,
  };
  return createJwtBearerScopeResolver(validationOptions);
}

function parseAllowedOrigins(env: AuditFlowHttpEnvironment): string[] {
  return (env.IMPACTWORKS_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeHttpResponse(response: ServerResponse, result: AuditFlowHttpResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

export async function startAuditFlowMcpHttpServer(
  options: AuditFlowHttpRuntimeOptions = {},
): Promise<StartedAuditFlowHttpServer> {
  const env = options.env ?? process.env;
  const runtime = createInMemoryAuditFlowRuntime();
  const host = options.host ?? env.IMPACTWORKS_MCP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(env.IMPACTWORKS_MCP_PORT ?? 3030);
  const endpointPath = options.endpointPath ?? "/mcp";
  const handlerOptions: AuditFlowHttpServerOptions = {
    deps: runtime.deps,
    endpointPath,
    allowedOrigins: options.allowedOrigins ?? parseAllowedOrigins(env),
    resolveBearerToken: createEnvOAuthScopeResolver(env),
    protectedResourceMetadata: env.IMPACTWORKS_MCP_RESOURCE
      ? buildProtectedResourceMetadata({
        resource: env.IMPACTWORKS_MCP_RESOURCE,
        authorization_servers: commaSeparated(env.IMPACTWORKS_AUTHORIZATION_SERVERS),
        scopes_supported: commaSeparated(env.IMPACTWORKS_OAUTH_REQUIRED_SCOPES),
      })
      : undefined,
  };
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`);
      const response = await handleAuditFlowMcpHttpRequest(
        {
          method: incoming.method ?? "GET",
          path: url.pathname,
          headers: lowerCaseHeaders(incoming.headers),
          body: await readRequestBody(incoming),
        },
        handlerOptions,
      );
      writeHttpResponse(outgoing, response);
    } catch {
      writeHttpResponse(outgoing, jsonResponse(500, { error: "internal_error" }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address();
  return {
    host,
    port: typeof address === "object" && address ? address.port : port,
    endpointPath,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAuditFlowMcpHttpServer().then((server) => {
    process.stderr.write(
      `AuditFlow MCP HTTP server listening on http://${server.host}:${server.port}${server.endpointPath}\n`,
    );
  }).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "AuditFlow MCP HTTP server failed."}\n`,
    );
    process.exitCode = 1;
  });
}
