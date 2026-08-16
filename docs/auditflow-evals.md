# AuditFlow Eval Harness

The AuditFlow eval harness runs repeatable golden-path scenarios against the service layer and returns explicit pass/fail assertions plus an evidence projection.

## Current eval

`impactWorksLeadToProposalEvalScenario()` covers the approved internal golden path:

- inbound lead intake,
- proposal or next-step preparation,
- follow-up scheduling,
- weekly operating report,
- inbox triage and action capture.

The scenario expects:

- `wf_leadproposal` to remain the top-ranked opportunity,
- at least three scoreable workflows,
- expected annual net benefit above the configured floor,
- a decision-ready report,
- sprint fit qualified,
- required lifecycle events present,
- no recorded errors.

## Usage

```ts
import {
  impactWorksLeadToProposalEvalScenario,
  runAuditFlowEvalScenario,
} from "../packages/auditflow-contracts/src/index.ts";

const result = await runAuditFlowEvalScenario(
  deps,
  scope,
  impactWorksLeadToProposalEvalScenario(),
);

if (!result.passed) {
  console.log(result.assertions.filter((assertion) => !assertion.passed));
}
```

## Why this matters

This is the first durable regression gate for the product methodology. It checks that future scoring, ROI, report, roadmap, and evidence changes do not silently break the internal ImpactWorks lead-to-proposal proof.

The harness is intentionally service-level first. Host tests, ChatGPT tests, Cloudflare tests, and Cog harness tests can consume the same scenario after the underlying capability path is stable.
