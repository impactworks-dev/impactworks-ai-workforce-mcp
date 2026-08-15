import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  assertTenantScope,
  type TenantScope,
} from "../../auditflow-contracts/src/index.ts";
import { createAuditFlowMcpProtocolServer } from "./mcp.ts";
import { createInMemoryAuditFlowRuntime } from "./runtime.ts";

export interface AuditFlowMcpEnvironment {
  IMPACTWORKS_TENANT_ID?: string;
  IMPACTWORKS_ACTOR_USER_ID?: string;
}

export function createEnvTenantScopeResolver(
  env: AuditFlowMcpEnvironment = process.env,
): () => TenantScope {
  return () => {
    const scope = {
      tenantId: env.IMPACTWORKS_TENANT_ID,
      actorUserId: env.IMPACTWORKS_ACTOR_USER_ID,
    };
    assertTenantScope(scope);
    return scope;
  };
}

export async function runAuditFlowMcpStdioServer(
  env: AuditFlowMcpEnvironment = process.env,
): Promise<void> {
  const runtime = createInMemoryAuditFlowRuntime();
  const server = createAuditFlowMcpProtocolServer({
    deps: runtime.deps,
    resolveScope: createEnvTenantScopeResolver(env),
  });
  const lines = createInterface({ input });

  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const response = await server.handleJsonLine(line);
    if (response) {
      output.write(`${response}\n`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAuditFlowMcpStdioServer().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "AuditFlow MCP stdio server failed."}\n`,
    );
    process.exitCode = 1;
  });
}

