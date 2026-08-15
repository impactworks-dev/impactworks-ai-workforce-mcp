import {
  createAuditEvent,
  createAuditRecord,
  createWorkflowRecord,
  type AppendAuditEventInput,
  type AuditEventRepository,
  type AuditFlowEvent,
  type AuditFlowRepositories,
  type AuditFlowServiceDependencies,
  type AuditId,
  type AuditRecord,
  type AuditRepository,
  type AuditStatus,
  type EventId,
  type RoadmapId,
  type TenantScope,
  type UpsertWorkflowRecordInput,
  type WorkflowId,
  type WorkflowRecord,
  type WorkflowRepository,
} from "../../auditflow-contracts/src/index.ts";

export class InMemoryAuditRepository implements AuditRepository {
  readonly records = new Map<string, AuditRecord>();

  async createAudit(scope: TenantScope, input: Parameters<AuditRepository["createAudit"]>[1]) {
    const record = createAuditRecord(scope, input);
    this.records.set(`${scope.tenantId}:${record.auditId}`, record);
    return record;
  }

  async getAudit(scope: TenantScope, auditId: AuditId) {
    return this.records.get(`${scope.tenantId}:${auditId}`) ?? null;
  }

  async updateAuditStatus(scope: TenantScope, auditId: AuditId, status: AuditStatus, now: string) {
    const record = await this.getAudit(scope, auditId);
    if (!record) throw new Error("Audit not found");
    const updated = { ...record, status, updatedAt: now };
    this.records.set(`${scope.tenantId}:${auditId}`, updated);
    return updated;
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly records = new Map<string, WorkflowRecord>();

  async upsertWorkflow(scope: TenantScope, input: UpsertWorkflowRecordInput) {
    const existing = this.records.get(`${scope.tenantId}:${input.auditId}:${input.workflowId}`);
    const record = createWorkflowRecord(scope, input);
    const saved = existing ? { ...record, createdAt: existing.createdAt } : record;
    this.records.set(`${scope.tenantId}:${input.auditId}:${input.workflowId}`, saved);
    return saved;
  }

  async getWorkflow(scope: TenantScope, auditId: AuditId, workflowId: WorkflowId) {
    return this.records.get(`${scope.tenantId}:${auditId}:${workflowId}`) ?? null;
  }

  async listWorkflows(scope: TenantScope, query: Parameters<WorkflowRepository["listWorkflows"]>[1]) {
    const selectedIds = query.workflowIds ? new Set(query.workflowIds) : null;
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === scope.tenantId &&
        record.auditId === query.auditId &&
        (!selectedIds || selectedIds.has(record.workflowId)),
    );
  }
}

export class InMemoryAuditEventRepository implements AuditEventRepository {
  readonly events: AuditFlowEvent[] = [];

  async appendEvent<TPayload extends Record<string, unknown>>(
    scope: TenantScope,
    input: AppendAuditEventInput<TPayload>,
  ) {
    const event = createAuditEvent(scope, input);
    this.events.push(event);
    return event;
  }

  async listEvents(scope: TenantScope, auditId: AuditId) {
    return this.events.filter((event) => event.tenantId === scope.tenantId && event.auditId === auditId);
  }
}

export interface InMemoryAuditFlowRuntimeOptions {
  now?: string;
  idPrefix?: string;
}

export interface InMemoryAuditFlowRuntime {
  deps: AuditFlowServiceDependencies;
  repositories: AuditFlowRepositories & {
    audits: InMemoryAuditRepository;
    workflows: InMemoryWorkflowRepository;
    events: InMemoryAuditEventRepository;
  };
}

function nextOpaqueId(prefix: string, counter: number, idPrefix: string): string {
  return `${prefix}${idPrefix}${counter.toString().padStart(4, "0")}`;
}

export function createInMemoryAuditFlowRuntime(
  options: InMemoryAuditFlowRuntimeOptions = {},
): InMemoryAuditFlowRuntime {
  const repositories = {
    audits: new InMemoryAuditRepository(),
    workflows: new InMemoryWorkflowRepository(),
    events: new InMemoryAuditEventRepository(),
  };
  const now = options.now ?? new Date().toISOString();
  const idPrefix = options.idPrefix ?? "";
  let auditCounter = 0;
  let workflowCounter = 0;
  let roadmapCounter = 0;
  let eventCounter = 0;

  return {
    repositories,
    deps: {
      repositories,
      clock: {
        now: () => now,
      },
      ids: {
        auditId: () => nextOpaqueId("aud_", ++auditCounter, idPrefix) as AuditId,
        workflowId: () => nextOpaqueId("wf_", ++workflowCounter, idPrefix) as WorkflowId,
        roadmapId: () => nextOpaqueId("rm_", ++roadmapCounter, idPrefix) as RoadmapId,
        eventId: () => nextOpaqueId("evt_", ++eventCounter, idPrefix) as EventId,
      },
    },
  };
}
