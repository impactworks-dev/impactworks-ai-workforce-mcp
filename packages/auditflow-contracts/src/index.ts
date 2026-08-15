export const AUDITFLOW_CONTRACT_VERSION = "auditflow-contracts-1.0.0";

export {
  evaluateWorkflowCompleteness,
  WORKFLOW_COMPLETENESS_VERSION,
} from "./completeness.ts";
export {
  assertAuditEvent,
  assertTenantScope,
  createAuditEvent,
  createAuditRecord,
  createWorkflowRecord,
} from "./domain.ts";
export {
  AuditFlowServiceError,
  createAuditService,
  estimateRoiService,
  generateRoadmapService,
  mapWorkflowToOpportunityScoreInput,
  scoreOpportunitiesService,
  upsertWorkflowService,
} from "./services.ts";
export type {
  EvidenceConfidence,
  WorkflowCompletenessResult,
} from "./completeness.ts";
export type {
  AppendAuditEventInput,
  AuditEventRepository,
  AuditFlowEvent,
  AuditFlowEventType,
  AuditFlowRepositories,
  AuditRecord,
  AuditRepository,
  AuditStatus,
  CreateAuditRecordInput,
  EventId,
  ListWorkflowsQuery,
  TenantId,
  TenantScope,
  UpsertWorkflowRecordInput,
  UserId,
  WorkflowRecord,
  WorkflowRepository,
} from "./domain.ts";
export type {
  AuditFlowServiceDependencies,
  CreateAuditServiceResult,
  EstimateRoiScenario,
  EstimateRoiServiceResult,
  GenerateRoadmapServiceResult,
  RoadmapInitiative,
  RoadmapPhase,
  ScoredOpportunity,
  ScoreOpportunitiesServiceResult,
  UpsertWorkflowServiceResult,
} from "./services.ts";

export const AUDITFLOW_TOOL_NAMES = [
  "create_audit",
  "upsert_workflow",
  "score_opportunities",
  "estimate_roi",
  "recommend_solution_stack",
  "generate_roadmap",
  "get_audit_report",
] as const;

export type AuditFlowToolName = (typeof AUDITFLOW_TOOL_NAMES)[number];

export const READ_ONLY_AUDITFLOW_TOOLS = [
  "score_opportunities",
  "estimate_roi",
  "recommend_solution_stack",
  "get_audit_report",
] as const satisfies readonly AuditFlowToolName[];

export const MUTATING_AUDITFLOW_TOOLS = [
  "create_audit",
  "upsert_workflow",
  "generate_roadmap",
] as const satisfies readonly AuditFlowToolName[];

export const AUDITFLOW_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "AUDIT_NOT_FOUND",
  "WORKFLOW_NOT_FOUND",
  "VALIDATION_FAILED",
  "INSUFFICIENT_WORKFLOWS",
  "INSUFFICIENT_EVIDENCE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type AuditFlowErrorCode = (typeof AUDITFLOW_ERROR_CODES)[number];

export type AuditId = `aud_${string}`;
export type WorkflowId = `wf_${string}`;
export type RoadmapId = `rm_${string}`;

export type PrimaryGoal =
  | "reduce_cost"
  | "increase_capacity"
  | "improve_customer_experience"
  | "grow_revenue"
  | "reduce_risk"
  | "other";

export type AuditSource = "self_serve" | "consultant_led" | "partner_led";
export type DataSensitivity = "public" | "internal" | "confidential" | "regulated";
export type EvidenceQuality = "measured" | "owner_estimate" | "team_estimate" | "unknown";
export type SolutionPreference =
  | "lowest_cost"
  | "fastest_launch"
  | "most_scalable"
  | "least_change"
  | "balanced";
export type DeliveryCapacity =
  | "owner_only"
  | "small_internal_team"
  | "implementation_partner"
  | "mixed_team";
export type ReportAudience =
  | "owner"
  | "executive_team"
  | "operations_team"
  | "implementation_partner";
export type ReportDetailLevel = "executive" | "standard" | "implementation";

export interface BudgetRangeUsd {
  min: number;
  max: number;
}

export interface AuditBusinessProfile {
  name: string;
  industry: string;
  employee_count: number;
  annual_revenue_usd?: number;
  locations?: number;
  country?: string;
  primary_goal: PrimaryGoal;
}

export interface AuditConstraints {
  budget_range_usd?: BudgetRangeUsd;
  target_timeline_days?: number;
  regulated_data?: boolean;
  data_residency_notes?: string;
  must_keep_systems?: string[];
}

export interface CreateAuditInput {
  business: AuditBusinessProfile;
  constraints?: AuditConstraints;
  default_loaded_hourly_rate_usd?: number;
  source?: AuditSource;
}

export interface WorkflowStep {
  sequence: number;
  action: string;
  owner_role: string;
  system?: string;
  minutes?: number;
  manual: boolean;
}

export interface WorkflowProfile {
  name: string;
  department: string;
  trigger: string;
  desired_outcome: string;
  steps: WorkflowStep[];
  monthly_volume: number;
  minutes_per_run: number;
  loaded_hourly_rate_usd?: number;
  error_rate_percent?: number;
  cost_per_error_usd?: number;
  annual_revenue_at_risk_usd?: number;
  systems?: string[];
  pain_points?: string[];
  exception_rate_percent?: number;
  data_sensitivity: DataSensitivity;
  evidence_quality: EvidenceQuality;
  notes?: string;
}

export interface UpsertWorkflowInput {
  audit_id: AuditId;
  workflow_id?: WorkflowId;
  workflow: WorkflowProfile;
}

export interface ScoreOpportunitiesInput {
  audit_id: AuditId;
  workflow_ids?: WorkflowId[];
  force_recalculate?: boolean;
}

export interface EstimateRoiInput {
  audit_id: AuditId;
  workflow_ids: WorkflowId[];
  implementation_cost_usd?: number;
  annual_software_cost_usd?: number;
  automation_coverage_percent?: number;
  adoption_rate_percent?: number;
  include_revenue_uplift?: boolean;
}

export interface RecommendSolutionStackInput {
  audit_id: AuditId;
  workflow_ids: WorkflowId[];
  preference?: SolutionPreference;
  allow_named_products?: boolean;
}

export interface GenerateRoadmapInput {
  audit_id: AuditId;
  workflow_ids: WorkflowId[];
  start_date?: string;
  delivery_capacity?: DeliveryCapacity;
  max_parallel_initiatives?: number;
}

export interface GetAuditReportInput {
  audit_id: AuditId;
  audience?: ReportAudience;
  detail_level?: ReportDetailLevel;
  include_sprint_fit?: boolean;
}

export type AuditFlowToolInput =
  | CreateAuditInput
  | UpsertWorkflowInput
  | ScoreOpportunitiesInput
  | EstimateRoiInput
  | RecommendSolutionStackInput
  | GenerateRoadmapInput
  | GetAuditReportInput;

export interface AuditFlowErrorPayload {
  error: {
    code: AuditFlowErrorCode;
    message: string;
    retryable: boolean;
    missing?: string[];
  };
}

export class AuditFlowValidationError extends Error {
  readonly code = "VALIDATION_FAILED" as const;
  readonly retryable = true;
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`AuditFlow validation failed: ${issues.join("; ")}`);
    this.name = "AuditFlowValidationError";
    this.issues = issues;
  }

  toPayload(): AuditFlowErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        missing: this.issues,
      },
    };
  }
}

const auditIdPattern = /^aud_[a-zA-Z0-9]+$/;
const workflowIdPattern = /^wf_[a-zA-Z0-9]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key} is not allowed`);
  }
}

function fail(issue: string): never {
  throw new AuditFlowValidationError([issue]);
}

function assertRecord(path: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function optionalString(path: string, value: unknown, min = 0, max = Infinity): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${path} must be a string`);
  if (value.length < min || value.length > max) {
    fail(`${path} must be between ${min} and ${max} characters`);
  }
  return value;
}

function requiredString(path: string, value: unknown, min = 1, max = Infinity): string {
  const result = optionalString(path, value, min, max);
  if (result === undefined) fail(`${path} is required`);
  return result;
}

function optionalNumber(path: string, value: unknown, min = -Infinity, max = Infinity): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${path} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function requiredNumber(path: string, value: unknown, min = -Infinity, max = Infinity): number {
  const result = optionalNumber(path, value, min, max);
  if (result === undefined) fail(`${path} is required`);
  return result;
}

function optionalInteger(path: string, value: unknown, min = -Infinity, max = Infinity): number | undefined {
  const result = optionalNumber(path, value, min, max);
  if (result === undefined) return undefined;
  if (!Number.isInteger(result)) fail(`${path} must be an integer`);
  return result;
}

function requiredInteger(path: string, value: unknown, min = -Infinity, max = Infinity): number {
  const result = optionalInteger(path, value, min, max);
  if (result === undefined) fail(`${path} is required`);
  return result;
}

function optionalBoolean(path: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
  return value;
}

function requiredBoolean(path: string, value: unknown): boolean {
  const result = optionalBoolean(path, value);
  if (result === undefined) fail(`${path} is required`);
  return result;
}

function optionalEnum<T extends string>(
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function requiredEnum<T extends string>(path: string, value: unknown, allowed: readonly T[]): T {
  const result = optionalEnum(path, value, allowed);
  if (result === undefined) fail(`${path} is required`);
  return result;
}

function optionalStringArray(
  path: string,
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(`${path} must be an array with at most ${maxItems} items`);
  }
  return value.map((item, index) => requiredString(`${path}[${index}]`, item, 0, maxLength));
}

function requiredWorkflowIds(path: string, value: unknown, maxItems: number): WorkflowId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    fail(`${path} must include between 1 and ${maxItems} workflow IDs`);
  }
  const ids = value.map((item, index) => requiredWorkflowId(`${path}[${index}]`, item));
  if (new Set(ids).size !== ids.length) fail(`${path} must contain unique workflow IDs`);
  return ids;
}

function optionalWorkflowIds(path: string, value: unknown, maxItems: number): WorkflowId[] | undefined {
  if (value === undefined) return undefined;
  return requiredWorkflowIds(path, value, maxItems);
}

function requiredAuditId(path: string, value: unknown): AuditId {
  const id = requiredString(path, value);
  if (!auditIdPattern.test(id)) fail(`${path} must match aud_[A-Za-z0-9]+`);
  return id as AuditId;
}

function requiredWorkflowId(path: string, value: unknown): WorkflowId {
  const id = requiredString(path, value);
  if (!workflowIdPattern.test(id)) fail(`${path} must match wf_[A-Za-z0-9]+`);
  return id as WorkflowId;
}

function optionalWorkflowId(path: string, value: unknown): WorkflowId | undefined {
  if (value === undefined) return undefined;
  return requiredWorkflowId(path, value);
}

function optionalDate(path: string, value: unknown): string | undefined {
  const date = optionalString(path, value);
  if (date !== undefined && !datePattern.test(date)) fail(`${path} must use YYYY-MM-DD format`);
  return date;
}

function validateBusiness(value: unknown): AuditBusinessProfile {
  const business = assertRecord("business", value);
  rejectUnknownKeys("business", business, [
    "name",
    "industry",
    "employee_count",
    "annual_revenue_usd",
    "locations",
    "country",
    "primary_goal",
  ]);

  return {
    name: requiredString("business.name", business.name, 1, 120),
    industry: requiredString("business.industry", business.industry, 1, 120),
    employee_count: requiredInteger("business.employee_count", business.employee_count, 1, 100000),
    annual_revenue_usd: optionalNumber("business.annual_revenue_usd", business.annual_revenue_usd, 0),
    locations: optionalInteger("business.locations", business.locations, 1),
    country: optionalString("business.country", business.country, 2, 80),
    primary_goal: requiredEnum("business.primary_goal", business.primary_goal, [
      "reduce_cost",
      "increase_capacity",
      "improve_customer_experience",
      "grow_revenue",
      "reduce_risk",
      "other",
    ]),
  };
}

function validateConstraints(value: unknown): AuditConstraints | undefined {
  if (value === undefined) return undefined;
  const constraints = assertRecord("constraints", value);
  rejectUnknownKeys("constraints", constraints, [
    "budget_range_usd",
    "target_timeline_days",
    "regulated_data",
    "data_residency_notes",
    "must_keep_systems",
  ]);

  let budgetRange: BudgetRangeUsd | undefined;
  if (constraints.budget_range_usd !== undefined) {
    const range = assertRecord("constraints.budget_range_usd", constraints.budget_range_usd);
    rejectUnknownKeys("constraints.budget_range_usd", range, ["min", "max"]);
    budgetRange = {
      min: requiredNumber("constraints.budget_range_usd.min", range.min, 0),
      max: requiredNumber("constraints.budget_range_usd.max", range.max, 0),
    };
    if (budgetRange.max < budgetRange.min) {
      fail("constraints.budget_range_usd.max must be greater than or equal to min");
    }
  }

  return {
    budget_range_usd: budgetRange,
    target_timeline_days: optionalInteger("constraints.target_timeline_days", constraints.target_timeline_days, 1, 730),
    regulated_data: optionalBoolean("constraints.regulated_data", constraints.regulated_data),
    data_residency_notes: optionalString("constraints.data_residency_notes", constraints.data_residency_notes, 0, 500),
    must_keep_systems: optionalStringArray("constraints.must_keep_systems", constraints.must_keep_systems, 30, 100),
  };
}

function validateWorkflowStep(value: unknown, index: number): WorkflowStep {
  const path = `workflow.steps[${index}]`;
  const step = assertRecord(path, value);
  rejectUnknownKeys(path, step, ["sequence", "action", "owner_role", "system", "minutes", "manual"]);

  return {
    sequence: requiredInteger(`${path}.sequence`, step.sequence, 1),
    action: requiredString(`${path}.action`, step.action, 2, 500),
    owner_role: requiredString(`${path}.owner_role`, step.owner_role, 0, 100),
    system: optionalString(`${path}.system`, step.system, 0, 100),
    minutes: optionalNumber(`${path}.minutes`, step.minutes, 0, 10080),
    manual: requiredBoolean(`${path}.manual`, step.manual),
  };
}

function validateWorkflow(value: unknown): WorkflowProfile {
  const workflow = assertRecord("workflow", value);
  rejectUnknownKeys("workflow", workflow, [
    "name",
    "department",
    "trigger",
    "desired_outcome",
    "steps",
    "monthly_volume",
    "minutes_per_run",
    "loaded_hourly_rate_usd",
    "error_rate_percent",
    "cost_per_error_usd",
    "annual_revenue_at_risk_usd",
    "systems",
    "pain_points",
    "exception_rate_percent",
    "data_sensitivity",
    "evidence_quality",
    "notes",
  ]);

  if (!Array.isArray(workflow.steps) || workflow.steps.length < 1 || workflow.steps.length > 50) {
    fail("workflow.steps must include between 1 and 50 steps");
  }

  return {
    name: requiredString("workflow.name", workflow.name, 3, 140),
    department: requiredString("workflow.department", workflow.department, 2, 100),
    trigger: requiredString("workflow.trigger", workflow.trigger, 3, 500),
    desired_outcome: requiredString("workflow.desired_outcome", workflow.desired_outcome, 3, 500),
    steps: workflow.steps.map(validateWorkflowStep),
    monthly_volume: requiredNumber("workflow.monthly_volume", workflow.monthly_volume, 0),
    minutes_per_run: requiredNumber("workflow.minutes_per_run", workflow.minutes_per_run, 0, 10080),
    loaded_hourly_rate_usd: optionalNumber("workflow.loaded_hourly_rate_usd", workflow.loaded_hourly_rate_usd, 10, 1000),
    error_rate_percent: optionalNumber("workflow.error_rate_percent", workflow.error_rate_percent, 0, 100),
    cost_per_error_usd: optionalNumber("workflow.cost_per_error_usd", workflow.cost_per_error_usd, 0),
    annual_revenue_at_risk_usd: optionalNumber("workflow.annual_revenue_at_risk_usd", workflow.annual_revenue_at_risk_usd, 0),
    systems: optionalStringArray("workflow.systems", workflow.systems, 30, 100),
    pain_points: optionalStringArray("workflow.pain_points", workflow.pain_points, 20, 300),
    exception_rate_percent: optionalNumber("workflow.exception_rate_percent", workflow.exception_rate_percent, 0, 100),
    data_sensitivity: requiredEnum("workflow.data_sensitivity", workflow.data_sensitivity, [
      "public",
      "internal",
      "confidential",
      "regulated",
    ]),
    evidence_quality: requiredEnum("workflow.evidence_quality", workflow.evidence_quality, [
      "measured",
      "owner_estimate",
      "team_estimate",
      "unknown",
    ]),
    notes: optionalString("workflow.notes", workflow.notes, 0, 2000),
  };
}

export function validateCreateAuditInput(value: unknown): CreateAuditInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, [
    "business",
    "constraints",
    "default_loaded_hourly_rate_usd",
    "source",
  ]);

  return {
    business: validateBusiness(input.business),
    constraints: validateConstraints(input.constraints),
    default_loaded_hourly_rate_usd: optionalNumber(
      "default_loaded_hourly_rate_usd",
      input.default_loaded_hourly_rate_usd,
      10,
      1000,
    ),
    source: optionalEnum("source", input.source, ["self_serve", "consultant_led", "partner_led"]),
  };
}

export function validateUpsertWorkflowInput(value: unknown): UpsertWorkflowInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, ["audit_id", "workflow_id", "workflow"]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    workflow_id: optionalWorkflowId("workflow_id", input.workflow_id),
    workflow: validateWorkflow(input.workflow),
  };
}

export function validateScoreOpportunitiesInput(value: unknown): ScoreOpportunitiesInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, ["audit_id", "workflow_ids", "force_recalculate"]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    workflow_ids: optionalWorkflowIds("workflow_ids", input.workflow_ids, 100),
    force_recalculate: optionalBoolean("force_recalculate", input.force_recalculate),
  };
}

export function validateEstimateRoiInput(value: unknown): EstimateRoiInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, [
    "audit_id",
    "workflow_ids",
    "implementation_cost_usd",
    "annual_software_cost_usd",
    "automation_coverage_percent",
    "adoption_rate_percent",
    "include_revenue_uplift",
  ]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    workflow_ids: requiredWorkflowIds("workflow_ids", input.workflow_ids, 20),
    implementation_cost_usd: optionalNumber("implementation_cost_usd", input.implementation_cost_usd, 0),
    annual_software_cost_usd: optionalNumber("annual_software_cost_usd", input.annual_software_cost_usd, 0),
    automation_coverage_percent: optionalNumber(
      "automation_coverage_percent",
      input.automation_coverage_percent,
      0,
      100,
    ),
    adoption_rate_percent: optionalNumber("adoption_rate_percent", input.adoption_rate_percent, 0, 100),
    include_revenue_uplift: optionalBoolean("include_revenue_uplift", input.include_revenue_uplift),
  };
}

export function validateRecommendSolutionStackInput(value: unknown): RecommendSolutionStackInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, ["audit_id", "workflow_ids", "preference", "allow_named_products"]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    workflow_ids: requiredWorkflowIds("workflow_ids", input.workflow_ids, 20),
    preference: optionalEnum("preference", input.preference, [
      "lowest_cost",
      "fastest_launch",
      "most_scalable",
      "least_change",
      "balanced",
    ]),
    allow_named_products: optionalBoolean("allow_named_products", input.allow_named_products),
  };
}

export function validateGenerateRoadmapInput(value: unknown): GenerateRoadmapInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, [
    "audit_id",
    "workflow_ids",
    "start_date",
    "delivery_capacity",
    "max_parallel_initiatives",
  ]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    workflow_ids: requiredWorkflowIds("workflow_ids", input.workflow_ids, 20),
    start_date: optionalDate("start_date", input.start_date),
    delivery_capacity: optionalEnum("delivery_capacity", input.delivery_capacity, [
      "owner_only",
      "small_internal_team",
      "implementation_partner",
      "mixed_team",
    ]),
    max_parallel_initiatives: optionalInteger("max_parallel_initiatives", input.max_parallel_initiatives, 1, 5),
  };
}

export function validateGetAuditReportInput(value: unknown): GetAuditReportInput {
  const input = assertRecord("input", value);
  rejectUnknownKeys("input", input, ["audit_id", "audience", "detail_level", "include_sprint_fit"]);

  return {
    audit_id: requiredAuditId("audit_id", input.audit_id),
    audience: optionalEnum("audience", input.audience, [
      "owner",
      "executive_team",
      "operations_team",
      "implementation_partner",
    ]),
    detail_level: optionalEnum("detail_level", input.detail_level, [
      "executive",
      "standard",
      "implementation",
    ]),
    include_sprint_fit: optionalBoolean("include_sprint_fit", input.include_sprint_fit),
  };
}

export function validateToolInput(toolName: AuditFlowToolName, value: unknown): AuditFlowToolInput {
  switch (toolName) {
    case "create_audit":
      return validateCreateAuditInput(value);
    case "upsert_workflow":
      return validateUpsertWorkflowInput(value);
    case "score_opportunities":
      return validateScoreOpportunitiesInput(value);
    case "estimate_roi":
      return validateEstimateRoiInput(value);
    case "recommend_solution_stack":
      return validateRecommendSolutionStackInput(value);
    case "generate_roadmap":
      return validateGenerateRoadmapInput(value);
    case "get_audit_report":
      return validateGetAuditReportInput(value);
  }
}
