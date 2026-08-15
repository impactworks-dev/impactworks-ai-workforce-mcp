import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditFlowServiceError,
  createAuditEvent,
  createAuditRecord,
  createAuditService,
  createWorkflowRecord,
  upsertWorkflowService,
  type AppendAuditEventInput,
  type AuditEventRepository,
  type AuditFlowEvent,
  type AuditFlowRepositories,
  type AuditRecord,
  type AuditRepository,
  type EventId,
  type TenantScope,
  type UpsertWorkflowRecordInput,
  type WorkflowId,
  type WorkflowProfile,
  type WorkflowRecord,
  type WorkflowRepository,
} from "../packages/auditflow-contracts/src/index.ts";

const scope: TenantScope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};
const now = "2026-08-15T19:30:00.000Z";

const workflow: WorkflowProfile = {
  name: "Lead intake and follow-up",
  department: "Sales",
  trigger: "A new prospect submits a website form.",
  desired_outcome: "Qualified lead is contacted quickly and next step is scheduled.",
  steps: [
    {
      sequence: 1,
      action: "Review the inbound lead details",
      owner_role: "Owner",
      system: "Website",
      minutes: 5,
      manual: true,
    },
  ],
  monthly_volume: 45,
  minutes_per_run: 20,
  loaded_hourly_rate_usd: 75,
  systems: ["Website", "ClickUp", "Email"],
  pain_points: ["Follow-up timing is inconsistent"],
  data_sensitivity: "confidential",
  evidence_quality: "owner_estimate",
};

class InMemoryAuditRepository implements AuditRepository {
  readonly records = new Map<string, AuditRecord>();

  async createAudit(scope: TenantScope, input: Parameters<AuditRepository["createAudit"]>[1]) {
    const record = createAuditRecord(scope, input);
    this.records.set(`${scope.tenantId}:${record.auditId}`, record);
    return record;
  }

  async getAudit(scope: TenantScope, auditId: AuditRecord["auditId"]) {
    return this.records.get(`${scope.tenantId}:${auditId}`) ?? null;
  }

  async updateAuditStatus(
    scope: TenantScope,
    auditId: AuditRecord["auditId"],
    status: AuditRecord["status"],
    now: string,
  ) {
    const record = await this.getAudit(scope, auditId);
    if (!record) throw new Error("not found");
    const updated = { ...record, status, updatedAt: now };
    this.records.set(`${scope.tenantId}:${auditId}`, updated);
    return updated;
  }
}

class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly records = new Map<string, WorkflowRecord>();

  async upsertWorkflow(scope: TenantScope, input: UpsertWorkflowRecordInput) {
    const existing = this.records.get(`${scope.tenantId}:${input.auditId}:${input.workflowId}`);
    const record = createWorkflowRecord(scope, input);
    const saved = existing ? { ...record, createdAt: existing.createdAt } : record;
    this.records.set(`${scope.tenantId}:${input.auditId}:${input.workflowId}`, saved);
    return saved;
  }

  async getWorkflow(scope: TenantScope, auditId: AuditRecord["auditId"], workflowId: WorkflowId) {
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

class InMemoryAuditEventRepository implements AuditEventRepository {
  readonly events: AuditFlowEvent[] = [];

  async appendEvent<TPayload extends Record<string, unknown>>(
    scope: TenantScope,
    input: AppendAuditEventInput<TPayload>,
  ) {
    const event = createAuditEvent(scope, input);
    this.events.push(event);
    return event;
  }

  async listEvents(scope: TenantScope, auditId: AuditRecord["auditId"]) {
    return this.events.filter((event) => event.tenantId === scope.tenantId && event.auditId === auditId);
  }
}

function buildDeps(): AuditFlowRepositories & { events: InMemoryAuditEventRepository; audits: InMemoryAuditRepository; workflows: InMemoryWorkflowRepository } {
  return {
    audits: new InMemoryAuditRepository(),
    workflows: new InMemoryWorkflowRepository(),
    events: new InMemoryAuditEventRepository(),
  };
}

function buildServiceDeps(repositories = buildDeps()) {
  let eventCounter = 0;
  return {
    repositories,
    clock: {
      now: () => now,
    },
    ids: {
      auditId: () => "aud_01JZ6K8M" as const,
      workflowId: () => "wf_leadfollowup" as const,
      eventId: () => `evt_${++eventCounter}` as EventId,
    },
  };
}

test("createAuditService persists tenant-scoped audits and records an audit.created event", async () => {
  const repositories = buildDeps();
  const result = await createAuditService(buildServiceDeps(repositories), scope, {
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
    source: "consultant_led",
  });

  assert.deepEqual(result, {
    audit_id: "aud_01JZ6K8M",
    status: "intake",
    missing_fields: [
      "business.annual_revenue_usd",
      "constraints.budget_range_usd",
      "constraints.target_timeline_days",
    ],
    next_action: "Record the first high-friction workflow while marking missing business assumptions.",
  });
  assert.equal((await repositories.audits.getAudit(scope, "aud_01JZ6K8M"))?.source, "consultant_led");
  assert.equal(repositories.events.events[0].type, "audit.created");
  assert.equal(repositories.events.events[0].tenantId, "ten_impactworks");
});

test("upsertWorkflowService evaluates completeness, persists workflow, updates audit status, and logs events", async () => {
  const repositories = buildDeps();
  const deps = buildServiceDeps(repositories);
  await createAuditService(deps, scope, {
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
  });

  const result = await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow,
  });

  assert.equal(result.audit_id, "aud_01JZ6K8M");
  assert.equal(result.workflow_id, "wf_leadfollowup");
  assert.equal(result.completeness_percent, 100);
  assert.equal(result.next_action, "Workflow is ready for opportunity scoring.");
  assert.equal((await repositories.audits.getAudit(scope, "aud_01JZ6K8M"))?.status, "ready_to_score");
  assert.equal((await repositories.workflows.getWorkflow(scope, "aud_01JZ6K8M", "wf_leadfollowup"))?.completeness.scoreable, true);
  assert.deepEqual(
    repositories.events.events.map((event) => event.type),
    ["audit.created", "workflow.upserted", "workflow.completeness_evaluated"],
  );
});

test("upsertWorkflowService keeps unscoreable workflows in capture status", async () => {
  const repositories = buildDeps();
  const deps = buildServiceDeps(repositories);
  await createAuditService(deps, scope, {
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
  });

  const result = await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow: {
      ...workflow,
      monthly_volume: 0,
      minutes_per_run: 0,
      evidence_quality: "unknown",
    },
  });

  assert.equal(result.completeness_percent, 65);
  assert.equal((await repositories.audits.getAudit(scope, "aud_01JZ6K8M"))?.status, "workflow_capture");
  assert.match(result.next_action, /Collect required workflow evidence/);
});

test("upsertWorkflowService fails closed when audit is outside the current tenant scope", async () => {
  const repositories = buildDeps();
  const deps = buildServiceDeps(repositories);
  await createAuditService(deps, scope, {
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
  });

  await assert.rejects(
    () =>
      upsertWorkflowService(
        deps,
        { tenantId: "ten_other", actorUserId: "usr_other" },
        {
          audit_id: "aud_01JZ6K8M",
          workflow,
        },
      ),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "AUDIT_NOT_FOUND");
      assert.deepEqual(error.toPayload(), {
        error: {
          code: "AUDIT_NOT_FOUND",
          message: "Audit was not found for the current tenant.",
          retryable: false,
          missing: ["audit_id"],
        },
      });
      return true;
    },
  );
});
