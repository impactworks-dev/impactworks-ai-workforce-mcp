# Development Roadmap

## Phase 1 — Capability core

- [x] Deterministic opportunity scoring
- [x] Deterministic ROI scenarios
- [x] Golden and boundary tests
- [x] Runtime-validated canonical tool contracts
- [x] Audit and workflow domain entities
- [x] Completeness and evidence-confidence policies
- [x] Tenant-scoped repository interfaces
- [x] AuditFlow application services
- [x] Contract and cross-tenant denial tests

## Phase 2 — MCP vertical slice

- [x] Minimal Streamable HTTP MCP server for local proof work
- [x] Stdio-compatible MCP JSON-RPC adapter
- [x] Trusted tenant-scope injection boundary
- [x] Six-tool golden path plus solution-stack contract
- [x] Stable error envelope for tool-originated failures
- [x] Bearer-token tenant middleware for local proof work
- [x] Production-shaped OAuth 2.1 resource-server validation
- [x] Protected resource metadata for authorization-server discovery
- [x] JWT issuer, audience, expiry, scope, and trusted-claims tenant validation
- [ ] Audit event log and evidence projection
- [ ] First supported host integration
- [ ] Synthetic audit evaluation harness

## Phase 3 — Internal proof

- [ ] Run the lead-to-proposal and follow-up golden path
- [ ] Capture baseline and post-run measures
- [ ] Verify approval compliance and exception handling
- [ ] Produce a public-safe proof package
- [ ] Connect a second host only after the first is stable

## Phase 4 — Cog installable proof

- [ ] Signed, notarized macOS installer
- [ ] Account and tenant bootstrap
- [ ] Guided first-use conversation
- [ ] Progressive connection and permission flow
- [ ] First-use approval card
- [ ] Live AuditFlow result and task progress
- [ ] Routine demonstration and review flow
- [ ] Connection revocation and off switch

## Phase 5 — Controlled pilot

- [ ] Select a design partner and named owner
- [ ] Complete AuditFlow and Blueprint
- [ ] Deploy one least-privilege workflow
- [ ] Run acceptance and observation period
- [ ] Review outcomes and decide to expand, revise, or stop

## Quality gates

- All declared tool schemas validate.
- Unauthorized actions, approval bypasses, and cross-tenant access remain zero.
- Calculation results reproduce from stored inputs and formula versions.
- Consequential actions show destination, affected data, and consequence before approval.
- Logs provide evidence without exposing secrets or unnecessary customer content.
