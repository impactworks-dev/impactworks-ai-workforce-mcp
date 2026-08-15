import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWorkflowCompleteness,
  WORKFLOW_COMPLETENESS_VERSION,
  type WorkflowProfile,
} from "../packages/auditflow-contracts/src/index.ts";

const baseWorkflow: WorkflowProfile = {
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
    {
      sequence: 2,
      action: "Create follow-up task",
      owner_role: "Owner",
      system: "ClickUp",
      minutes: 3,
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

test("complete owner-estimated workflows are scoreable with medium confidence warnings", () => {
  const result = evaluateWorkflowCompleteness(baseWorkflow);

  assert.equal(result.completenessVersion, WORKFLOW_COMPLETENESS_VERSION);
  assert.equal(result.completenessPercent, 100);
  assert.equal(result.scoreable, true);
  assert.equal(result.evidenceConfidence, "medium");
  assert.deepEqual(result.missingFields, []);
  assert.match(result.warnings.join("\n"), /owner estimate/);
  assert.equal(result.nextAction, "Workflow is ready for opportunity scoring.");
});

test("valid workflow shape can still be unscoreable when critical evidence is zero or unknown", () => {
  const result = evaluateWorkflowCompleteness({
    ...baseWorkflow,
    monthly_volume: 0,
    minutes_per_run: 0,
    evidence_quality: "unknown",
  });

  assert.equal(result.scoreable, false);
  assert.equal(result.evidenceConfidence, "low");
  assert.deepEqual(result.missingFields, [
    "workflow.monthly_volume",
    "workflow.minutes_per_run",
    "workflow.evidence_quality",
  ]);
  assert.equal(
    result.nextAction,
    "Collect required workflow evidence: workflow.monthly_volume, workflow.minutes_per_run, workflow.evidence_quality.",
  );
});

test("thin financial context produces ROI warning without blocking opportunity scoring", () => {
  const result = evaluateWorkflowCompleteness({
    ...baseWorkflow,
    loaded_hourly_rate_usd: undefined,
    error_rate_percent: undefined,
    cost_per_error_usd: undefined,
    annual_revenue_at_risk_usd: undefined,
    evidence_quality: "measured",
  });

  assert.equal(result.scoreable, true);
  assert.equal(result.evidenceConfidence, "high");
  assert.ok(result.missingFields.includes("workflow.financial_assumptions"));
  assert.match(result.warnings.join("\n"), /ROI should exclude unsupported benefits/);
});

test("regulated workflows surface governance warnings", () => {
  const result = evaluateWorkflowCompleteness({
    ...baseWorkflow,
    data_sensitivity: "regulated",
    evidence_quality: "measured",
  });

  assert.equal(result.scoreable, true);
  assert.match(result.warnings.join("\n"), /regulated data/);
});
