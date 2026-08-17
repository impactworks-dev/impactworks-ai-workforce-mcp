import type {
  AuditConstraints,
  AuditId,
  AuditBusinessProfile,
  AuditSource,
  AuditFlowServiceDependencies,
  GenerateRoadmapInput,
  RecommendSolutionStackInput,
  TenantScope,
  WorkflowId,
  WorkflowProfile,
} from "./index.ts";
import {
  createAuditService,
  estimateRoiService,
  generateRoadmapService,
  getAuditReportService,
  recommendSolutionStackService,
  scoreOpportunitiesService,
  upsertWorkflowService,
} from "./services.ts";
import {
  projectAuditEvidence,
  type AuditEvidenceProjection,
} from "./evidence.ts";

export const AUDITFLOW_EVAL_HARNESS_VERSION = "auditflow-eval-harness-1.0.0";

export interface AuditFlowEvalWorkflowFixture {
  workflow_id: WorkflowId;
  workflow: WorkflowProfile;
}

export interface AuditFlowEvalScenario {
  scenario_id: string;
  name: string;
  business: AuditBusinessProfile;
  constraints?: AuditConstraints;
  source?: AuditSource;
  default_loaded_hourly_rate_usd?: number;
  workflows: AuditFlowEvalWorkflowFixture[];
  roi: {
    implementation_cost_usd: number;
    annual_software_cost_usd: number;
    automation_coverage_percent: number;
    adoption_rate_percent: number;
    include_revenue_uplift: boolean;
  };
  solution_stack?: Pick<RecommendSolutionStackInput, "preference" | "allow_named_products">;
  roadmap?: Pick<GenerateRoadmapInput, "start_date" | "delivery_capacity" | "max_parallel_initiatives">;
  expectations: {
    top_workflow_id: WorkflowId;
    minimum_scoreable_workflows: number;
    minimum_expected_annual_net_benefit_usd: number;
    report_status: "draft" | "decision_ready" | "complete";
    sprint_fit_qualified: boolean;
    required_event_types: string[];
  };
}

export interface AuditFlowEvalAssertion {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface AuditFlowEvalResult {
  scenario_id: string;
  harness_version: typeof AUDITFLOW_EVAL_HARNESS_VERSION;
  passed: boolean;
  assertions: AuditFlowEvalAssertion[];
  audit_id: AuditId;
  evidence: AuditEvidenceProjection;
}

function assertion(name: string, actual: unknown, expected: unknown, passed: boolean): AuditFlowEvalAssertion {
  return {
    name,
    passed,
    expected,
    actual,
  };
}

function includesAll(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every((item) => actual.includes(item));
}

export async function runAuditFlowEvalScenario(
  deps: AuditFlowServiceDependencies,
  scope: TenantScope,
  scenario: AuditFlowEvalScenario,
): Promise<AuditFlowEvalResult> {
  const created = await createAuditService(deps, scope, {
    business: scenario.business,
    constraints: scenario.constraints,
    default_loaded_hourly_rate_usd: scenario.default_loaded_hourly_rate_usd,
    source: scenario.source,
  });
  const auditId = created.audit_id;

  for (const fixture of scenario.workflows) {
    await upsertWorkflowService(deps, scope, {
      audit_id: auditId,
      workflow_id: fixture.workflow_id,
      workflow: fixture.workflow,
    });
  }

  const score = await scoreOpportunitiesService(deps, scope, {
    audit_id: auditId,
  });
  const workflowIds = score.opportunities.map((opportunity) => opportunity.workflow_id);
  const roi = await estimateRoiService(deps, scope, {
    audit_id: auditId,
    workflow_ids: workflowIds,
    ...scenario.roi,
  });
  await recommendSolutionStackService(deps, scope, {
    audit_id: auditId,
    workflow_ids: workflowIds,
    preference: scenario.solution_stack?.preference ?? "balanced",
    allow_named_products: scenario.solution_stack?.allow_named_products ?? false,
  });
  await generateRoadmapService(deps, scope, {
    audit_id: auditId,
    workflow_ids: workflowIds,
    start_date: scenario.roadmap?.start_date,
    delivery_capacity: scenario.roadmap?.delivery_capacity ?? "mixed_team",
    max_parallel_initiatives: scenario.roadmap?.max_parallel_initiatives ?? 1,
  });
  const report = await getAuditReportService(deps, scope, {
    audit_id: auditId,
    audience: "owner",
    detail_level: "standard",
    include_sprint_fit: true,
  });
  const events = await deps.repositories.events.listEvents(scope, auditId);
  const evidence = projectAuditEvidence(events);
  const eventTypes = evidence.timeline.map((item) => item.type);
  const expectedNetBenefit = roi.scenarios.find((scenario) => scenario.name === "expected")
    ?.annual_net_benefit_usd ?? null;

  const assertions = [
    assertion(
      "top workflow remains stable",
      score.opportunities[0]?.workflow_id,
      scenario.expectations.top_workflow_id,
      score.opportunities[0]?.workflow_id === scenario.expectations.top_workflow_id,
    ),
    assertion(
      "minimum scoreable workflows met",
      score.opportunities.length,
      scenario.expectations.minimum_scoreable_workflows,
      score.opportunities.length >= scenario.expectations.minimum_scoreable_workflows,
    ),
    assertion(
      "expected annual net benefit clears floor",
      expectedNetBenefit,
      scenario.expectations.minimum_expected_annual_net_benefit_usd,
      expectedNetBenefit !== null &&
        expectedNetBenefit >= scenario.expectations.minimum_expected_annual_net_benefit_usd,
    ),
    assertion(
      "report status matches expectation",
      report.status,
      scenario.expectations.report_status,
      report.status === scenario.expectations.report_status,
    ),
    assertion(
      "sprint fit matches expectation",
      report.sprint_fit.qualified,
      scenario.expectations.sprint_fit_qualified,
      report.sprint_fit.qualified === scenario.expectations.sprint_fit_qualified,
    ),
    assertion(
      "required event types are present",
      eventTypes,
      scenario.expectations.required_event_types,
      includesAll(eventTypes, scenario.expectations.required_event_types),
    ),
    assertion(
      "projection has no recorded errors",
      evidence.governance.has_recorded_errors,
      false,
      evidence.governance.has_recorded_errors === false,
    ),
  ];

  return {
    scenario_id: scenario.scenario_id,
    harness_version: AUDITFLOW_EVAL_HARNESS_VERSION,
    passed: assertions.every((item) => item.passed),
    assertions,
    audit_id: auditId,
    evidence,
  };
}

export function impactWorksLeadToProposalEvalScenario(): AuditFlowEvalScenario {
  return {
    scenario_id: "impactworks-lead-to-proposal-v1",
    name: "ImpactWorks lead-to-proposal and follow-up golden path",
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
    source: "consultant_led",
    default_loaded_hourly_rate_usd: 125,
    workflows: [
      {
        workflow_id: "wf_leadproposal",
        workflow: {
          name: "Lead intake to proposal follow-up",
          department: "Sales",
          trigger: "A new inbound prospect submits the website form or replies to outreach.",
          desired_outcome:
            "Qualified opportunity has a complete record, an approval-ready proposal or next step, and scheduled follow-up.",
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
        },
      },
      {
        workflow_id: "wf_weeklyops",
        workflow: {
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
        },
      },
      {
        workflow_id: "wf_inboxtriage",
        workflow: {
          name: "Inbox triage and action capture",
          department: "Operations",
          trigger: "New client or partner email arrives.",
          desired_outcome:
            "Important emails are classified, summarized, and converted into approved tasks or replies.",
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
        },
      },
    ],
    roi: {
      implementation_cost_usd: 12_000,
      annual_software_cost_usd: 3_000,
      automation_coverage_percent: 65,
      adoption_rate_percent: 80,
      include_revenue_uplift: false,
    },
    solution_stack: {
      preference: "balanced",
      allow_named_products: false,
    },
    roadmap: {
      start_date: "2026-08-15",
      delivery_capacity: "mixed_team",
      max_parallel_initiatives: 1,
    },
    expectations: {
      top_workflow_id: "wf_leadproposal",
      minimum_scoreable_workflows: 3,
      minimum_expected_annual_net_benefit_usd: 40_000,
      report_status: "decision_ready",
      sprint_fit_qualified: true,
      required_event_types: [
        "audit.created",
        "workflow.upserted",
        "workflow.completeness_evaluated",
        "opportunities.scored",
        "roi.estimated",
        "roadmap.generated",
      ],
    },
  };
}
