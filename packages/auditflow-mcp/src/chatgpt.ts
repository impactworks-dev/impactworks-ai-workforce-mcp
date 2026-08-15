import {
  AUDITFLOW_TOOL_NAMES,
  READ_ONLY_AUDITFLOW_TOOLS,
  type AuditFlowToolName,
} from "../../auditflow-contracts/src/index.ts";

export const CHATGPT_AUDITFLOW_SERVER_LABEL = "impactworks_auditflow";
export const CHATGPT_AUDITFLOW_READ_SCOPE = "auditflow:read";
export const CHATGPT_AUDITFLOW_WRITE_SCOPE = "auditflow:write";

export type ChatGptMcpAllowedTools =
  | AuditFlowToolName[]
  | {
      read_only?: boolean;
      tool_names?: AuditFlowToolName[];
    };

export type ChatGptMcpApprovalPolicy =
  | "always"
  | "never"
  | {
      always?: {
        read_only?: boolean;
        tool_names?: AuditFlowToolName[];
      };
      never?: {
        read_only?: boolean;
        tool_names?: AuditFlowToolName[];
      };
    };

export interface ChatGptRemoteMcpToolConfig {
  type: "mcp";
  server_label: string;
  server_url: string;
  server_description: string;
  allowed_tools: ChatGptMcpAllowedTools;
  require_approval: ChatGptMcpApprovalPolicy;
  authorization?: string;
  headers?: Record<string, string>;
}

export interface ChatGptAuditFlowIntegrationOptions {
  serverUrl: string;
  authorization?: string;
  serverLabel?: string;
  serverDescription?: string;
  allowedTools?: ChatGptMcpAllowedTools;
  requireApproval?: ChatGptMcpApprovalPolicy;
  headers?: Record<string, string>;
  allowHttpLocalhost?: boolean;
}

export interface ChatGptToolSecurityScheme {
  type: "oauth2";
  scopes: string[];
}

const readOnlyTools = new Set<AuditFlowToolName>(READ_ONLY_AUDITFLOW_TOOLS);

export function auditFlowToolScopes(toolName: AuditFlowToolName): string[] {
  return readOnlyTools.has(toolName)
    ? [CHATGPT_AUDITFLOW_READ_SCOPE]
    : [CHATGPT_AUDITFLOW_WRITE_SCOPE];
}

export function auditFlowToolSecuritySchemes(
  toolName: AuditFlowToolName,
): ChatGptToolSecurityScheme[] {
  return [
    {
      type: "oauth2",
      scopes: auditFlowToolScopes(toolName),
    },
  ];
}

function assertAuditFlowToolNames(toolNames: AuditFlowToolName[]): void {
  const supported = new Set<AuditFlowToolName>(AUDITFLOW_TOOL_NAMES);
  const unsupported = toolNames.filter((toolName) => !supported.has(toolName));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported AuditFlow tool(s): ${unsupported.join(", ")}`);
  }
}

function validateAllowedTools(allowedTools: ChatGptMcpAllowedTools): ChatGptMcpAllowedTools {
  if (Array.isArray(allowedTools)) {
    assertAuditFlowToolNames(allowedTools);
    return allowedTools;
  }
  if (allowedTools.tool_names) {
    assertAuditFlowToolNames(allowedTools.tool_names);
  }
  return allowedTools;
}

function validateApprovalPolicy(policy: ChatGptMcpApprovalPolicy): ChatGptMcpApprovalPolicy {
  if (typeof policy === "string") return policy;
  if (policy.always?.tool_names) assertAuditFlowToolNames(policy.always.tool_names);
  if (policy.never?.tool_names) assertAuditFlowToolNames(policy.never.tool_names);
  return policy;
}

function validateServerUrl(serverUrl: string, allowHttpLocalhost: boolean): string {
  const url = new URL(serverUrl);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.protocol !== "https:" &&
    !(allowHttpLocalhost && url.protocol === "http:" && isLocalhost)
  ) {
    throw new Error("ChatGPT MCP server URL must be HTTPS, except localhost during local development.");
  }
  if (!url.pathname.endsWith("/mcp")) {
    throw new Error("ChatGPT MCP server URL must include the /mcp endpoint path.");
  }
  url.hash = "";
  return url.toString();
}

export function defaultChatGptApprovalPolicy(): ChatGptMcpApprovalPolicy {
  return {
    always: {
      read_only: false,
      tool_names: ["create_audit", "upsert_workflow", "generate_roadmap"],
    },
    never: {
      read_only: true,
      tool_names: [
        "score_opportunities",
        "estimate_roi",
        "recommend_solution_stack",
        "get_audit_report",
      ],
    },
  };
}

export function createChatGptAuditFlowRemoteMcpTool(
  options: ChatGptAuditFlowIntegrationOptions,
): ChatGptRemoteMcpToolConfig {
  const config: ChatGptRemoteMcpToolConfig = {
    type: "mcp",
    server_label: options.serverLabel ?? CHATGPT_AUDITFLOW_SERVER_LABEL,
    server_url: validateServerUrl(options.serverUrl, options.allowHttpLocalhost ?? false),
    server_description:
      options.serverDescription ??
      "ImpactWorks AuditFlow maps workflows, scores opportunities, estimates ROI, recommends a solution stack, and prepares a governed AI workforce roadmap.",
    allowed_tools: validateAllowedTools(options.allowedTools ?? [...AUDITFLOW_TOOL_NAMES]),
    require_approval: validateApprovalPolicy(
      options.requireApproval ?? defaultChatGptApprovalPolicy(),
    ),
  };

  if (options.authorization) {
    config.authorization = options.authorization;
  }
  if (options.headers) {
    config.headers = options.headers;
  }

  return config;
}

export function createChatGptResponsesApiExample(
  options: ChatGptAuditFlowIntegrationOptions,
): Record<string, unknown> {
  return {
    model: "gpt-5",
    input: "Run an AuditFlow intake for ImpactWorks and stop before any external action.",
    tools: [createChatGptAuditFlowRemoteMcpTool(options)],
  };
}
