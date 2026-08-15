import {
  AUDITFLOW_TOOL_NAMES,
  assertTenantScope,
  type AuditFlowServiceDependencies,
  type AuditFlowToolName,
  type TenantScope,
} from "../../auditflow-contracts/src/index.ts";
import {
  invokeAuditFlowTool,
  isAuditFlowToolName,
  type AuditFlowToolResult,
} from "./handlers.ts";

export const AUDITFLOW_MCP_PROTOCOL_VERSION = "2025-06-18";

export interface AuditFlowMcpServerInfo {
  name: string;
  version: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export interface McpTextContentBlock {
  type: "text";
  text: string;
}

export interface McpCallToolResult {
  content: McpTextContentBlock[];
  structuredContent: AuditFlowToolResult;
  isError: boolean;
}

export interface McpToolDefinition {
  name: AuditFlowToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: boolean;
  };
}

export interface AuditFlowMcpRequestContext {
  request: JsonRpcRequest;
  toolName?: string;
}

export type AuditFlowScopeResolver = (
  context: AuditFlowMcpRequestContext,
) => TenantScope | Promise<TenantScope>;

export interface AuditFlowMcpProtocolServerOptions {
  deps: AuditFlowServiceDependencies;
  resolveScope: AuditFlowScopeResolver;
  serverInfo?: Partial<AuditFlowMcpServerInfo>;
}

export interface AuditFlowMcpProtocolServer {
  readonly serverInfo: AuditFlowMcpServerInfo;
  listTools(): McpToolDefinition[];
  handleMessage(message: unknown): Promise<JsonRpcResponse | null>;
  handleJsonLine(line: string): Promise<string | null>;
}

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;

const mutatingTools = new Set<AuditFlowToolName>([
  "create_audit",
  "upsert_workflow",
  "generate_roadmap",
]);

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function successResponse(id: string | number | null, result: unknown): JsonRpcSuccess {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(value: unknown): string | number | null {
  if (isObject(value) && ("id" in value)) {
    const id = value.id;
    if (typeof id === "string" || typeof id === "number" || id === null) return id;
  }
  return null;
}

function assertJsonRpcRequest(message: unknown): JsonRpcRequest {
  if (!isObject(message)) {
    throw new Error("JSON-RPC message must be an object.");
  }
  if (message.jsonrpc !== "2.0") {
    throw new Error("JSON-RPC version must be 2.0.");
  }
  if (typeof message.method !== "string") {
    throw new Error("JSON-RPC method must be a string.");
  }
  if (
    "id" in message &&
    typeof message.id !== "string" &&
    typeof message.id !== "number" &&
    message.id !== null
  ) {
    throw new Error("JSON-RPC id must be a string, number, or null.");
  }
  return message as unknown as JsonRpcRequest;
}

function optionalStringProperty(description: string, maxLength = 500): Record<string, unknown> {
  return {
    type: "string",
    maxLength,
    description,
  };
}

function numberProperty(description: string, minimum = 0): Record<string, unknown> {
  return {
    type: "number",
    minimum,
    description,
  };
}

function workflowIdsSchema(required: boolean): Record<string, unknown> {
  return {
    type: "array",
    minItems: required ? 1 : undefined,
    maxItems: 20,
    uniqueItems: true,
    items: {
      type: "string",
      pattern: "^wf_[A-Za-z0-9]+$",
    },
    description: "Workflow IDs selected from workflows already captured in this audit.",
  };
}

function auditIdSchema(): Record<string, unknown> {
  return {
    type: "string",
    pattern: "^aud_[A-Za-z0-9]+$",
    description: "Audit ID returned by create_audit.",
  };
}

function createAuditInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["business"],
    properties: {
      business: {
        type: "object",
        additionalProperties: false,
        required: ["name", "industry", "employee_count", "primary_goal"],
        properties: {
          name: optionalStringProperty("Business or organization name.", 120),
          industry: optionalStringProperty("Primary industry or category.", 120),
          employee_count: {
            type: "integer",
            minimum: 1,
            maximum: 100000,
            description: "Approximate employee count.",
          },
          annual_revenue_usd: numberProperty("Optional annual revenue baseline in USD."),
          locations: {
            type: "integer",
            minimum: 1,
            description: "Optional number of operating locations.",
          },
          country: optionalStringProperty("Optional primary operating country.", 80),
          primary_goal: {
            type: "string",
            enum: [
              "reduce_cost",
              "increase_capacity",
              "improve_customer_experience",
              "grow_revenue",
              "reduce_risk",
              "other",
            ],
          },
        },
      },
      constraints: {
        type: "object",
        additionalProperties: false,
        properties: {
          budget_range_usd: {
            type: "object",
            additionalProperties: false,
            required: ["min", "max"],
            properties: {
              min: numberProperty("Minimum implementation budget in USD."),
              max: numberProperty("Maximum implementation budget in USD."),
            },
          },
          target_timeline_days: {
            type: "integer",
            minimum: 1,
            maximum: 730,
          },
          regulated_data: { type: "boolean" },
          data_residency_notes: optionalStringProperty("Optional data residency notes."),
          must_keep_systems: {
            type: "array",
            maxItems: 30,
            items: optionalStringProperty("System name.", 100),
          },
        },
      },
      default_loaded_hourly_rate_usd: numberProperty("Default loaded hourly labor rate in USD.", 10),
      source: {
        type: "string",
        enum: ["self_serve", "consultant_led", "partner_led"],
      },
    },
  };
}

function workflowSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "name",
      "department",
      "trigger",
      "desired_outcome",
      "steps",
      "monthly_volume",
      "minutes_per_run",
      "data_sensitivity",
      "evidence_quality",
    ],
    properties: {
      name: optionalStringProperty("Workflow name.", 140),
      department: optionalStringProperty("Department or team responsible for this workflow.", 100),
      trigger: optionalStringProperty("Event that starts the workflow."),
      desired_outcome: optionalStringProperty("Business result this workflow should produce."),
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sequence", "action", "owner_role", "manual"],
          properties: {
            sequence: { type: "integer", minimum: 1 },
            action: optionalStringProperty("Step action.", 500),
            owner_role: optionalStringProperty("Role that owns this step.", 100),
            system: optionalStringProperty("System used for this step.", 100),
            minutes: numberProperty("Approximate minutes spent on this step."),
            manual: { type: "boolean" },
          },
        },
      },
      monthly_volume: numberProperty("Monthly workflow run volume."),
      minutes_per_run: numberProperty("Average minutes per workflow run."),
      loaded_hourly_rate_usd: numberProperty("Optional loaded hourly labor rate.", 10),
      error_rate_percent: {
        type: "number",
        minimum: 0,
        maximum: 100,
      },
      cost_per_error_usd: numberProperty("Optional cost per error in USD."),
      annual_revenue_at_risk_usd: numberProperty("Optional annual revenue at risk in USD."),
      systems: {
        type: "array",
        maxItems: 30,
        items: optionalStringProperty("System name.", 100),
      },
      pain_points: {
        type: "array",
        maxItems: 20,
        items: optionalStringProperty("Workflow pain point.", 300),
      },
      exception_rate_percent: {
        type: "number",
        minimum: 0,
        maximum: 100,
      },
      data_sensitivity: {
        type: "string",
        enum: ["public", "internal", "confidential", "regulated"],
      },
      evidence_quality: {
        type: "string",
        enum: ["measured", "owner_estimate", "team_estimate", "unknown"],
      },
      notes: optionalStringProperty("Optional workflow notes.", 2000),
    },
  };
}

function upsertWorkflowInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id", "workflow"],
    properties: {
      audit_id: auditIdSchema(),
      workflow_id: {
        type: "string",
        pattern: "^wf_[A-Za-z0-9]+$",
        description: "Optional stable workflow ID. If omitted, the server generates one.",
      },
      workflow: workflowSchema(),
    },
  };
}

function scoreOpportunitiesInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id"],
    properties: {
      audit_id: auditIdSchema(),
      workflow_ids: workflowIdsSchema(false),
      force_recalculate: { type: "boolean" },
    },
  };
}

function estimateRoiInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id", "workflow_ids"],
    properties: {
      audit_id: auditIdSchema(),
      workflow_ids: workflowIdsSchema(true),
      implementation_cost_usd: numberProperty("Optional one-time implementation cost in USD."),
      annual_software_cost_usd: numberProperty("Optional annual software cost in USD."),
      automation_coverage_percent: {
        type: "number",
        minimum: 0,
        maximum: 100,
      },
      adoption_rate_percent: {
        type: "number",
        minimum: 0,
        maximum: 100,
      },
      include_revenue_uplift: { type: "boolean" },
    },
  };
}

function recommendSolutionStackInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id", "workflow_ids"],
    properties: {
      audit_id: auditIdSchema(),
      workflow_ids: workflowIdsSchema(true),
      preference: {
        type: "string",
        enum: ["lowest_cost", "fastest_launch", "most_scalable", "least_change", "balanced"],
      },
      allow_named_products: { type: "boolean" },
    },
  };
}

function generateRoadmapInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id", "workflow_ids"],
    properties: {
      audit_id: auditIdSchema(),
      workflow_ids: workflowIdsSchema(true),
      start_date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      },
      delivery_capacity: {
        type: "string",
        enum: ["owner_only", "small_internal_team", "implementation_partner", "mixed_team"],
      },
      max_parallel_initiatives: {
        type: "integer",
        minimum: 1,
        maximum: 10,
      },
    },
  };
}

function getAuditReportInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["audit_id"],
    properties: {
      audit_id: auditIdSchema(),
      audience: {
        type: "string",
        enum: ["owner", "executive_team", "operations_team", "implementation_partner"],
      },
      detail_level: {
        type: "string",
        enum: ["executive", "standard", "implementation"],
      },
      include_sprint_fit: { type: "boolean" },
    },
  };
}

function inputSchemaForTool(toolName: AuditFlowToolName): Record<string, unknown> {
  switch (toolName) {
    case "create_audit":
      return createAuditInputSchema();
    case "upsert_workflow":
      return upsertWorkflowInputSchema();
    case "score_opportunities":
      return scoreOpportunitiesInputSchema();
    case "estimate_roi":
      return estimateRoiInputSchema();
    case "recommend_solution_stack":
      return recommendSolutionStackInputSchema();
    case "generate_roadmap":
      return generateRoadmapInputSchema();
    case "get_audit_report":
      return getAuditReportInputSchema();
  }
}

function titleForTool(toolName: AuditFlowToolName): string {
  return toolName
    .split("_")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function descriptionForTool(toolName: AuditFlowToolName): string {
  switch (toolName) {
    case "create_audit":
      return "Create a tenant-scoped AuditFlow audit and capture the business baseline.";
    case "upsert_workflow":
      return "Create or update one workflow in an audit and evaluate evidence completeness.";
    case "score_opportunities":
      return "Score captured workflows for impact, feasibility, risk, confidence, and priority.";
    case "estimate_roi":
      return "Estimate low, expected, and high ROI scenarios for selected workflows.";
    case "recommend_solution_stack":
      return "Recommend vendor-neutral capability patterns, controls, and implementation complexity.";
    case "generate_roadmap":
      return "Persist a 30/60/90 implementation roadmap for selected workflows.";
    case "get_audit_report":
      return "Assemble a decision-ready AuditFlow report from captured audit evidence.";
  }
}

export function listAuditFlowMcpTools(): McpToolDefinition[] {
  return AUDITFLOW_TOOL_NAMES.map((toolName) => {
    const isMutating = mutatingTools.has(toolName);
    return {
      name: toolName,
      title: titleForTool(toolName),
      description: descriptionForTool(toolName),
      inputSchema: inputSchemaForTool(toolName),
      annotations: {
        readOnlyHint: !isMutating,
        destructiveHint: false,
        idempotentHint: !isMutating,
      },
    };
  });
}

function toolResultToMcpResult(result: AuditFlowToolResult): McpCallToolResult {
  if (result.ok) {
    return {
      content: [
        {
          type: "text",
          text: `AuditFlow ${result.tool_name} completed successfully.`,
        },
      ],
      structuredContent: result,
      isError: false,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `AuditFlow ${result.tool_name} failed: ${result.error.message}`,
      },
    ],
    structuredContent: result,
    isError: true,
  };
}

function callToolParams(params: unknown): { name: string; arguments: unknown } {
  if (!isObject(params)) {
    throw new Error("tools/call params must be an object.");
  }
  if (typeof params.name !== "string") {
    throw new Error("tools/call params.name must be a string.");
  }
  return {
    name: params.name,
    arguments: params.arguments ?? {},
  };
}

export function createAuditFlowMcpProtocolServer(
  options: AuditFlowMcpProtocolServerOptions,
): AuditFlowMcpProtocolServer {
  const serverInfo: AuditFlowMcpServerInfo = {
    name: options.serverInfo?.name ?? "impactworks-auditflow",
    version: options.serverInfo?.version ?? "0.1.0",
  };

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    if (request.id === undefined && request.method.startsWith("notifications/")) {
      return null;
    }

    switch (request.method) {
      case "initialize":
        return successResponse(id, {
          protocolVersion: AUDITFLOW_MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo,
        });
      case "tools/list":
        return successResponse(id, {
          tools: listAuditFlowMcpTools(),
        });
      case "tools/call": {
        const params = callToolParams(request.params);
        if (!isAuditFlowToolName(params.name)) {
          return errorResponse(id, JSONRPC_INVALID_PARAMS, `Unknown AuditFlow tool: ${params.name}`, {
            tool_name: params.name,
          });
        }
        const scope = await options.resolveScope({ request, toolName: params.name });
        assertTenantScope(scope);
        const result = await invokeAuditFlowTool(
          options.deps,
          scope,
          params.name,
          params.arguments,
        );
        return successResponse(id, toolResultToMcpResult(result));
      }
      default:
        return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Unsupported MCP method: ${request.method}`);
    }
  }

  return {
    serverInfo,
    listTools: listAuditFlowMcpTools,
    async handleMessage(message: unknown) {
      try {
        const request = assertJsonRpcRequest(message);
        return await handleRequest(request);
      } catch (error) {
        return errorResponse(
          requestId(message),
          JSONRPC_INVALID_REQUEST,
          error instanceof Error ? error.message : "Invalid JSON-RPC request.",
        );
      }
    },
    async handleJsonLine(line: string) {
      try {
        const response = await this.handleMessage(JSON.parse(line));
        return response ? JSON.stringify(response) : null;
      } catch (error) {
        const response = errorResponse(
          null,
          JSONRPC_PARSE_ERROR,
          error instanceof Error ? error.message : "Invalid JSON.",
        );
        return JSON.stringify(response);
      }
    },
  };
}

