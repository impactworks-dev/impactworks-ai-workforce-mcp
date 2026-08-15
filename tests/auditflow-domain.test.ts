import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuditEvent,
  createAuditRecord,
  createWorkflowRecord,
  evaluateWorkflowCompleteness,
  type AppendAuditEventInput,
  type AuditEventRepository,
  type AuditFlowEvent,
  type AuditRecord,
  type AuditRepository,
  type TenantScope,
  type UpsertWorkflowRecordInput,
  type WorkflowProfile,
  type WorkflowRecord,
  type WorkflowRepository,
} from "../packages/auditflow-contracts/src/index.ts";

const scope: TenantScope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};
const now = "2026-08-15T18:55:00.000Z";

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
    this.records.set(`${record.tenantId}:${record.auditId}`, record);
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
    const current = await this.getAudit(scope, auditId);
    if (!current) throw new Error("not found");
    const updated = { ...current, status, updatedAt: now };
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

  async getWorkflow(scope: TenantScope, auditId: WorkflowRecord["auditId"], workflowId: WorkflowRecord["workflowId"]) {
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

  async listEvents(scope: TenantScope, auditId: AuditFlowEvent["auditId"]) {
    return this.events.filter((event) => event.tenantId === scope.tenantId && event.auditId === auditId);
  }
}

test("audit records derive tenant and actor from trusted scope", () => {
  const record = createAuditRecord(scope, {
    auditId: "aud_01JZ6K8M",
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
    now,
  });

  assert.equal(record.tenantId, "ten_impactworks");
  assert.equal(record.createdByUserId, "usr_dante");
  assert.equal(record.defaultLoadedHourlyRateUsd, 45);
  assert.equal(record.source, "self_serve");
  assert.equal(record.status, "intake");
});

test("workflow records persist completeness alongside tenant scope", () => {
  const completeness = evaluateWorkflowCompleteness(workflow);
  const record = createWorkflowRecord(scope, {
    auditId: "aud_01JZ6K8M",
    workflowId: "wf_leadfollowup",
    workflow,
    completeness,
    now,
  });

  assert.equal(record.tenantId, "ten_impactworks");
  assert.equal(record.completeness.scoreable, true);
  assert.equal(record.createdAt, now);
  assert.equal(record.updatedAt, now);
});

test("audit events are scope-stamped and reject malformed identifiers", () => {
  const event = createAuditEvent(scope, {
    eventId: "evt_01JZ6K8M",
    auditId: "aud_01JZ6K8M",
    type: "workflow.completeness_evaluated",
    occurredAt: now,
    payload: {
      workflowId: "wf_leadfollowup",
      scoreable: true,
    },
  });

  assert.equal(event.tenantId, "ten_impactworks");
  assert.equal(event.actorUserId, "usr_dante");
  assert.equal(event.payload.workflowId, "wf_leadfollowup");

  assert.throws(
    () =>
      createAuditEvent(
        { tenantId: "tenant_bad", actorUserId: "usr_dante" },
        {
          eventId: "evt_01JZ6K8M",
          auditId: "aud_01JZ6K8M",
          type: "workflow.upserted",
          occurredAt: now,
          payload: {},
        },
      ),
    /tenantId must start with ten_/,
  );
});

test("repository interfaces keep cross-tenant reads isolated", async () => {
  const audits = new InMemoryAuditRepository();
  const workflows = new InMemoryWorkflowRepository();
  const events = new InMemoryAuditEventRepository();
  const otherScope: TenantScope = {
    tenantId: "ten_other",
    actorUserId: "usr_other",
  };

  await audits.createAudit(scope, {
    auditId: "aud_01JZ6K8M",
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
    now,
  });
  await workflows.upsertWorkflow(scope, {
    auditId: "aud_01JZ6K8M",
    workflowId: "wf_leadfollowup",
    workflow,
    completeness: evaluateWorkflowCompleteness(workflow),
    now,
  });
  await events.appendEvent(scope, {
    eventId: "evt_01JZ6K8M",
    auditId: "aud_01JZ6K8M",
    type: "workflow.upserted",
    occurredAt: now,
    payload: { workflowId: "wf_leadfollowup" },
  });

  assert.equal(await audits.getAudit(otherScope, "aud_01JZ6K8M"), null);
  assert.equal(await workflows.getWorkflow(otherScope, "aud_01JZ6K8M", "wf_leadfollowup"), null);
  assert.deepEqual(await events.listEvents(otherScope, "aud_01JZ6K8M"), []);
  assert.equal((await workflows.listWorkflows(scope, { auditId: "aud_01JZ6K8M" })).length, 1);
  assert.equal((await events.listEvents(scope, "aud_01JZ6K8M")).length, 1);
});
