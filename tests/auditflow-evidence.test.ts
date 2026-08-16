import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDITFLOW_EVIDENCE_PROJECTION_VERSION,
  createAuditEvent,
  projectAuditEvidence,
} from "../packages/auditflow-contracts/src/index.ts";
import type {
  AuditFlowEvent,
  AuditFlowEventType,
  EventId,
  TenantScope,
} from "../packages/auditflow-contracts/src/index.ts";

const scope: TenantScope = {
  tenantId: "ten_impactworks",
  actorUserId: "usr_dante",
};

function event(
  index: number,
  type: AuditFlowEventType,
  payload: Record<string, unknown>,
  occurredAt = `2026-08-16T10:0${index}:00.000Z`,
): AuditFlowEvent {
  return createAuditEvent(scope, {
    eventId: `evt_${index.toString().padStart(4, "0")}` as EventId,
    auditId: "aud_0001",
    type,
    occurredAt,
    payload,
  });
}

test("projectAuditEvidence turns raw audit events into dashboard-ready evidence", () => {
  const projection = projectAuditEvidence([
    event(3, "workflow.completeness_evaluated", {
      workflowId: "wf_leadproposal",
      completenessPercent: 92,
      evidenceConfidence: "medium",
      scoreable: true,
      missingFields: ["workflow.error_rate_percent"],
      warnings: ["Measure error rate before final ROI claim."],
    }),
    event(1, "audit.created", {
      status: "intake",
      missingFields: ["constraints.budget_range_usd"],
      source: "self_serve",
    }),
    event(2, "workflow.upserted", {
      workflowId: "wf_leadproposal",
      workflowName: "Lead to proposal follow-up",
    }),
    event(4, "opportunities.scored", {
      scoringVersion: "opportunity-score-1.0.0",
      workflowIds: ["wf_leadproposal"],
    }),
    event(5, "roi.estimated", {
      roiVersion: "roi-1.0.0",
      workflowIds: ["wf_leadproposal"],
    }),
    event(6, "roadmap.generated", {
      roadmapId: "rm_0001",
      workflowIds: ["wf_leadproposal"],
    }),
  ]);

  assert.equal(projection.audit_id, "aud_0001");
  assert.equal(projection.projection_version, AUDITFLOW_EVIDENCE_PROJECTION_VERSION);
  assert.equal(projection.generated_from_event_count, 6);
  assert.equal(projection.last_event_at, "2026-08-16T10:06:00.000Z");
  assert.deepEqual(projection.lifecycle, {
    audit_created: true,
    workflows_captured: 1,
    score_runs: 1,
    roi_runs: 1,
    solution_stack_runs: 0,
    roadmap_runs: 1,
    approval_required: 0,
    approval_recorded: 0,
    errors_recorded: 0,
  });
  assert.deepEqual(projection.calculation_versions, {
    scoring_versions: ["opportunity-score-1.0.0"],
    roi_versions: ["roi-1.0.0"],
  });
  assert.deepEqual(projection.workflow_evidence, [
    {
      workflow_id: "wf_leadproposal",
      workflow_name: "Lead to proposal follow-up",
      completeness_percent: 92,
      evidence_confidence: "medium",
      scoreable: true,
      missing_fields: ["workflow.error_rate_percent"],
      warnings: ["Measure error rate before final ROI claim."],
    },
  ]);
  assert.deepEqual(
    projection.timeline.map((item) => item.type),
    [
      "audit.created",
      "workflow.upserted",
      "workflow.completeness_evaluated",
      "opportunities.scored",
      "roi.estimated",
      "roadmap.generated",
    ],
  );
  assert.equal(projection.timeline[2].severity, "info");
  assert.equal(projection.governance.has_required_approval_open, false);
  assert.equal(projection.governance.has_recorded_errors, false);
});

test("projectAuditEvidence surfaces open approvals, errors, and unscoreable workflows", () => {
  const projection = projectAuditEvidence([
    event(1, "audit.created", {}),
    event(2, "workflow.upserted", {
      workflowId: "wf_unready",
      workflowName: "Unready workflow",
    }),
    event(3, "workflow.completeness_evaluated", {
      workflowId: "wf_unready",
      completenessPercent: 48,
      evidenceConfidence: "low",
      scoreable: false,
      missingFields: ["workflow.steps", "workflow.systems"],
      warnings: ["Workflow needs owner validation."],
    }),
    event(4, "approval.required", {
      reason: "Roadmap generation requires owner approval.",
    }),
    event(5, "error.recorded", {
      message: "Missing required workflow evidence.",
    }),
  ]);

  assert.equal(projection.lifecycle.approval_required, 1);
  assert.equal(projection.lifecycle.approval_recorded, 0);
  assert.equal(projection.lifecycle.errors_recorded, 1);
  assert.equal(projection.timeline[2].severity, "warning");
  assert.equal(projection.timeline[3].severity, "warning");
  assert.equal(projection.timeline[4].severity, "blocked");
  assert.equal(projection.workflow_evidence[0].scoreable, false);
  assert.deepEqual(projection.governance, {
    has_required_approval_open: true,
    has_recorded_errors: true,
    blocked_reasons: [
      "Missing required workflow evidence.",
      "Roadmap generation requires owner approval.",
    ],
  });
});

test("projectAuditEvidence rejects empty or mixed-audit event lists", () => {
  assert.throws(() => projectAuditEvidence([]), /requires at least one audit event/);

  const mixedAuditEvent = createAuditEvent(scope, {
    eventId: "evt_mixed",
    auditId: "aud_9999",
    type: "audit.created",
    occurredAt: "2026-08-16T10:02:00.000Z",
    payload: {},
  });

  assert.throws(
    () => projectAuditEvidence([event(1, "audit.created", {}), mixedAuditEvent]),
    /cannot mix events/,
  );
});
