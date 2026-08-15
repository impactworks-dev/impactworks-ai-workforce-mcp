import {
  AUDITFLOW_TOOL_NAMES,
  AuditFlowServiceError,
  AuditFlowValidationError,
  createAuditService,
  estimateRoiService,
  generateRoadmapService,
  getAuditReportService,
  recommendSolutionStackService,
  scoreOpportunitiesService,
  upsertWorkflowService,
  validateToolInput,
  type AuditFlowErrorCode,
  type AuditFlowToolName,
  type AuditFlowServiceDependencies,
  type CreateAuditInput,
  type EstimateRoiInput,
  type GenerateRoadmapInput,
  type GetAuditReportInput,
  type RecommendSolutionStackInput,
  type ScoreOpportunitiesInput,
  type TenantScope,
  type UpsertWorkflowInput,
} from "../../auditflow-contracts/src/index.ts";

export type AuditFlowToolOutput =
  | Awaited<ReturnType<typeof createAuditService>>
  | Awaited<ReturnType<typeof upsertWorkflowService>>
  | Awaited<ReturnType<typeof scoreOpportunitiesService>>
  | Awaited<ReturnType<typeof estimateRoiService>>
  | Awaited<ReturnType<typeof recommendSolutionStackService>>
  | Awaited<ReturnType<typeof generateRoadmapService>>
  | Awaited<ReturnType<typeof getAuditReportService>>;

export interface AuditFlowToolSuccess {
  ok: true;
  tool_name: AuditFlowToolName;
  output: AuditFlowToolOutput;
}

export interface AuditFlowToolFailure {
  ok: false;
  tool_name: AuditFlowToolName | string;
  error: {
    code: AuditFlowErrorCode;
    message: string;
    retryable: boolean;
    missing: string[];
  };
}

export type AuditFlowToolResult = AuditFlowToolSuccess | AuditFlowToolFailure;

export function isAuditFlowToolName(value: string): value is AuditFlowToolName {
  return (AUDITFLOW_TOOL_NAMES as readonly string[]).includes(value);
}

function failure(
  toolName: AuditFlowToolName | string,
  code: AuditFlowErrorCode,
  message: string,
  retryable: boolean,
  missing: string[] = [],
): AuditFlowToolFailure {
  return {
    ok: false,
    tool_name: toolName,
    error: {
      code,
      message,
      retryable,
      missing,
    },
  };
}

async function dispatchValidatedTool(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  toolName: AuditFlowToolName,
  input: ReturnType<typeof validateToolInput>,
): Promise<AuditFlowToolOutput> {
  switch (toolName) {
    case "create_audit":
      return createAuditService(deps, scope, input as CreateAuditInput);
    case "upsert_workflow":
      return upsertWorkflowService(deps, scope, input as UpsertWorkflowInput);
    case "score_opportunities":
      return scoreOpportunitiesService(deps, scope, input as ScoreOpportunitiesInput);
    case "estimate_roi":
      return estimateRoiService(deps, scope, input as EstimateRoiInput);
    case "recommend_solution_stack":
      return recommendSolutionStackService(deps, scope, input as RecommendSolutionStackInput);
    case "generate_roadmap":
      return generateRoadmapService(deps, scope, input as GenerateRoadmapInput);
    case "get_audit_report":
      return getAuditReportService(deps, scope, input as GetAuditReportInput);
  }
}

export async function invokeAuditFlowTool(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  toolName: string,
  rawInput: unknown,
): Promise<AuditFlowToolResult> {
  if (!isAuditFlowToolName(toolName)) {
    return failure(
      toolName,
      "VALIDATION_FAILED",
      `Unknown AuditFlow tool: ${toolName}`,
      false,
      ["tool_name"],
    );
  }

  try {
    const input = validateToolInput(toolName, rawInput);
    const output = await dispatchValidatedTool(deps, scope, toolName, input);
    return {
      ok: true,
      tool_name: toolName,
      output,
    };
  } catch (error) {
    if (error instanceof AuditFlowValidationError) {
      return failure(toolName, error.code, error.message, error.retryable, error.issues);
    }
    if (error instanceof AuditFlowServiceError) {
      return failure(toolName, error.code, error.message, error.retryable, error.missing);
    }
    return failure(
      toolName,
      "INTERNAL_ERROR",
      "AuditFlow tool invocation failed unexpectedly.",
      true,
      [],
    );
  }
}
