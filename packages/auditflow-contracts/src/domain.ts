import type {
  AuditBusinessProfile,
  AuditConstraints,
  AuditId,
  AuditSource,
  WorkflowId,
  WorkflowProfile,
} from "./index.ts";
import type { WorkflowCompletenessResult } from "./completeness.ts";

export type TenantId = `ten_${string}`;
export type UserId = `usr_${string}`;
export type EventId = `evt_${string}`;

export type AuditStatus =
  | "intake"
  | "workflow_capture"
  | "ready_to_score"
  | "scored"
  | "roadmap_ready"
  | "report_ready"
  | "archived";

export type AuditFlowEventType =
  | "audit.created"
  | "workflow.upserted"
  | "workflow.completeness_evaluated"
  | "opportunities.scored"
  | "roi.estimated"
  | "solution_stack.recommended"
  | "roadmap.generated"
  | "report.generated"
  | "approval.required"
  | "approval.recorded"
  | "error.recorded";

export interface TenantScope {
  tenantId: TenantId;
  actorUserId: UserId;
}

export interface AuditRecord {
  auditId: AuditId;
  tenantId: TenantId;
  createdByUserId: UserId;
  status: AuditStatus;
  business: AuditBusinessProfile;
  constraints?: AuditConstraints;
  defaultLoadedHourlyRateUsd: number;
  source: AuditSource;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRecord {
  auditId: AuditId;
  workflowId: WorkflowId;
  tenantId: TenantId;
  workflow: WorkflowProfile;
  completeness: WorkflowCompletenessResult;
  createdAt: string;
  updatedAt: string;
}

export interface AuditFlowEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: EventId;
  tenantId: TenantId;
  auditId: AuditId;
  actorUserId: UserId;
  type: AuditFlowEventType;
  occurredAt: string;
  payload: TPayload;
}

export interface CreateAuditRecordInput {
  auditId: AuditId;
  business: AuditBusinessProfile;
  constraints?: AuditConstraints;
  defaultLoadedHourlyRateUsd?: number;
  source?: AuditSource;
  now: string;
}

export interface UpsertWorkflowRecordInput {
  auditId: AuditId;
  workflowId: WorkflowId;
  workflow: WorkflowProfile;
  completeness: WorkflowCompletenessResult;
  now: string;
}

export interface ListWorkflowsQuery {
  auditId: AuditId;
  workflowIds?: WorkflowId[];
}

export interface AppendAuditEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: EventId;
  auditId: AuditId;
  type: AuditFlowEventType;
  occurredAt: string;
  payload: TPayload;
}

export interface AuditRepository {
  createAudit(scope: TenantScope, input: CreateAuditRecordInput): Promise<AuditRecord>;
  getAudit(scope: TenantScope, auditId: AuditId): Promise<AuditRecord | null>;
  updateAuditStatus(scope: TenantScope, auditId: AuditId, status: AuditStatus, now: string): Promise<AuditRecord>;
}

export interface WorkflowRepository {
  upsertWorkflow(scope: TenantScope, input: UpsertWorkflowRecordInput): Promise<WorkflowRecord>;
  getWorkflow(scope: TenantScope, auditId: AuditId, workflowId: WorkflowId): Promise<WorkflowRecord | null>;
  listWorkflows(scope: TenantScope, query: ListWorkflowsQuery): Promise<WorkflowRecord[]>;
}

export interface AuditEventRepository {
  appendEvent<TPayload extends Record<string, unknown>>(
    scope: TenantScope,
    input: AppendAuditEventInput<TPayload>,
  ): Promise<AuditFlowEvent<TPayload>>;
  listEvents(scope: TenantScope, auditId: AuditId): Promise<AuditFlowEvent[]>;
}

export interface AuditFlowRepositories {
  audits: AuditRepository;
  workflows: WorkflowRepository;
  events: AuditEventRepository;
}

function assertPrefix(name: string, value: string, prefix: string): void {
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    throw new RangeError(`${name} must start with ${prefix} and include an opaque identifier`);
  }
}

function assertIsoDateTime(name: string, value: string): void {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new RangeError(`${name} must be an ISO 8601 UTC timestamp`);
  }
}

export function assertTenantScope(scope: TenantScope): void {
  assertPrefix("tenantId", scope.tenantId, "ten_");
  assertPrefix("actorUserId", scope.actorUserId, "usr_");
}

export function assertAuditEvent(event: AuditFlowEvent): void {
  assertTenantScope({
    tenantId: event.tenantId,
    actorUserId: event.actorUserId,
  });
  assertPrefix("eventId", event.eventId, "evt_");
  assertPrefix("auditId", event.auditId, "aud_");
  assertIsoDateTime("occurredAt", event.occurredAt);
}

export function createAuditRecord(scope: TenantScope, input: CreateAuditRecordInput): AuditRecord {
  assertTenantScope(scope);
  assertPrefix("auditId", input.auditId, "aud_");
  assertIsoDateTime("now", input.now);

  return {
    auditId: input.auditId,
    tenantId: scope.tenantId,
    createdByUserId: scope.actorUserId,
    status: "intake",
    business: input.business,
    constraints: input.constraints,
    defaultLoadedHourlyRateUsd: input.defaultLoadedHourlyRateUsd ?? 45,
    source: input.source ?? "self_serve",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createWorkflowRecord(scope: TenantScope, input: UpsertWorkflowRecordInput): WorkflowRecord {
  assertTenantScope(scope);
  assertPrefix("auditId", input.auditId, "aud_");
  assertPrefix("workflowId", input.workflowId, "wf_");
  assertIsoDateTime("now", input.now);

  return {
    auditId: input.auditId,
    workflowId: input.workflowId,
    tenantId: scope.tenantId,
    workflow: input.workflow,
    completeness: input.completeness,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createAuditEvent<TPayload extends Record<string, unknown>>(
  scope: TenantScope,
  input: AppendAuditEventInput<TPayload>,
): AuditFlowEvent<TPayload> {
  assertTenantScope(scope);
  const event: AuditFlowEvent<TPayload> = {
    eventId: input.eventId,
    tenantId: scope.tenantId,
    auditId: input.auditId,
    actorUserId: scope.actorUserId,
    type: input.type,
    occurredAt: input.occurredAt,
    payload: input.payload,
  };
  assertAuditEvent(event);
  return event;
}
