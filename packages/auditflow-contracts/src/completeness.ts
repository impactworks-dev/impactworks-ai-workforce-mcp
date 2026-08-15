import type { EvidenceQuality, WorkflowProfile } from "./index.ts";

export const WORKFLOW_COMPLETENESS_VERSION = "workflow-completeness-1.0.0";

export type EvidenceConfidence = "low" | "medium" | "high";

export interface WorkflowCompletenessResult {
  completenessVersion: typeof WORKFLOW_COMPLETENESS_VERSION;
  completenessPercent: number;
  scoreable: boolean;
  evidenceConfidence: EvidenceConfidence;
  missingFields: string[];
  warnings: string[];
  nextAction: string;
}

interface CompletenessCheck {
  field: string;
  weight: number;
  passed: boolean;
  critical?: boolean;
  missingMessage: string;
}

const evidenceConfidenceByQuality = {
  measured: "high",
  owner_estimate: "medium",
  team_estimate: "medium",
  unknown: "low",
} as const satisfies Record<EvidenceQuality, EvidenceConfidence>;

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasNonEmptyArray(value: unknown[] | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function roundPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function financialAssumptionsAreUseful(workflow: WorkflowProfile): boolean {
  return (
    hasPositiveNumber(workflow.loaded_hourly_rate_usd) ||
    (workflow.error_rate_percent !== undefined && hasPositiveNumber(workflow.cost_per_error_usd)) ||
    hasPositiveNumber(workflow.annual_revenue_at_risk_usd)
  );
}

function buildWarnings(workflow: WorkflowProfile): string[] {
  const warnings: string[] = [];

  if (workflow.evidence_quality === "unknown") {
    warnings.push("Evidence quality is unknown. Confirm volume, time, and error assumptions before scoring.");
  }
  if (workflow.evidence_quality === "owner_estimate") {
    warnings.push("Workflow data is based on an owner estimate. Mark assumptions clearly in the report.");
  }
  if (workflow.evidence_quality === "team_estimate") {
    warnings.push("Workflow data is based on a team estimate. Confirm assumptions with the accountable owner.");
  }
  if (!hasNonEmptyArray(workflow.systems)) {
    warnings.push("No systems were recorded. Integration feasibility will be lower confidence.");
  }
  if (!hasNonEmptyArray(workflow.pain_points)) {
    warnings.push("No pain points were recorded. Business-impact reasoning may be incomplete.");
  }
  if (!financialAssumptionsAreUseful(workflow)) {
    warnings.push("Financial assumptions are thin. ROI should exclude unsupported benefits by default.");
  }
  if (workflow.data_sensitivity === "regulated") {
    warnings.push("Workflow includes regulated data. Security and approval controls must be reviewed before implementation.");
  }

  return warnings;
}

function buildNextAction(scoreable: boolean, missingFields: string[], evidenceConfidence: EvidenceConfidence): string {
  if (!scoreable && missingFields.length > 0) {
    return `Collect required workflow evidence: ${missingFields.slice(0, 3).join(", ")}.`;
  }
  if (evidenceConfidence === "low") {
    return "Confirm the workflow evidence source before scoring this opportunity.";
  }
  if (!scoreable) {
    return "Add more workflow detail before scoring this opportunity.";
  }
  return "Workflow is ready for opportunity scoring.";
}

export function evaluateWorkflowCompleteness(workflow: WorkflowProfile): WorkflowCompletenessResult {
  const checks: CompletenessCheck[] = [
    {
      field: "name",
      weight: 5,
      passed: hasText(workflow.name),
      missingMessage: "workflow.name",
    },
    {
      field: "department",
      weight: 5,
      passed: hasText(workflow.department),
      missingMessage: "workflow.department",
    },
    {
      field: "trigger",
      weight: 5,
      passed: hasText(workflow.trigger),
      missingMessage: "workflow.trigger",
    },
    {
      field: "desired_outcome",
      weight: 5,
      passed: hasText(workflow.desired_outcome),
      missingMessage: "workflow.desired_outcome",
    },
    {
      field: "steps",
      weight: 15,
      passed: workflow.steps.length > 0,
      critical: true,
      missingMessage: "workflow.steps",
    },
    {
      field: "monthly_volume",
      weight: 15,
      passed: hasPositiveNumber(workflow.monthly_volume),
      critical: true,
      missingMessage: "workflow.monthly_volume",
    },
    {
      field: "minutes_per_run",
      weight: 15,
      passed: hasPositiveNumber(workflow.minutes_per_run),
      critical: true,
      missingMessage: "workflow.minutes_per_run",
    },
    {
      field: "systems",
      weight: 8,
      passed: hasNonEmptyArray(workflow.systems),
      missingMessage: "workflow.systems",
    },
    {
      field: "pain_points",
      weight: 7,
      passed: hasNonEmptyArray(workflow.pain_points),
      missingMessage: "workflow.pain_points",
    },
    {
      field: "financial_assumptions",
      weight: 10,
      passed: financialAssumptionsAreUseful(workflow),
      missingMessage: "workflow.financial_assumptions",
    },
    {
      field: "data_sensitivity",
      weight: 5,
      passed: hasText(workflow.data_sensitivity),
      missingMessage: "workflow.data_sensitivity",
    },
    {
      field: "evidence_quality",
      weight: 5,
      passed: workflow.evidence_quality !== "unknown",
      critical: true,
      missingMessage: "workflow.evidence_quality",
    },
  ];

  const earnedWeight = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const missingFields = checks
    .filter((check) => !check.passed)
    .map((check) => check.missingMessage);
  const missingCriticalFields = checks.filter((check) => check.critical && !check.passed);
  const completenessPercent = roundPercent(earnedWeight);
  const evidenceConfidence = evidenceConfidenceByQuality[workflow.evidence_quality];
  const scoreable =
    completenessPercent >= 75 &&
    missingCriticalFields.length === 0 &&
    evidenceConfidence !== "low";

  return {
    completenessVersion: WORKFLOW_COMPLETENESS_VERSION,
    completenessPercent,
    scoreable,
    evidenceConfidence,
    missingFields,
    warnings: buildWarnings(workflow),
    nextAction: buildNextAction(scoreable, missingFields, evidenceConfidence),
  };
}
