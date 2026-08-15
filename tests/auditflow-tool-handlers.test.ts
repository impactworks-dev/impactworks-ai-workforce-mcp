import assert from "node:assert/strict";
import test from "node:test";

import { invokeAuditFlowTool } from "../packages/auditflow-mcp/src/handlers.ts";
import { createInMemoryAuditFlowRuntime } from "../packages/auditflow-mcp/src/runtime.ts";
import type { TenantScope, WorkflowProfile } from "../packages/auditflow-contracts/src/index.ts";

const scope: TenantScope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};
const now = "2026-08-15T20:30:00.000Z";

const leadToProposalWorkflow: WorkflowProfile = {
  name: "Lead intake to proposal follow-up",
  department: "Sales",
  trigger: "A new inbound prospect submits the website form or replies to outreach.",
  desired_outcome: "Qualified opportunity has a complete record, an approval-ready proposal or next step, and scheduled follow-up.",
  steps: [
    {
      sequence: 1,
      action: "Review inbound lead details and source context",
      owner_role: "Dante",
      system: "Website",
      minutes: 8,
      manual: true,
    },
    {
      sequence: 2,
      action: "Create or update opportunity record",
      owner_role: "Dante",
      system: "ClickUp",
      minutes: 10,
      manual: true,
    },
    {
      sequence: 3,
      action: "Draft proposal or next-step email for approval",
      owner_role: "Dante",
      system: "Google Drive",
      minutes: 45,
      manual: true,
    },
    {
      sequence: 4,
      action: "Schedule follow-up reminder",
      owner_role: "Dante",
      system: "Calendar",
      minutes: 5,
      manual: true,
    },
  ],
  monthly_volume: 22,
  minutes_per_run: 68,
  loaded_hourly_rate_usd: 125,
  error_rate_percent: 12,
  cost_per_error_usd: 250,
  annual_revenue_at_risk_usd: 80_000,
  systems: ["Website", "ClickUp", "Google Drive", "Gmail", "Calendar"],
  pain_points: [
    "Lead context is scattered across systems",
    "Proposal assembly takes too long",
    "Follow-up timing is inconsistent",
  ],
  exception_rate_percent: 8,
  data_sensitivity: "confidential",
  evidence_quality: "owner_estimate",
};

const weeklyOpsWorkflow: WorkflowProfile = {
  name: "Weekly operating report",
  department: "Operations",
  trigger: "Friday operating review is due.",
  desired_outcome: "Project health, blockers, and next actions are summarized for review.",
  steps: [
    {
      sequence: 1,
      action: "Collect task status from ClickUp",
      owner_role: "Operations owner",
      system: "ClickUp",
      minutes: 30,
      manual: true,
    },
    {
      sequence: 2,
      action: "Summarize blockers and next actions",
      owner_role: "Operations owner",
      system: "Google Docs",
      minutes: 60,
      manual: true,
    },
  ],
  monthly_volume: 4,
  minutes_per_run: 90,
  loaded_hourly_rate_usd: 90,
  systems: ["ClickUp", "Google Docs"],
  pain_points: ["Reporting requires manual status stitching"],
  exception_rate_percent: 5,
  data_sensitivity: "internal",
  evidence_quality: "team_estimate",
};

const inboxTriageWorkflow: WorkflowProfile = {
  name: "Inbox triage and action capture",
  department: "Operations",
  trigger: "New client or partner email arrives.",
  desired_outcome: "Important emails are classified, summarized, and converted into approved tasks or replies.",
  steps: [
    {
      sequence: 1,
      action: "Review incoming message",
      owner_role: "Dante",
      system: "Gmail",
      minutes: 6,
      manual: true,
    },
    {
      sequence: 2,
      action: "Create task or draft response",
      owner_role: "Dante",
      system: "ClickUp",
      minutes: 12,
      manual: true,
    },
  ],
  monthly_volume: 80,
  minutes_per_run: 18,
  loaded_hourly_rate_usd: 125,
  error_rate_percent: 5,
  cost_per_error_usd: 100,
  systems: ["Gmail", "ClickUp"],
  pain_points: ["Important follow-ups can be missed", "Task capture is inconsistent"],
  exception_rate_percent: 12,
  data_sensitivity: "confidential",
  evidence_quality: "owner_estimate",
};

test("AuditFlow tool handler runs the ImpactWorks lead-to-proposal golden path", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now });

  const createAudit = await invokeAuditFlowTool(runtime.deps, scope, "create_audit", {
    business: {
      name: "ImpactWorks",
      industry: "AI workforce strategy and implementation",
      employee_count: 2,
      annual_revenue_usd: 500_000,
      primary_goal: "increase_capacity",
    },
    constraints: {
      budget_range_usd: { min: 5_000, max: 25_000 },
      target_timeline_days: 45,
    },
    default_loaded_hourly_rate_usd: 125,
    source: "consultant_led",
  });
  assert.equal(createAudit.ok, true);
  assert.equal(createAudit.tool_name, "create_audit");
  assert.equal(createAudit.output.audit_id, "aud_0001");

  const workflows = [
    ["wf_leadproposal", leadToProposalWorkflow],
    ["wf_weeklyops", weeklyOpsWorkflow],
    ["wf_inboxtriage", inboxTriageWorkflow],
  ] as const;
  for (const [workflowId, workflow] of workflows) {
    const result = await invokeAuditFlowTool(runtime.deps, scope, "upsert_workflow", {
      audit_id: "aud_0001",
      workflow_id: workflowId,
      workflow,
    });
    assert.equal(result.ok, true);
    assert.equal(result.output.completeness_percent, 100);
  }

  const score = await invokeAuditFlowTool(runtime.deps, scope, "score_opportunities", {
    audit_id: "aud_0001",
  });
  assert.equal(score.ok, true);
  assert.equal(score.output.opportunities.length, 3);
  assert.equal(score.output.opportunities[0].workflow_id, "wf_leadproposal");

  const roi = await invokeAuditFlowTool(runtime.deps, scope, "estimate_roi", {
    audit_id: "aud_0001",
    workflow_ids: ["wf_leadproposal", "wf_weeklyops", "wf_inboxtriage"],
    implementation_cost_usd: 12_000,
    annual_software_cost_usd: 3_000,
    automation_coverage_percent: 65,
    adoption_rate_percent: 80,
    include_revenue_uplift: false,
  });
  assert.equal(roi.ok, true);
  assert.equal(roi.output.scenarios[1].name, "expected");
  assert.ok(roi.output.scenarios[1].annual_net_benefit_usd > 0);

  const stack = await invokeAuditFlowTool(runtime.deps, scope, "recommend_solution_stack", {
    audit_id: "aud_0001",
    workflow_ids: ["wf_leadproposal", "wf_weeklyops", "wf_inboxtriage"],
    preference: "balanced",
    allow_named_products: false,
  });
  assert.equal(stack.ok, true);
  assert.deepEqual(stack.output.recommendations[0].example_products, []);
  assert.ok(stack.output.recommendations[0].security_controls.includes("Tenant-scoped records and tool access"));

  const roadmap = await invokeAuditFlowTool(runtime.deps, scope, "generate_roadmap", {
    audit_id: "aud_0001",
    workflow_ids: ["wf_leadproposal", "wf_weeklyops", "wf_inboxtriage"],
    start_date: "2026-08-15",
    delivery_capacity: "mixed_team",
    max_parallel_initiatives: 1,
  });
  assert.equal(roadmap.ok, true);
  assert.equal(roadmap.output.roadmap_id, "rm_0001");
  assert.equal(roadmap.output.phases[0].initiatives[0].workflow_id, "wf_leadproposal");

  const report = await invokeAuditFlowTool(runtime.deps, scope, "get_audit_report", {
    audit_id: "aud_0001",
    audience: "owner",
    detail_level: "standard",
    include_sprint_fit: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.output.status, "decision_ready");
  assert.equal(report.output.business_snapshot.name, "ImpactWorks");
  assert.equal(report.output.top_opportunities[0].workflow_id, "wf_leadproposal");
  assert.equal(report.output.sprint_fit.qualified, true);
  assert.match(report.output.executive_summary, /Lead intake to proposal follow-up/);

  assert.deepEqual(
    runtime.repositories.events.events.map((event) => event.type),
    [
      "audit.created",
      "workflow.upserted",
      "workflow.completeness_evaluated",
      "workflow.upserted",
      "workflow.completeness_evaluated",
      "workflow.upserted",
      "workflow.completeness_evaluated",
      "opportunities.scored",
      "roi.estimated",
      "roadmap.generated",
    ],
  );
});

test("AuditFlow tool handler rejects model-supplied identity and unknown tools", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now });

  const unknownTool = await invokeAuditFlowTool(runtime.deps, scope, "delete_everything", {});
  assert.equal(unknownTool.ok, false);
  assert.equal(unknownTool.error.code, "VALIDATION_FAILED");
  assert.deepEqual(unknownTool.error.missing, ["tool_name"]);

  const invalidIdentity = await invokeAuditFlowTool(runtime.deps, scope, "create_audit", {
    tenant_id: "ten_from_model",
    business: {
      name: "ImpactWorks",
      industry: "AI workforce strategy and implementation",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
  });
  assert.equal(invalidIdentity.ok, false);
  assert.equal(invalidIdentity.error.code, "VALIDATION_FAILED");
  assert.ok(invalidIdentity.error.missing.includes("input.tenant_id is not allowed"));
});

test("AuditFlow tool handler preserves tenant isolation", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now });
  await invokeAuditFlowTool(runtime.deps, scope, "create_audit", {
    business: {
      name: "ImpactWorks",
      industry: "AI workforce strategy and implementation",
      employee_count: 2,
      primary_goal: "increase_capacity",
    },
  });

  const otherScope: TenantScope = {
    tenantId: "ten_other",
    actorUserId: "usr_other",
  };
  const result = await invokeAuditFlowTool(runtime.deps, otherScope, "get_audit_report", {
    audit_id: "aud_0001",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUDIT_NOT_FOUND");
});
