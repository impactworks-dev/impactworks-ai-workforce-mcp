import type {
  AuditFlowServiceDependencies,
} from "../../auditflow-contracts/src/index.ts";
import {
  buildProtectedResourceMetadata,
} from "./oauth.ts";
import {
  createEnvOAuthScopeResolver,
  handleAuditFlowMcpHttpRequest,
  type AuditFlowBearerTokenResolver,
  type AuditFlowHttpEnvironment,
  type AuditFlowHttpRequest,
  type AuditFlowHttpServerOptions,
} from "./http.ts";
import {
  type AuditFlowMcpServerInfo,
} from "./mcp.ts";
import {
  createInMemoryAuditFlowRuntime,
} from "./runtime.ts";

export interface AuditFlowCloudflareEnvironment extends AuditFlowHttpEnvironment {
  IMPACTWORKS_MCP_ENDPOINT_PATH?: string;
}

export interface AuditFlowCloudflareMcpWorkerOptions {
  deps?: AuditFlowServiceDependencies;
  endpointPath?: string;
  resolveBearerToken?: AuditFlowBearerTokenResolver;
  serverInfo?: Partial<AuditFlowMcpServerInfo>;
}

export interface AuditFlowCloudflareMcpWorker {
  fetch(request: Request, env?: AuditFlowCloudflareEnvironment): Promise<Response>;
}

function lowerCaseHeaders(headers: Headers): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
}

function commaSeparated(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requestBodyAllowed(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function toAuditFlowHttpRequest(request: Request): Promise<AuditFlowHttpRequest> {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname,
    headers: lowerCaseHeaders(request.headers),
    body: requestBodyAllowed(request.method) ? await request.text() : undefined,
  };
}

function toWorkerResponse(response: Awaited<ReturnType<typeof handleAuditFlowMcpHttpRequest>>): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

function buildHandlerOptions(
  env: AuditFlowCloudflareEnvironment,
  options: AuditFlowCloudflareMcpWorkerOptions,
  deps: AuditFlowServiceDependencies,
): AuditFlowHttpServerOptions {
  const requiredScopes = commaSeparated(env.IMPACTWORKS_OAUTH_REQUIRED_SCOPES);

  return {
    deps,
    endpointPath: options.endpointPath ?? env.IMPACTWORKS_MCP_ENDPOINT_PATH ?? "/mcp",
    allowedOrigins: commaSeparated(env.IMPACTWORKS_MCP_ALLOWED_ORIGINS),
    resolveBearerToken: options.resolveBearerToken ?? createEnvOAuthScopeResolver(env),
    serverInfo: options.serverInfo,
    protectedResourceMetadata: env.IMPACTWORKS_MCP_RESOURCE
      ? buildProtectedResourceMetadata({
        resource: env.IMPACTWORKS_MCP_RESOURCE,
        authorization_servers: commaSeparated(env.IMPACTWORKS_AUTHORIZATION_SERVERS),
        scopes_supported: requiredScopes.length > 0 ? requiredScopes : ["auditflow:read", "auditflow:write"],
      })
      : undefined,
  };
}

export function createAuditFlowCloudflareMcpWorker(
  options: AuditFlowCloudflareMcpWorkerOptions = {},
): AuditFlowCloudflareMcpWorker {
  const runtime = options.deps ? null : createInMemoryAuditFlowRuntime();
  const deps = options.deps ?? runtime!.deps;

  return {
    async fetch(request, env = {}) {
      const response = await handleAuditFlowMcpHttpRequest(
        await toAuditFlowHttpRequest(request),
        buildHandlerOptions(env, options, deps),
      );
      return toWorkerResponse(response);
    },
  };
}
