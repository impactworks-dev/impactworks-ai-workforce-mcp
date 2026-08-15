import {
  evaluateWorkflowCompleteness,
  type AuditFlowErrorCode,
  type AuditFlowRepositories,
  type AuditId,
  type CreateAuditInput,
  type EstimateRoiInput,
  type EventId,
  type GenerateRoadmapInput,
  type RoadmapId,
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
import {
  DEFAULT_ROI_SCENARIOS,
  ROI_VERSION,
  calculateRoiScenario,
  type RoiInputs,
  type ScenarioAssumptions,
} from "../../scoring-engine/src/roi.ts";

export interface AuditFlowServiceDependencies {
  repositories: AuditFlowRepositories;
  clock: {
    now(): string;
  };
  ids: {
    auditId(): AuditId;
    workflowId(): WorkflowId;
    roadmapId(): RoadmapId;
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

export interface EstimateRoiScenario {
  name: "low" | "expected" | "high";
  annual_hours_recovered: number;
  annual_labor_value_usd: number;
  annual_error_reduction_value_usd: number;
  annual_revenue_uplift_usd: number;
  annual_net_benefit_usd: number;
  first_year_roi_percent: number | null;
  payback_months: number | null;
}

export interface EstimateRoiServiceResult {
  audit_id: AuditId;
  currency: "USD";
  roi_version: typeof ROI_VERSION;
  scenarios: EstimateRoiScenario[];
  assumptions: string[];
  excluded_benefits: string[];
  confidence: "low" | "medium" | "high";
  disclaimer: string;
}

export interface RoadmapInitiative {
  workflow_id: WorkflowId;
  deliverable: string;
  owner_role: string;
  dependencies: string[];
  success_metric: string;
  decision_gate: string;
}

export interface RoadmapPhase {
  phase: "days_1_30" | "days_31_60" | "days_61_90";
  objective: string;
  initiatives: RoadmapInitiative[];
}

export interface GenerateRoadmapServiceResult {
  audit_id: AuditId;
  roadmap_id: RoadmapId;
  phases: RoadmapPhase[];
  critical_dependencies: string[];
  executive_decisions: string[];
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

function moneyAssumption(label: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return `${label}: not provided`;
  return `${label}: $${Math.round(value).toLocaleString("en-US")}`;
}

function percentAssumption(label: string, value: number): string {
  return `${label}: ${Math.round(value * 100)}%`;
}

function adjustedScenarioAssumptions(input: EstimateRoiInput): Record<EstimateRoiScenario["name"], ScenarioAssumptions> {
  const coverageRatio =
    input.automation_coverage_percent === undefined
      ? 1
      : (input.automation_coverage_percent / 100) / DEFAULT_ROI_SCENARIOS.expected.automationCoverage;
  const adoptionRatio =
    input.adoption_rate_percent === undefined
      ? 1
      : (input.adoption_rate_percent / 100) / DEFAULT_ROI_SCENARIOS.expected.adoptionRate;

  return {
    low: {
      ...DEFAULT_ROI_SCENARIOS.low,
      automationCoverage: Math.min(1, DEFAULT_ROI_SCENARIOS.low.automationCoverage * coverageRatio),
      adoptionRate: Math.min(1, DEFAULT_ROI_SCENARIOS.low.adoptionRate * adoptionRatio),
    },
    expected: {
      ...DEFAULT_ROI_SCENARIOS.expected,
      automationCoverage:
        input.automation_coverage_percent === undefined
          ? DEFAULT_ROI_SCENARIOS.expected.automationCoverage
          : input.automation_coverage_percent / 100,
      adoptionRate:
        input.adoption_rate_percent === undefined
          ? DEFAULT_ROI_SCENARIOS.expected.adoptionRate
          : input.adoption_rate_percent / 100,
    },
    high: {
      ...DEFAULT_ROI_SCENARIOS.high,
      automationCoverage: Math.min(1, DEFAULT_ROI_SCENARIOS.high.automationCoverage * coverageRatio),
      adoptionRate: Math.min(1, DEFAULT_ROI_SCENARIOS.high.adoptionRate * adoptionRatio),
    },
  };
}

function estimateRoiConfidence(workflows: WorkflowProfile[]): "low" | "medium" | "high" {
  if (workflows.some((workflow) => workflow.evidence_quality === "unknown")) return "low";
  if (workflows.every((workflow) => workflow.evidence_quality === "measured")) return "high";
  return "medium";
}

function aggregateRoiInputs(
  workflows: WorkflowProfile[],
  defaultLoadedHourlyRateUsd: number,
  input: EstimateRoiInput,
): RoiInputs {
  const totalMonthlyVolume = workflows.reduce((sum, workflow) => sum + workflow.monthly_volume, 0);
  const totalMonthlyMinutes = workflows.reduce(
    (sum, workflow) => sum + workflow.monthly_volume * workflow.minutes_per_run,
    0,
  );
  const totalWeightedLaborValue = workflows.reduce(
    (sum, workflow) =>
      sum +
      workflow.monthly_volume *
        workflow.minutes_per_run *
        (workflow.loaded_hourly_rate_usd ?? defaultLoadedHourlyRateUsd),
    0,
  );
  const expectedMonthlyErrors = workflows.reduce(
    (sum, workflow) => sum + workflow.monthly_volume * ((workflow.error_rate_percent ?? 0) / 100),
    0,
  );
  const monthlyErrorCost = workflows.reduce(
    (sum, workflow) =>
      sum +
      workflow.monthly_volume *
        ((workflow.error_rate_percent ?? 0) / 100) *
        (workflow.cost_per_error_usd ?? 0),
    0,
  );
  const annualRevenueUplift =
    input.include_revenue_uplift === true
      ? workflows.reduce((sum, workflow) => sum + (workflow.annual_revenue_at_risk_usd ?? 0), 0)
      : 0;

  return {
    monthlyVolume: totalMonthlyVolume || 1,
    minutesPerRun: totalMonthlyVolume > 0 ? totalMonthlyMinutes / totalMonthlyVolume : 0,
    loadedHourlyRate:
      totalMonthlyMinutes > 0 ? totalWeightedLaborValue / totalMonthlyMinutes : defaultLoadedHourlyRateUsd,
    currentErrorRate: totalMonthlyVolume > 0 ? expectedMonthlyErrors / totalMonthlyVolume : 0,
    costPerError: expectedMonthlyErrors > 0 ? monthlyErrorCost / expectedMonthlyErrors : 0,
    implementationCost: input.implementation_cost_usd ?? null,
    annualSoftwareCost: input.annual_software_cost_usd ?? 0,
    annualRevenueUplift,
  };
}

function roiAssumptions(
  workflows: WorkflowProfile[],
  roiInputs: RoiInputs,
  scenarioAssumptions: Record<EstimateRoiScenario["name"], ScenarioAssumptions>,
): string[] {
  const totalMonthlyVolume = workflows.reduce((sum, workflow) => sum + workflow.monthly_volume, 0);
  return [
    `Selected workflows: ${workflows.length}`,
    `Combined monthly volume: ${totalMonthlyVolume}`,
    `Weighted average minutes per run: ${Math.round(roiInputs.minutesPerRun * 100) / 100}`,
    moneyAssumption("Loaded labor rate", roiInputs.loadedHourlyRate),
    percentAssumption("Expected automation coverage", scenarioAssumptions.expected.automationCoverage),
    percentAssumption("Expected user adoption", scenarioAssumptions.expected.adoptionRate),
    moneyAssumption("One-time implementation cost", roiInputs.implementationCost),
    moneyAssumption("Annual software cost", roiInputs.annualSoftwareCost),
  ];
}

function excludedBenefits(workflows: WorkflowProfile[], includeRevenueUplift: boolean | undefined): string[] {
  const excluded = ["Customer experience improvements", "Management time recovered"];
  const revenueAtRisk = workflows.reduce((sum, workflow) => sum + (workflow.annual_revenue_at_risk_usd ?? 0), 0);
  if (!includeRevenueUplift && revenueAtRisk > 0) {
    excluded.unshift("Revenue uplift from faster or more consistent execution");
  }
  return excluded;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function primaryOwnerRole(workflow: WorkflowProfile): string {
  const manualOwner = workflow.steps.find((step) => step.manual)?.owner_role;
  if (manualOwner) return manualOwner;
  return `${workflow.department} owner`;
}

function roadmapDependencies(workflow: WorkflowProfile): string[] {
  const systems = workflow.systems ?? [];
  return unique([
    "Named process owner",
    systems.length > 0 ? `${systems[0]} admin access` : "Source-system access",
    "Two weeks of baseline data",
    workflow.data_sensitivity === "regulated" ? "Security and compliance review" : "",
    (workflow.exception_rate_percent ?? 0) >= 15 ? "Exception handling rules" : "",
  ]);
}

function roadmapSuccessMetric(workflow: WorkflowProfile): string {
  if (workflow.department.toLowerCase().includes("sales")) {
    return "Owner approves baseline response time, conversion quality, and follow-up completion rate.";
  }
  if (workflow.department.toLowerCase().includes("operations")) {
    return "Owner approves cycle time, exception rate, and manual rework baseline.";
  }
  return "Owner approves baseline cycle time, quality, and exception metrics.";
}

function roadmapDecisionGate(workflow: WorkflowProfile): string {
  if ((workflow.exception_rate_percent ?? 0) >= 15) {
    return "Proceed only after the top exceptions are documented and escalation rules are approved.";
  }
  if (workflow.data_sensitivity === "regulated") {
    return "Proceed only after security controls and approval policy are accepted by the named owner.";
  }
  return "Proceed if the owner confirms the workflow is bounded, measurable, and safe to pilot.";
}

function roadmapDeliverable(workflow: WorkflowProfile, phase: RoadmapPhase["phase"]): string {
  switch (phase) {
    case "days_1_30":
      return `Instrument and document ${workflow.name}, including owners, rules, systems, baseline metrics, and approval points.`;
    case "days_31_60":
      return `Launch a controlled ${workflow.name} pilot with human review, event logging, and exception handling.`;
    case "days_61_90":
      return `Measure ${workflow.name}, harden controls, and prepare the expansion or AgentOps handoff.`;
  }
}

function phaseObjective(phase: RoadmapPhase["phase"]): string {
  switch (phase) {
    case "days_1_30":
      return "Validate the best opportunities, establish baselines, and prepare safe implementation.";
    case "days_31_60":
      return "Launch controlled pilots with approval gates, logs, and recovery paths.";
    case "days_61_90":
      return "Measure outcomes, harden controls, and decide whether to expand, revise, or stop.";
  }
}

function roadmapCriticalDependencies(workflows: WorkflowProfile[], capacity: GenerateRoadmapInput["delivery_capacity"]): string[] {
  const systems = unique(workflows.flatMap((workflow) => workflow.systems ?? []));
  return unique([
    "Named business owner for each workflow",
    "Approved success metrics and baseline period",
    "Approval policy for consequential external actions",
    "Audit log and exception review process",
    systems.length > 0 ? `Access to core systems: ${systems.slice(0, 5).join(", ")}` : "Confirmed source-system access",
    workflows.some((workflow) => workflow.data_sensitivity === "regulated") ? "Security and compliance review" : "",
    capacity === "owner_only" ? "Owner availability for weekly review and acceptance" : "",
  ]);
}

function roadmapExecutiveDecisions(input: GenerateRoadmapInput, workflows: WorkflowProfile[]): string[] {
  const decisions = [
    "Approve the first pilot workflow and named owner",
    "Approve implementation budget and internal capacity",
    "Set escalation thresholds and approval authority",
    "Confirm what results may be used as proof after the internal run",
  ];

  if (input.delivery_capacity === "implementation_partner" || input.delivery_capacity === "mixed_team") {
    decisions.push("Confirm implementation partner role, access boundaries, and handoff expectations");
  }
  if (workflows.some((workflow) => workflow.data_sensitivity !== "public")) {
    decisions.push("Approve data-handling controls before production use");
  }

  return unique(decisions);
}

function phaseForIndex(index: number, maxParallel: number): RoadmapPhase["phase"] {
  if (index < maxParallel) return "days_1_30";
  if (index < maxParallel * 2) return "days_31_60";
  return "days_61_90";
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

export async function estimateRoiService(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  input: EstimateRoiInput,
): Promise<EstimateRoiServiceResult> {
  const audit = await deps.repositories.audits.getAudit(scope, input.audit_id);
  if (!audit) {
    throw new AuditFlowServiceError(
      "AUDIT_NOT_FOUND",
      "Audit was not found for the current tenant.",
      false,
      ["audit_id"],
    );
  }

  const workflowRecords = await deps.repositories.workflows.listWorkflows(scope, {
    auditId: input.audit_id,
    workflowIds: input.workflow_ids,
  });

  if (workflowRecords.length !== input.workflow_ids.length) {
    const foundIds = new Set(workflowRecords.map((workflow) => workflow.workflowId));
    const missingWorkflowIds = input.workflow_ids.filter((workflowId) => !foundIds.has(workflowId));
    throw new AuditFlowServiceError(
      "WORKFLOW_NOT_FOUND",
      "One or more workflows were not found for the current audit and tenant.",
      false,
      missingWorkflowIds,
    );
  }

  const unscoreable = workflowRecords.filter((workflow) => !workflow.completeness.scoreable);
  if (unscoreable.length > 0) {
    throw new AuditFlowServiceError(
      "INSUFFICIENT_EVIDENCE",
      "One or more selected workflows need more evidence before ROI estimation.",
      true,
      unscoreable.flatMap((workflow) => workflow.completeness.missingFields),
    );
  }

  const workflows = workflowRecords.map((record) => record.workflow);
  const assumptions = adjustedScenarioAssumptions(input);
  const roiInputs = aggregateRoiInputs(workflows, audit.defaultLoadedHourlyRateUsd, input);
  const scenarios = (["low", "expected", "high"] as const).map((name) => {
    const result = calculateRoiScenario(roiInputs, assumptions[name]);
    return {
      name,
      annual_hours_recovered: result.annualHoursRecovered,
      annual_labor_value_usd: result.annualLaborValue,
      annual_error_reduction_value_usd: result.annualErrorReductionValue,
      annual_revenue_uplift_usd: result.annualRevenueUplift,
      annual_net_benefit_usd: result.annualNetBenefit,
      first_year_roi_percent: result.firstYearRoiPercent,
      payback_months: result.paybackMonths,
    };
  });

  const now = deps.clock.now();
  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId: input.audit_id,
    type: "roi.estimated",
    occurredAt: now,
    payload: {
      roiVersion: ROI_VERSION,
      workflowIds: input.workflow_ids,
      includeRevenueUplift: input.include_revenue_uplift ?? false,
    },
  });

  return {
    audit_id: input.audit_id,
    currency: "USD",
    roi_version: ROI_VERSION,
    scenarios,
    assumptions: roiAssumptions(workflows, roiInputs, assumptions),
    excluded_benefits: excludedBenefits(workflows, input.include_revenue_uplift),
    confidence: estimateRoiConfidence(workflows),
    disclaimer: "These are planning estimates based on supplied assumptions, not guaranteed financial results.",
  };
}

export async function generateRoadmapService(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  input: GenerateRoadmapInput,
): Promise<GenerateRoadmapServiceResult> {
  const audit = await deps.repositories.audits.getAudit(scope, input.audit_id);
  if (!audit) {
    throw new AuditFlowServiceError(
      "AUDIT_NOT_FOUND",
      "Audit was not found for the current tenant.",
      false,
      ["audit_id"],
    );
  }

  const workflowRecords = await deps.repositories.workflows.listWorkflows(scope, {
    auditId: input.audit_id,
    workflowIds: input.workflow_ids,
  });

  if (workflowRecords.length !== input.workflow_ids.length) {
    const foundIds = new Set(workflowRecords.map((workflow) => workflow.workflowId));
    const missingWorkflowIds = input.workflow_ids.filter((workflowId) => !foundIds.has(workflowId));
    throw new AuditFlowServiceError(
      "WORKFLOW_NOT_FOUND",
      "One or more workflows were not found for the current audit and tenant.",
      false,
      missingWorkflowIds,
    );
  }

  const unscoreable = workflowRecords.filter((workflow) => !workflow.completeness.scoreable);
  if (unscoreable.length > 0) {
    throw new AuditFlowServiceError(
      "INSUFFICIENT_EVIDENCE",
      "One or more selected workflows need more evidence before roadmap generation.",
      true,
      unscoreable.flatMap((workflow) => workflow.completeness.missingFields),
    );
  }

  const maxParallel = input.max_parallel_initiatives ?? 2;
  const rankedWorkflows = workflowRecords
    .map((record) => ({
      ...record,
      score: scoreOpportunity(mapWorkflowToOpportunityScoreInput(record.workflow)),
    }))
    .sort((left, right) => right.score.priorityScore - left.score.priorityScore);

  const phaseNames = ["days_1_30", "days_31_60", "days_61_90"] as const;
  const phases: RoadmapPhase[] = phaseNames.map((phase) => ({
    phase,
    objective: phaseObjective(phase),
    initiatives: [],
  }));

  for (const [index, record] of rankedWorkflows.entries()) {
    const phaseName = phaseForIndex(index, maxParallel);
    const phase = phases.find((candidate) => candidate.phase === phaseName)!;
    phase.initiatives.push({
      workflow_id: record.workflowId,
      deliverable: roadmapDeliverable(record.workflow, phaseName),
      owner_role: primaryOwnerRole(record.workflow),
      dependencies: roadmapDependencies(record.workflow),
      success_metric: roadmapSuccessMetric(record.workflow),
      decision_gate: roadmapDecisionGate(record.workflow),
    });
  }

  const roadmapId = deps.ids.roadmapId();
  const now = deps.clock.now();
  const result: GenerateRoadmapServiceResult = {
    audit_id: input.audit_id,
    roadmap_id: roadmapId,
    phases,
    critical_dependencies: roadmapCriticalDependencies(
      rankedWorkflows.map((record) => record.workflow),
      input.delivery_capacity,
    ),
    executive_decisions: roadmapExecutiveDecisions(
      input,
      rankedWorkflows.map((record) => record.workflow),
    ),
  };

  await deps.repositories.audits.updateAuditStatus(scope, input.audit_id, "roadmap_ready", now);
  await deps.repositories.events.appendEvent(scope, {
    eventId: deps.ids.eventId(),
    auditId: input.audit_id,
    type: "roadmap.generated",
    occurredAt: now,
    payload: {
      roadmapId,
      workflowIds: rankedWorkflows.map((workflow) => workflow.workflowId),
      startDate: input.start_date,
      deliveryCapacity: input.delivery_capacity ?? "mixed_team",
      maxParallelInitiatives: maxParallel,
      phases: result.phases,
    },
  });

  return result;
}
