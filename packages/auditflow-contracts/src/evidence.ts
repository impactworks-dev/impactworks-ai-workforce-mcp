import type {
  AuditFlowEvent,
  AuditFlowEventType,
  AuditId,
  WorkflowId,
} from "./domain.ts";

export const AUDITFLOW_EVIDENCE_PROJECTION_VERSION = "auditflow-evidence-projection-1.0.0";

export type AuditEvidenceSeverity = "info" | "warning" | "blocked";

export interface AuditEvidenceTimelineItem {
  event_id: string;
  type: AuditFlowEventType;
  occurred_at: string;
  actor_user_id: string;
  summary: string;
  severity: AuditEvidenceSeverity;
}

export interface WorkflowEvidenceProjection {
  workflow_id: WorkflowId;
  workflow_name?: string;
  completeness_percent?: number;
  evidence_confidence?: string;
  scoreable?: boolean;
  missing_fields: string[];
  warnings: string[];
}

export interface AuditEvidenceProjection {
  audit_id: AuditId;
  projection_version: typeof AUDITFLOW_EVIDENCE_PROJECTION_VERSION;
  generated_from_event_count: number;
  last_event_at: string | null;
  lifecycle: {
    audit_created: boolean;
    workflows_captured: number;
    score_runs: number;
    roi_runs: number;
    solution_stack_runs: number;
    roadmap_runs: number;
    approval_required: number;
    approval_recorded: number;
    errors_recorded: number;
  };
  calculation_versions: {
    scoring_versions: string[];
    roi_versions: string[];
  };
  workflow_evidence: WorkflowEvidenceProjection[];
  timeline: AuditEvidenceTimelineItem[];
  governance: {
    has_required_approval_open: boolean;
    has_recorded_errors: boolean;
    blocked_reasons: string[];
  };
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function payloadStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function eventSeverity(event: AuditFlowEvent): AuditEvidenceSeverity {
  if (event.type === "error.recorded") return "blocked";
  if (event.type === "approval.required") return "warning";
  if (
    event.type === "workflow.completeness_evaluated" &&
    payloadBoolean(event.payload, "scoreable") === false
  ) {
    return "warning";
  }
  return "info";
}

function summarizeEvent(event: AuditFlowEvent): string {
  switch (event.type) {
    case "audit.created":
      return "Audit created";
    case "workflow.upserted":
      return `Workflow captured: ${payloadString(event.payload, "workflowName") ?? payloadString(event.payload, "workflowId") ?? "unknown workflow"}`;
    case "workflow.completeness_evaluated": {
      const workflowId = payloadString(event.payload, "workflowId") ?? "unknown workflow";
      const completeness = payloadNumber(event.payload, "completenessPercent");
      return completeness === undefined
        ? `Workflow evidence evaluated: ${workflowId}`
        : `Workflow evidence evaluated: ${workflowId} at ${completeness}% complete`;
    }
    case "opportunities.scored":
      return `Opportunities scored with ${payloadString(event.payload, "scoringVersion") ?? "unknown scoring version"}`;
    case "roi.estimated":
      return `ROI estimated with ${payloadString(event.payload, "roiVersion") ?? "unknown ROI version"}`;
    case "solution_stack.recommended":
      return "Solution stack recommended";
    case "roadmap.generated":
      return `Roadmap generated: ${payloadString(event.payload, "roadmapId") ?? "unknown roadmap"}`;
    case "report.generated":
      return "Report generated";
    case "approval.required":
      return "Approval required";
    case "approval.recorded":
      return "Approval recorded";
    case "error.recorded":
      return "Error recorded";
  }
}

function updateWorkflowEvidence(
  workflows: Map<string, WorkflowEvidenceProjection>,
  event: AuditFlowEvent,
): void {
  const workflowId = payloadString(event.payload, "workflowId") as WorkflowId | undefined;
  if (!workflowId) return;
  const existing = workflows.get(workflowId) ?? {
    workflow_id: workflowId,
    missing_fields: [],
    warnings: [],
  };

  if (event.type === "workflow.upserted") {
    existing.workflow_name = payloadString(event.payload, "workflowName") ?? existing.workflow_name;
  }

  if (event.type === "workflow.completeness_evaluated") {
    existing.completeness_percent =
      payloadNumber(event.payload, "completenessPercent") ?? existing.completeness_percent;
    existing.evidence_confidence =
      payloadString(event.payload, "evidenceConfidence") ?? existing.evidence_confidence;
    existing.scoreable = payloadBoolean(event.payload, "scoreable") ?? existing.scoreable;
    existing.missing_fields = uniqueSorted([
      ...existing.missing_fields,
      ...payloadStringArray(event.payload, "missingFields"),
    ]);
    existing.warnings = uniqueSorted([
      ...existing.warnings,
      ...payloadStringArray(event.payload, "warnings"),
    ]);
  }

  workflows.set(workflowId, existing);
}

export function projectAuditEvidence(events: AuditFlowEvent[]): AuditEvidenceProjection {
  if (events.length === 0) {
    throw new Error("Audit evidence projection requires at least one audit event.");
  }

  const sortedEvents = [...events].sort((a, b) => {
    const timeCompare = a.occurredAt.localeCompare(b.occurredAt);
    return timeCompare === 0 ? a.eventId.localeCompare(b.eventId) : timeCompare;
  });
  const auditId = sortedEvents[0].auditId;
  const workflows = new Map<string, WorkflowEvidenceProjection>();
  const scoringVersions: string[] = [];
  const roiVersions: string[] = [];
  const blockedReasons: string[] = [];
  let approvalRequired = 0;
  let approvalRecorded = 0;
  let errorsRecorded = 0;

  for (const event of sortedEvents) {
    if (event.auditId !== auditId) {
      throw new Error("Audit evidence projection cannot mix events from multiple audits.");
    }

    updateWorkflowEvidence(workflows, event);

    if (event.type === "opportunities.scored") {
      const version = payloadString(event.payload, "scoringVersion");
      if (version) scoringVersions.push(version);
    }
    if (event.type === "roi.estimated") {
      const version = payloadString(event.payload, "roiVersion");
      if (version) roiVersions.push(version);
    }
    if (event.type === "approval.required") {
      approvalRequired += 1;
      blockedReasons.push(payloadString(event.payload, "reason") ?? "Approval is required.");
    }
    if (event.type === "approval.recorded") {
      approvalRecorded += 1;
    }
    if (event.type === "error.recorded") {
      errorsRecorded += 1;
      blockedReasons.push(payloadString(event.payload, "message") ?? "An error was recorded.");
    }
  }

  return {
    audit_id: auditId,
    projection_version: AUDITFLOW_EVIDENCE_PROJECTION_VERSION,
    generated_from_event_count: sortedEvents.length,
    last_event_at: sortedEvents.at(-1)?.occurredAt ?? null,
    lifecycle: {
      audit_created: sortedEvents.some((event) => event.type === "audit.created"),
      workflows_captured: workflows.size,
      score_runs: sortedEvents.filter((event) => event.type === "opportunities.scored").length,
      roi_runs: sortedEvents.filter((event) => event.type === "roi.estimated").length,
      solution_stack_runs: sortedEvents.filter((event) => event.type === "solution_stack.recommended").length,
      roadmap_runs: sortedEvents.filter((event) => event.type === "roadmap.generated").length,
      approval_required: approvalRequired,
      approval_recorded: approvalRecorded,
      errors_recorded: errorsRecorded,
    },
    calculation_versions: {
      scoring_versions: uniqueSorted(scoringVersions),
      roi_versions: uniqueSorted(roiVersions),
    },
    workflow_evidence: [...workflows.values()].sort((a, b) =>
      a.workflow_id.localeCompare(b.workflow_id),
    ),
    timeline: sortedEvents.map((event) => ({
      event_id: event.eventId,
      type: event.type,
      occurred_at: event.occurredAt,
      actor_user_id: event.actorUserId,
      summary: summarizeEvent(event),
      severity: eventSeverity(event),
    })),
    governance: {
      has_required_approval_open: approvalRequired > approvalRecorded,
      has_recorded_errors: errorsRecorded > 0,
      blocked_reasons: uniqueSorted(blockedReasons),
    },
  };
}
