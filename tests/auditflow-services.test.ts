import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditFlowServiceError,
  createAuditEvent,
  createAuditRecord,
  createAuditService,
  createWorkflowRecord,
  estimateRoiService,
  generateRoadmapService,
  mapWorkflowToOpportunityScoreInput,
  scoreOpportunitiesService,
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
import { scoreOpportunity } from "../packages/scoring-engine/src/opportunity-score.ts";

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
      roadmapId: () => "rm_01JZ74TP" as const,
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

async function createAuditWithScoreableWorkflows() {
  const repositories = buildDeps();
  const deps = buildServiceDeps(repositories);
  await createAuditService(deps, scope, {
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      primary_goal: "increase_capacity",
      annual_revenue_usd: 500_000,
    },
    constraints: {
      budget_range_usd: { min: 5_000, max: 25_000 },
      target_timeline_days: 45,
    },
  });

  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_leadfollowup",
    workflow,
  });
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_proposal",
    workflow: {
      ...workflow,
      name: "Proposal assembly",
      department: "Sales",
      trigger: "A qualified prospect requests a proposal.",
      desired_outcome: "Approval-ready proposal is prepared with the right scope and follow-up.",
      monthly_volume: 18,
      minutes_per_run: 75,
      systems: ["ClickUp", "Google Drive", "PandaDoc"],
      pain_points: ["Proposal details are scattered", "Follow-up timing varies"],
      annual_revenue_at_risk_usd: 60_000,
      evidence_quality: "measured",
    },
  });
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_weeklyreporting",
    workflow: {
      ...workflow,
      name: "Weekly operating report",
      department: "Operations",
      trigger: "Friday operating review is due.",
      desired_outcome: "Current project health is summarized with blockers and next actions.",
      monthly_volume: 4,
      minutes_per_run: 120,
      systems: ["ClickUp", "Google Sheets"],
      pain_points: ["Status must be assembled manually"],
      evidence_quality: "team_estimate",
      data_sensitivity: "internal",
      exception_rate_percent: 5,
    },
  });

  return { deps, repositories };
}

test("mapWorkflowToOpportunityScoreInput produces deterministic normalized scoring inputs", () => {
  const input = mapWorkflowToOpportunityScoreInput(workflow);
  const result = scoreOpportunity(input);

  assert.deepEqual(input.impact, {
    laborValue: 30,
    volume: 18,
    errorCost: 0,
    customerImpact: 45,
    revenueImpact: 0,
  });
  assert.equal(input.risk, 29.75);
  assert.equal(result.scoringVersion, "iwaf-1.0.0");
  assert.equal(result.priorityScore, 45.43);
});

test("scoreOpportunitiesService scores at least three workflows, sorts priorities, updates status, and logs event", async () => {
  const { deps, repositories } = await createAuditWithScoreableWorkflows();

  const result = await scoreOpportunitiesService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
  });

  assert.equal(result.audit_id, "aud_01JZ6K8M");
  assert.equal(result.scoring_version, "iwaf-1.0.0");
  assert.equal(result.opportunities.length, 3);
  assert.deepEqual(
    result.opportunities.map((opportunity) => opportunity.workflow_id),
    ["wf_proposal", "wf_leadfollowup", "wf_weeklyreporting"],
  );
  assert.equal(result.opportunities[0].automation_pattern, "workflow_orchestration");
  assert.ok(result.opportunities[0].priority_score >= result.opportunities[1].priority_score);
  assert.ok(result.opportunities[0].reasons.some((reason) => reason.includes("monthly runs")));
  assert.equal((await repositories.audits.getAudit(scope, "aud_01JZ6K8M"))?.status, "scored");
  assert.equal(repositories.events.events.at(-1)?.type, "opportunities.scored");
  assert.deepEqual(repositories.events.events.at(-1)?.payload, {
    scoringVersion: "iwaf-1.0.0",
    workflowIds: ["wf_proposal", "wf_leadfollowup", "wf_weeklyreporting"],
    forceRecalculate: false,
  });
});

test("scoreOpportunitiesService can score an explicit scoreable workflow set", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  const result = await scoreOpportunitiesService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_weeklyreporting", "wf_leadfollowup", "wf_proposal"],
    force_recalculate: true,
  });

  assert.equal(result.opportunities.length, 3);
  assert.deepEqual(
    result.opportunities.map((opportunity) => opportunity.workflow_id).sort(),
    ["wf_leadfollowup", "wf_proposal", "wf_weeklyreporting"],
  );
});

test("scoreOpportunitiesService requires three scoreable workflows", async () => {
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
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_leadfollowup",
    workflow,
  });

  await assert.rejects(
    () => scoreOpportunitiesService(deps, scope, { audit_id: "aud_01JZ6K8M" }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "INSUFFICIENT_WORKFLOWS");
      assert.deepEqual(error.missing, ["workflows:minimum_3_scoreable"]);
      return true;
    },
  );
});

test("scoreOpportunitiesService rejects selected workflows with insufficient evidence", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_unready",
    workflow: {
      ...workflow,
      name: "Unready workflow",
      monthly_volume: 0,
      minutes_per_run: 0,
      evidence_quality: "unknown",
    },
  });

  await assert.rejects(
    () =>
      scoreOpportunitiesService(deps, scope, {
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_leadfollowup", "wf_proposal", "wf_unready"],
      }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "INSUFFICIENT_EVIDENCE");
      assert.ok(error.missing.includes("workflow.monthly_volume"));
      assert.ok(error.missing.includes("workflow.minutes_per_run"));
      return true;
    },
  );
});

test("scoreOpportunitiesService fails closed across tenant boundaries", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  await assert.rejects(
    () =>
      scoreOpportunitiesService(
        deps,
        { tenantId: "ten_other", actorUserId: "usr_other" },
        { audit_id: "aud_01JZ6K8M" },
      ),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "AUDIT_NOT_FOUND");
      return true;
    },
  );
});

test("estimateRoiService aggregates selected workflows into low, expected, and high planning scenarios", async () => {
  const { deps, repositories } = await createAuditWithScoreableWorkflows();

  const result = await estimateRoiService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_leadfollowup", "wf_proposal", "wf_weeklyreporting"],
    implementation_cost_usd: 12_000,
    annual_software_cost_usd: 3_000,
    automation_coverage_percent: 65,
    adoption_rate_percent: 80,
    include_revenue_uplift: false,
  });

  assert.equal(result.audit_id, "aud_01JZ6K8M");
  assert.equal(result.currency, "USD");
  assert.equal(result.roi_version, "iwaf-roi-1.0.0");
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.name),
    ["low", "expected", "high"],
  );
  assert.equal(result.scenarios[1].annual_hours_recovered, 283.92);
  assert.equal(result.scenarios[1].annual_revenue_uplift_usd, 0);
  assert.equal(result.scenarios[1].first_year_roi_percent, 52.45);
  assert.equal(result.confidence, "medium");
  assert.ok(result.assumptions.includes("Selected workflows: 3"));
  assert.ok(result.assumptions.includes("Expected automation coverage: 65%"));
  assert.ok(result.excluded_benefits.includes("Revenue uplift from faster or more consistent execution"));
  assert.equal(result.disclaimer, "These are planning estimates based on supplied assumptions, not guaranteed financial results.");
  assert.equal(repositories.events.events.at(-1)?.type, "roi.estimated");
});

test("estimateRoiService can include revenue uplift when explicitly requested", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  const result = await estimateRoiService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_proposal"],
    implementation_cost_usd: 12_000,
    annual_software_cost_usd: 3_000,
    include_revenue_uplift: true,
  });

  assert.equal(result.scenarios[1].annual_revenue_uplift_usd, 60_000);
  assert.equal(result.confidence, "high");
  assert.ok(!result.excluded_benefits.includes("Revenue uplift from faster or more consistent execution"));
});

test("estimateRoiService rejects missing workflows", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  await assert.rejects(
    () =>
      estimateRoiService(deps, scope, {
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_leadfollowup", "wf_missing"],
      }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "WORKFLOW_NOT_FOUND");
      assert.deepEqual(error.missing, ["wf_missing"]);
      return true;
    },
  );
});

test("estimateRoiService rejects selected workflows with insufficient evidence", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_unready",
    workflow: {
      ...workflow,
      name: "Unready workflow",
      monthly_volume: 0,
      minutes_per_run: 0,
      evidence_quality: "unknown",
    },
  });

  await assert.rejects(
    () =>
      estimateRoiService(deps, scope, {
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_unready"],
      }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "INSUFFICIENT_EVIDENCE");
      assert.ok(error.missing.includes("workflow.evidence_quality"));
      return true;
    },
  );
});

test("estimateRoiService fails closed across tenant boundaries", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  await assert.rejects(
    () =>
      estimateRoiService(
        deps,
        { tenantId: "ten_other", actorUserId: "usr_other" },
        {
          audit_id: "aud_01JZ6K8M",
          workflow_ids: ["wf_leadfollowup"],
        },
      ),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "AUDIT_NOT_FOUND");
      return true;
    },
  );
});

test("generateRoadmapService creates a sequenced 30/60/90 roadmap and logs governance evidence", async () => {
  const { deps, repositories } = await createAuditWithScoreableWorkflows();

  const result = await generateRoadmapService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_leadfollowup", "wf_proposal", "wf_weeklyreporting"],
    start_date: "2026-08-15",
    delivery_capacity: "mixed_team",
    max_parallel_initiatives: 1,
  });

  assert.equal(result.audit_id, "aud_01JZ6K8M");
  assert.equal(result.roadmap_id, "rm_01JZ74TP");
  assert.deepEqual(
    result.phases.map((phase) => phase.phase),
    ["days_1_30", "days_31_60", "days_61_90"],
  );
  assert.deepEqual(
    result.phases.flatMap((phase) => phase.initiatives.map((initiative) => initiative.workflow_id)),
    ["wf_proposal", "wf_leadfollowup", "wf_weeklyreporting"],
  );
  assert.equal(result.phases[0].initiatives[0].owner_role, "Owner");
  assert.ok(result.phases[0].initiatives[0].deliverable.includes("Instrument and document Proposal assembly"));
  assert.ok(result.phases[0].initiatives[0].dependencies.includes("Named process owner"));
  assert.ok(result.critical_dependencies.includes("Named business owner for each workflow"));
  assert.ok(result.executive_decisions.includes("Approve the first pilot workflow and named owner"));
  assert.equal((await repositories.audits.getAudit(scope, "aud_01JZ6K8M"))?.status, "roadmap_ready");
  assert.equal(repositories.events.events.at(-1)?.type, "roadmap.generated");
  assert.deepEqual(repositories.events.events.at(-1)?.payload.workflowIds, [
    "wf_proposal",
    "wf_leadfollowup",
    "wf_weeklyreporting",
  ]);
});

test("generateRoadmapService respects max parallel initiatives", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  const result = await generateRoadmapService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_leadfollowup", "wf_proposal", "wf_weeklyreporting"],
    max_parallel_initiatives: 2,
  });

  assert.equal(result.phases[0].initiatives.length, 2);
  assert.equal(result.phases[1].initiatives.length, 1);
  assert.equal(result.phases[2].initiatives.length, 0);
});

test("generateRoadmapService rejects missing workflows", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  await assert.rejects(
    () =>
      generateRoadmapService(deps, scope, {
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_leadfollowup", "wf_missing"],
      }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "WORKFLOW_NOT_FOUND");
      assert.deepEqual(error.missing, ["wf_missing"]);
      return true;
    },
  );
});

test("generateRoadmapService rejects selected workflows with insufficient evidence", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();
  await upsertWorkflowService(deps, scope, {
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_unready",
    workflow: {
      ...workflow,
      name: "Unready workflow",
      monthly_volume: 0,
      minutes_per_run: 0,
      evidence_quality: "unknown",
    },
  });

  await assert.rejects(
    () =>
      generateRoadmapService(deps, scope, {
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_unready"],
      }),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "INSUFFICIENT_EVIDENCE");
      assert.ok(error.missing.includes("workflow.minutes_per_run"));
      return true;
    },
  );
});

test("generateRoadmapService fails closed across tenant boundaries", async () => {
  const { deps } = await createAuditWithScoreableWorkflows();

  await assert.rejects(
    () =>
      generateRoadmapService(
        deps,
        { tenantId: "ten_other", actorUserId: "usr_other" },
        {
          audit_id: "aud_01JZ6K8M",
          workflow_ids: ["wf_leadfollowup"],
        },
      ),
    (error) => {
      assert.ok(error instanceof AuditFlowServiceError);
      assert.equal(error.code, "AUDIT_NOT_FOUND");
      return true;
    },
  );
});
