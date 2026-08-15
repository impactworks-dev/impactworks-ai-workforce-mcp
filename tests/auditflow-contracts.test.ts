import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_CONTRACT_VERSION,
  AUDITFLOW_ERROR_CODES,
  AUDITFLOW_TOOL_NAMES,
  AuditFlowValidationError,
  MUTATING_AUDITFLOW_TOOLS,
  READ_ONLY_AUDITFLOW_TOOLS,
  validateCreateAuditInput,
  validateEstimateRoiInput,
  validateGenerateRoadmapInput,
  validateGetAuditReportInput,
  validateScoreOpportunitiesInput,
  validateToolInput,
  validateUpsertWorkflowInput,
} from "../packages/auditflow-contracts/src/index.ts";

const workflow = {
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
  error_rate_percent: 8,
  cost_per_error_usd: 150,
  systems: ["Website", "ClickUp", "Email"],
  pain_points: ["Follow-up timing is inconsistent"],
  data_sensitivity: "confidential",
  evidence_quality: "owner_estimate",
};

test("AuditFlow contract metadata exposes stable tools, mutability, and errors", () => {
  assert.equal(AUDITFLOW_CONTRACT_VERSION, "auditflow-contracts-1.0.0");
  assert.deepEqual(AUDITFLOW_TOOL_NAMES, [
    "create_audit",
    "upsert_workflow",
    "score_opportunities",
    "estimate_roi",
    "recommend_solution_stack",
    "generate_roadmap",
    "get_audit_report",
  ]);
  assert.deepEqual(MUTATING_AUDITFLOW_TOOLS, [
    "create_audit",
    "upsert_workflow",
    "generate_roadmap",
  ]);
  assert.deepEqual(READ_ONLY_AUDITFLOW_TOOLS, [
    "score_opportunities",
    "estimate_roi",
    "recommend_solution_stack",
    "get_audit_report",
  ]);
  assert.ok(AUDITFLOW_ERROR_CODES.includes("INSUFFICIENT_EVIDENCE"));
});

test("create_audit accepts the canonical business snapshot shape", () => {
  const input = validateCreateAuditInput({
    business: {
      name: "ImpactWorks",
      industry: "AI consulting",
      employee_count: 2,
      annual_revenue_usd: 500000,
      locations: 1,
      country: "US",
      primary_goal: "increase_capacity",
    },
    constraints: {
      budget_range_usd: { min: 5000, max: 15000 },
      target_timeline_days: 30,
      regulated_data: false,
      must_keep_systems: ["ClickUp"],
    },
    default_loaded_hourly_rate_usd: 75,
    source: "consultant_led",
  });

  assert.equal(input.business.primary_goal, "increase_capacity");
  assert.equal(input.constraints?.budget_range_usd?.max, 15000);
});

test("upsert_workflow validates tenant-scoped audit IDs and workflow evidence fields", () => {
  const input = validateUpsertWorkflowInput({
    audit_id: "aud_01JZ6K8M",
    workflow_id: "wf_leadfollowup",
    workflow,
  });

  assert.equal(input.audit_id, "aud_01JZ6K8M");
  assert.equal(input.workflow.steps[0].manual, true);
  assert.equal(input.workflow.evidence_quality, "owner_estimate");
});

test("read-only scoring input allows optional workflow filters", () => {
  const input = validateScoreOpportunitiesInput({
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_leadfollowup"],
    force_recalculate: true,
  });

  assert.deepEqual(input.workflow_ids, ["wf_leadfollowup"]);
});

test("ROI, roadmap, and report validators enforce bounded option sets", () => {
  assert.equal(
    validateEstimateRoiInput({
      audit_id: "aud_01JZ6K8M",
      workflow_ids: ["wf_leadfollowup"],
      implementation_cost_usd: 9000,
      automation_coverage_percent: 65,
      adoption_rate_percent: 80,
      include_revenue_uplift: false,
    }).automation_coverage_percent,
    65,
  );

  assert.equal(
    validateGenerateRoadmapInput({
      audit_id: "aud_01JZ6K8M",
      workflow_ids: ["wf_leadfollowup"],
      start_date: "2026-08-15",
      delivery_capacity: "mixed_team",
      max_parallel_initiatives: 2,
    }).delivery_capacity,
    "mixed_team",
  );

  assert.equal(
    validateGetAuditReportInput({
      audit_id: "aud_01JZ6K8M",
      audience: "owner",
      detail_level: "standard",
      include_sprint_fit: true,
    }).detail_level,
    "standard",
  );
});

test("generic dispatcher routes each tool to its validator", () => {
  const result = validateToolInput("recommend_solution_stack", {
    audit_id: "aud_01JZ6K8M",
    workflow_ids: ["wf_leadfollowup"],
    preference: "balanced",
    allow_named_products: true,
  });

  assert.equal(result.audit_id, "aud_01JZ6K8M");
});

test("model-supplied tenant/user fields and malformed IDs fail closed", () => {
  assert.throws(
    () =>
      validateCreateAuditInput({
        tenant_id: "tenant_from_model",
        business: {
          name: "ImpactWorks",
          industry: "AI consulting",
          employee_count: 2,
          primary_goal: "increase_capacity",
        },
      }),
    /input.tenant_id is not allowed/,
  );

  assert.throws(
    () =>
      validateUpsertWorkflowInput({
        audit_id: "tenant_123",
        workflow,
      }),
    /audit_id must match/,
  );
});

test("duplicate workflow IDs and out-of-range percentages become structured validation errors", () => {
  assert.throws(
    () =>
      validateEstimateRoiInput({
        audit_id: "aud_01JZ6K8M",
        workflow_ids: ["wf_leadfollowup", "wf_leadfollowup"],
      }),
    /workflow_ids must contain unique workflow IDs/,
  );

  try {
    validateEstimateRoiInput({
      audit_id: "aud_01JZ6K8M",
      workflow_ids: ["wf_leadfollowup"],
      adoption_rate_percent: 101,
    });
    assert.fail("Expected validation to throw");
  } catch (error) {
    assert.ok(error instanceof AuditFlowValidationError);
    assert.deepEqual(error.toPayload(), {
      error: {
        code: "VALIDATION_FAILED",
        message:
          "AuditFlow validation failed: adoption_rate_percent must be a finite number between 0 and 100",
        retryable: true,
        missing: ["adoption_rate_percent must be a finite number between 0 and 100"],
      },
    });
  }
});
