# ClickUp Sync Log

Use this file while external ClickUp updates are blocked. When credits return, sync these items into the ImpactWorks Ops ClickUp project and then mark each entry as synced.

## Pending updates

### 2026-08-16 - PR #8 merged

- Status: Pending ClickUp sync
- Suggested location: ImpactWorks AI Workforce MCP project, development/status task or activity thread
- Update text:
  - PR #8 merged into `main`: ChatGPT remote MCP integration contract.
  - Adds ChatGPT/OpenAI remote MCP configuration helpers for AuditFlow.
  - Adds OAuth security schemes per AuditFlow MCP tool.
  - Defines read/write scopes and conservative approval defaults.
  - Adds ChatGPT developer-mode connection requirements and live verification checklist.
  - Verification passed: `npm test`, 73/73 tests, and `git diff --check`.

### 2026-08-16 - Cloudflare MCP wrapper implemented locally

- Status: Pending ClickUp sync
- Suggested location: Cloudflare MCP technical spike task
- Update text:
  - Local branch: `codex-cloudflare-mcp-wrapper`.
  - Added dependency-free Cloudflare Worker adapter around the existing AuditFlow HTTP MCP handler.
  - Added Worker entrypoint: `workers/auditflow-mcp/src/index.ts`.
  - Added Wrangler example config: `workers/auditflow-mcp/wrangler.example.toml`.
  - Added Cloudflare MCP wrapper documentation: `docs/cloudflare-mcp.md`.
  - Added Worker adapter tests covering `/health`, `/mcp`, OAuth metadata, bearer auth, origin checks, and in-memory isolate continuity.
  - Verification passed locally: `npm test`, 78/78 tests, and `git diff --check`.
  - GitHub handoff blocked until credits return: commit, push, open PR #9.

### 2026-08-16 - External-write blocker

- Status: Pending ClickUp sync
- Suggested location: project risk/blocker note
- Update text:
  - Workspace credits are exhausted, blocking escalated Git and external connector writes.
  - Local coding can continue.
  - Blocked external actions: Git commit/push, GitHub PR creation, ClickUp task/comment updates, dependency downloads, deployments.

### 2026-08-16 - Audit evidence projection implemented locally

- Status: Pending ClickUp sync
- Suggested location: Audit event log and evidence projection task
- Update text:
  - Added AuditFlow evidence projection module: `packages/auditflow-contracts/src/evidence.ts`.
  - Projection converts raw audit events into dashboard-ready lifecycle counts, workflow evidence, calculation versions, timeline items, open approval flags, recorded error flags, and blocked reasons.
  - Preserved `get_audit_report` as read-only: evidence projection reads existing events and does not mutate report state.
  - Added evidence projection tests: `tests/auditflow-evidence.test.ts`.
  - Updated README and roadmap to show audit event log and evidence projection as locally implemented.
  - Verification passed locally: `npm test`, 81/81 tests, and `git diff --check`.

### 2026-08-16 - Synthetic AuditFlow eval harness implemented locally

- Status: Pending ClickUp sync
- Suggested location: Synthetic audit evaluation harness task
- Update text:
  - Added AuditFlow eval harness: `packages/auditflow-contracts/src/evals.ts`.
  - Added approved ImpactWorks lead-to-proposal golden-path eval scenario.
  - Eval checks stable top opportunity, minimum scoreable workflows, expected annual net benefit floor, decision-ready report status, sprint-fit qualification, required lifecycle events, and absence of recorded errors.
  - Eval returns explicit pass/fail assertions plus the audit evidence projection for diagnostics.
  - Added eval tests: `tests/auditflow-evals.test.ts`.
  - Added docs: `docs/auditflow-evals.md`.
  - Updated README and roadmap to show synthetic audit evaluation harness as locally implemented.
  - Verification passed locally: `npm test`, 83/83 tests, and `git diff --check`.
