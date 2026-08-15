import {
  evaluateWorkflowCompleteness,
  type AuditFlowErrorCode,
  type AuditFlowRepositories,
  type AuditId,
  type CreateAuditInput,
  type EventId,
  type ScoreOpportunitiesInput,
  type TenantScope,
  type UpsertWorkflowInput,
  type WorkflowProfile,
  type WorkflowId,
} from "./index.ts";
import {
  SCORING_VERSION,
  scoreOpportunity,
  type OpportunityScoreInput,
  type OpportunityScoreResult,
  type PriorityBand,
} from "../../scoring-engine/src/opportunity-score.ts";

export interface AuditFlowServiceDependencies {
  repositories: AuditFlowRepositories;
  clock: {
    now(): string;
  };
  ids: {
    auditId(): AuditId;
    workflowId(): WorkflowId;
    eventId(): EventId;
  };
}

export interface CreateAuditServiceResult {
  audit_id: AuditId;
  status: "intake";
  missing_fields: string[];
  next_action: string;
}

export interface UpsertWorkflowServiceResult {
  audit_id: AuditId;
  workflow_id: WorkflowId;
  completeness_percent: number;
  warnings: string[];
  next_action: string;
}

export interface ScoredOpportunity {
  workflow_id: WorkflowId;
  workflow_name: string;
  impact_score: number;
  feasibility_score: number;
  risk_score: number;
  confidence_score: number;
  priority_score: number;
  priority_band: PriorityBand;
  automation_pattern: string;
  reasons: string[];
  blockers: string[];
}

export interface ScoreOpportunitiesServiceResult {
  audit_id: AuditId;
  scoring_version: typeof SCORING_VERSION;
  opportunities: ScoredOpportunity[];
}

export class AuditFlowServiceError extends Error {
  readonly code: AuditFlowErrorCode;
  readonly retryable: boolean;
  readonly missing: string[];

  constructor(
    code: AuditFlowErrorCode,
    message: string,
    retryable: boolean,
    missing: string[] = [],
  ) {
    super(message);
    this.name = "AuditFlowServiceError";
    this.code = code;
    this.retryable = retryable;
    this.missing = missing;
  }

  toPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        missing: this.missing,
      },
    };
  }
}

function createAuditMissingFields(input: CreateAuditInput): string[] {
  const missingFields: string[] = [];

  if (input.business.annual_revenue_usd === undefined) {
    missingFields.push("business.annual_revenue_usd");
  }
  if (!input.constraints?.budget_range_usd) {
    missingFields.push("constraints.budget_range_usd");
  }
  if (!input.constraints?.target_timeline_days) {
    missingFields.push("constraints.target_timeline_days");
  }

  return missingFields;
}

function createAuditNextAction(missingFields: string[]): string {
  if (missingFields.length > 0) {
    return "Record the first high-friction workflow while marking missing business assumptions.";
  }
  return "Record the first high-friction workflow.";
}

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function scoreFromRatio(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clampScore((value / ceiling) * 100);
}

function evidenceConfidenceScore(workflow: WorkflowProfile): number {
  switch (workflow.evidence_quality) {
    case "measured":
      return 90;
    case "owner_estimate":
      return 75;
    case "team_estimate":
      return 65;
    case "unknown":
      return 35;
  }
}

function dataQualityScore(workflow: WorkflowProfile): number {
  switch (workflow.evidence_quality) {
    case "measured":
      return 90;
    case "owner_estimate":
      return 75;
    case "team_estimate":
      return 65;
    case "unknown":
      return 30;
  }
}

function riskScore(workflow: WorkflowProfile): number {
  const sensitivityRisk = {
    public: 15,
    internal: 30,
    confidential: 45,
    regulated: 70,
  }[workflow.data_sensitivity];
  const exceptionRisk = scoreFromRatio(workflow.exception_rate_percent ?? 0, 30);
  const evidenceRisk = 100 - dataQualityScore(workflow);

  return clampScore(0.55 * sensitivityRisk + 0.25 * exceptionRisk + 0.2 * evidenceRisk);
}

function automationPattern(workflow: WorkflowProfile): string {
  const systems = workflow.systems ?? [];
  const hasManualSteps = workflow.steps.some((step) => step.manual);
  const hasMultipleSystems = systems.length >= 2;

  if (hasMultipleSystems && hasManualSteps) return "workflow_orchestration";
  if (hasManualSteps) return "human_in_the_loop_assistance";
  if (systems.length > 0) return "system_integration";
  return "process_discovery";
}

function scoringReasons(workflow: WorkflowProfile, result: OpportunityScoreResult): string[] {
  const reasons = [
    `${workflow.monthly_volume} monthly runs at ${workflow.minutes_per_run} minutes each`,
    `${workflow.evidence_quality.replace("_", " ")} evidence`,
  ];

  if ((workflow.systems?.length ?? 0) > 0) {
    reasons.push(`uses ${workflow.systems!.length} named system${workflow.systems!.length === 1 ? "" : "s"}`);
  }
  if ((workflow.pain_points?.length ?? 0) > 0) {
    reasons.push(`${workflow.pain_points!.length} recorded pain point${workflow.pain_points!.length === 1 ? "" : "s"}`);
  }
  if (result.priorityBand === "quick_win") {
    reasons.push("high feasibility with manageable risk");
  }
  if (result.priorityBand === "strategic_bet") {
    reasons.push("high impact but requires design discipline before implementation");
  }

  return reasons;
}

function scoringBlockers(workflow: WorkflowProfile, result: OpportunityScoreResult): string[] {
  const blockers: string[] = [];

  if (workflow.data_sensitivity === "regulated") {
    blockers.push("regulated data requires security and compliance review");
  }
  if ((workflow.exception_rate_percent ?? 0) >= 25) {
    blockers.push("high exception rate requires process stabilization");
  }
  if (workflow.evidence_quality === "unknown") {
    blockers.push("unknown evidence quality requires measured or owner-validated inputs");
  }
  if ((workflow.systems?.length ?? 0) === 0) {
    blockers.push("no source systems recorded");
  }
  if (result.priorityBand === "defer") {
    blockers.push("priority score is below implementation threshold");
  }

  return blockers;
}

export function mapWorkflowToOpportunityScoreInput(workflow: WorkflowProfile): OpportunityScoreInput {
  const annualLaborHours = (workflow.monthly_volume * workflow.minutes_per_run * 12) / 60;
  const errorCostPerMonth =
    workflow.monthly_volume *
    ((workflow.error_rate_percent ?? 0) / 100) *
    (workflow.cost_per_error_usd ?? 0);
  const hasStepDetail = workflow.steps.length >= 2;
  const manualStepRatio =
    workflow.steps.length === 0
      ? 0
      : workflow.steps.filter((step) => step.manual).length / workflow.steps.length;

  return {
    impact: {
      laborValue: scoreFromRatio(annualLaborHours, 600),
      volume: scoreFromRatio(workflow.monthly_volume, 250),
      errorCost: scoreFromRatio(errorCostPerMonth * 12, 25_000),
      customerImpact: clampScore(
        35 +
          scoreFromRatio(workflow.pain_points?.length ?? 0, 4) * 0.4 +
          scoreFromRatio(workflow.exception_rate_percent ?? 0, 20) * 0.25,
      ),
      revenueImpact: scoreFromRatio(workflow.annual_revenue_at_risk_usd ?? 0, 100_000),
    },
    feasibility: {
      ruleClarity: clampScore(
        45 +
          (hasStepDetail ? 20 : 0) +
          (workflow.trigger ? 10 : 0) +
          (workflow.desired_outcome ? 10 : 0) +
          (manualStepRatio > 0 ? 10 : 0),
      ),
      digitalInput: clampScore(35 + scoreFromRatio(workflow.systems?.length ?? 0, 3) * 0.65),
      integrationReadiness: clampScore(30 + scoreFromRatio(workflow.systems?.length ?? 0, 4) * 0.7),
      dataQuality: dataQualityScore(workflow),
      processStability: clampScore(100 - scoreFromRatio(workflow.exception_rate_percent ?? 0, 35) * 0.7),
      ownerReadiness: evidenceConfidenceScore(workflow),
    },
    risk: riskScore(workflow),
    confidence: clampScore((workflow.monthly_volume > 0 ? 15 : 0) + (workflow.minutes_per_run > 0 ? 15 : 0) + evidenceConfidenceScore(workflow) * 0.7),
    automationInappropriate: workflow.data_sensitivity === "regulated" && workflow.evidence_quality === "unknown",
  };
}

export async function createAuditService(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  input: CreateAuditInput,
): Promise<CreateAuditServiceResult> {
  const auditId = deps.ids.auditId();
  const now = deps.clock.now();
  const audit = await deps.repositories.audits.createAudit(scope, {
    auditId,
    business: input.business,
    constraints: input.constraints,
    defaultLoadedHourlyRateUsd: input.default_loaded_hourly_rate_usd,
    source: input.source,
    now,
  });
  const missingFields = createAuditMissingFields(input);

  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId,
    type: "audit.created",
    occurredAt: now,
    payload: {
      status: audit.status,
      missingFields,
      source: audit.source,
    },
  });

  return {
    audit_id: audit.auditId,
    status: "intake",
    missing_fields: missingFields,
    next_action: createAuditNextAction(missingFields),
  };
}

export async function upsertWorkflowService(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  input: UpsertWorkflowInput,
): Promise<UpsertWorkflowServiceResult> {
  const audit = await deps.repositories.audits.getAudit(scope, input.audit_id);
  if (!audit) {
    throw new AuditFlowServiceError(
      "AUDIT_NOT_FOUND",
      "Audit was not found for the current tenant.",
      false,
      ["audit_id"],
    );
  }

  const workflowId = input.workflow_id ?? deps.ids.workflowId();
  const now = deps.clock.now();
  const completeness = evaluateWorkflowCompleteness(input.workflow);
  const workflow = await deps.repositories.workflows.upsertWorkflow(scope, {
    auditId: input.audit_id,
    workflowId,
    workflow: input.workflow,
    completeness,
    now,
  });
  const nextStatus = completeness.scoreable ? "ready_to_score" : "workflow_capture";

  await deps.repositories.audits.updateAuditStatus(scope, input.audit_id, nextStatus, now);
  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId: input.audit_id,
    type: "workflow.upserted",
    occurredAt: now,
    payload: {
      workflowId,
      workflowName: workflow.workflow.name,
    },
  });
  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId: input.audit_id,
    type: "workflow.completeness_evaluated",
    occurredAt: now,
    payload: {
      workflowId,
      completenessPercent: completeness.completenessPercent,
      evidenceConfidence: completeness.evidenceConfidence,
      scoreable: completeness.scoreable,
      missingFields: completeness.missingFields,
      warnings: completeness.warnings,
    },
  });

  return {
    audit_id: input.audit_id,
    workflow_id: workflow.workflowId,
    completeness_percent: completeness.completenessPercent,
    warnings: completeness.warnings,
    next_action: completeness.nextAction,
  };
}

export async function scoreOpportunitiesService(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  input: ScoreOpportunitiesInput,
): Promise<ScoreOpportunitiesServiceResult> {
  const audit = await deps.repositories.audits.getAudit(scope, input.audit_id);
  if (!audit) {
    throw new AuditFlowServiceError(
      "AUDIT_NOT_FOUND",
      "Audit was not found for the current tenant.",
      false,
      ["audit_id"],
    );
  }

  const workflows = await deps.repositories.workflows.listWorkflows(scope, {
    auditId: input.audit_id,
    workflowIds: input.workflow_ids,
  });

  if (input.workflow_ids && workflows.length !== input.workflow_ids.length) {
    const foundIds = new Set(workflows.map((workflow) => workflow.workflowId));
    const missingWorkflowIds = input.workflow_ids.filter((workflowId) => !foundIds.has(workflowId));
    throw new AuditFlowServiceError(
      "WORKFLOW_NOT_FOUND",
      "One or more workflows were not found for the current audit and tenant.",
      false,
      missingWorkflowIds,
    );
  }

  const unscoreable = workflows.filter((workflow) => !workflow.completeness.scoreable);
  if (unscoreable.length > 0) {
    throw new AuditFlowServiceError(
      "INSUFFICIENT_EVIDENCE",
      "One or more selected workflows need more evidence before scoring.",
      true,
      unscoreable.flatMap((workflow) => workflow.completeness.missingFields),
    );
  }

  const scoreableWorkflows = workflows.filter((workflow) => workflow.completeness.scoreable);
  if (scoreableWorkflows.length < 3) {
    throw new AuditFlowServiceError(
      "INSUFFICIENT_WORKFLOWS",
      "AuditFlow requires at least three scoreable workflows before opportunity scoring.",
      true,
      ["workflows:minimum_3_scoreable"],
    );
  }

  const opportunities = scoreableWorkflows
    .map((workflow) => {
      const result = scoreOpportunity(mapWorkflowToOpportunityScoreInput(workflow.workflow));

      return {
        workflow_id: workflow.workflowId,
        workflow_name: workflow.workflow.name,
        impact_score: result.impactScore,
        feasibility_score: result.feasibilityScore,
        risk_score: result.riskScore,
        confidence_score: result.confidenceScore,
        priority_score: result.priorityScore,
        priority_band: result.priorityBand,
        automation_pattern: automationPattern(workflow.workflow),
        reasons: scoringReasons(workflow.workflow, result),
        blockers: scoringBlockers(workflow.workflow, result),
      };
    })
    .sort((left, right) => right.priority_score - left.priority_score);

  const now = deps.clock.now();
  await deps.repositories.audits.updateAuditStatus(scope, input.audit_id, "scored", now);
  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId: input.audit_id,
    type: "opportunities.scored",
    occurredAt: now,
    payload: {
      scoringVersion: SCORING_VERSION,
      workflowIds: opportunities.map((opportunity) => opportunity.workflow_id),
      forceRecalculate: input.force_recalculate ?? false,
    },
  });

  return {
    audit_id: input.audit_id,
    scoring_version: SCORING_VERSION,
    opportunities,
  };
}
