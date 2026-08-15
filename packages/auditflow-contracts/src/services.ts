import {
  createAuditEvent,
  evaluateWorkflowCompleteness,
  type AuditFlowErrorCode,
  type AuditFlowRepositories,
  type AuditId,
  type CreateAuditInput,
  type EventId,
  type TenantScope,
  type UpsertWorkflowInput,
  type WorkflowId,
} from "./index.ts";

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
