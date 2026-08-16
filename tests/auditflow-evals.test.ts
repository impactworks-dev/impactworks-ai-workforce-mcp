import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_EVAL_HARNESS_VERSION,
  impactWorksLeadToProposalEvalScenario,
  runAuditFlowEvalScenario,
} from "../packages/auditflow-contracts/src/index.ts";
import { createInMemoryAuditFlowRuntime } from "../packages/auditflow-mcp/src/index.ts";
import type { TenantScope } from "../packages/auditflow-contracts/src/index.ts";

const scope: TenantScope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};

test("runAuditFlowEvalScenario executes the ImpactWorks golden path as a regression eval", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now: "2026-08-16T12:00:00.000Z" });
  const result = await runAuditFlowEvalScenario(
    runtime.deps,
    scope,
    impactWorksLeadToProposalEvalScenario(),
  );

  assert.equal(result.scenario_id, "impactworks-lead-to-proposal-v1");
  assert.equal(result.harness_version, AUDITFLOW_EVAL_HARNESS_VERSION);
  assert.equal(result.passed, true);
  assert.equal(result.audit_id, "aud_0001");
  assert.deepEqual(
    result.assertions.map((assertion) => [assertion.name, assertion.passed]),
    [
      ["top workflow remains stable", true],
      ["minimum scoreable workflows met", true],
      ["expected annual net benefit clears floor", true],
      ["report status matches expectation", true],
      ["sprint fit matches expectation", true],
      ["required event types are present", true],
      ["projection has no recorded errors", true],
    ],
  );
  assert.equal(result.evidence.lifecycle.workflows_captured, 3);
  assert.equal(result.evidence.lifecycle.score_runs, 1);
  assert.equal(result.evidence.lifecycle.roi_runs, 1);
  assert.equal(result.evidence.lifecycle.roadmap_runs, 1);
  assert.equal(result.evidence.workflow_evidence[0].workflow_id, "wf_inboxtriage");
  assert.equal(result.evidence.governance.has_required_approval_open, false);
});

test("runAuditFlowEvalScenario reports failed expectations without hiding evidence", async () => {
  const runtime = createInMemoryAuditFlowRuntime({ now: "2026-08-16T12:00:00.000Z" });
  const scenario = impactWorksLeadToProposalEvalScenario();
  scenario.expectations.top_workflow_id = "wf_weeklyops";
  scenario.expectations.minimum_expected_annual_net_benefit_usd = 1_000_000;

  const result = await runAuditFlowEvalScenario(runtime.deps, scope, scenario);

  assert.equal(result.passed, false);
  const failed = result.assertions.filter((assertion) => !assertion.passed);
  assert.deepEqual(
    failed.map((assertion) => assertion.name),
    [
      "top workflow remains stable",
      "expected annual net benefit clears floor",
    ],
  );
  assert.equal(result.evidence.generated_from_event_count, 10);
});
