# Contributing

ImpactWorks AI Workforce MCP is in early development. Contributions should preserve bounded capabilities, deterministic business logic, and explicit human governance.

## Development workflow

1. Create a focused branch from `main`.
2. Keep each change tied to one acceptance criterion.
3. Add or update tests for behavior changes.
4. Run `npm test` locally.
5. Open a pull request describing the behavior, trust implications, and verification performed.

## Pull-request requirements

- No credentials, customer data, private workflow text, or full production payloads.
- No official score or ROI arithmetic inside prompts.
- No tenant identifier accepted from model-supplied tool arguments.
- No consequential write path without an explicit approval policy.
- New tools must document permissions, idempotency, failure behavior, evidence, and recovery.
- Security-relevant behavior requires negative tests.

## Commit style

Use concise, outcome-focused commits, for example:

```text
feat(scoring): add deterministic priority bands
test(roi): cover zero-cost and negative-benefit cases
docs(flare): specify progressive connection onboarding
```
