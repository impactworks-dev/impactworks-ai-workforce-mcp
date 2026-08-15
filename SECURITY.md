# Security Policy

## Current status

This project is pre-release and must not be used with production customer data.

## Reporting a vulnerability

Do not disclose security vulnerabilities in a public issue. Email `security@impactworks.com` with:

- A description of the issue
- Reproduction steps
- The affected component or commit
- The potential impact
- Any suggested mitigation

Do not include real customer data, access tokens, passwords, or other secrets.

## Security principles

- Tenant and user identity must come from verified authentication context.
- HTTP MCP requests must validate bearer access tokens before tool dispatch, including issuer, audience/resource binding, expiration, scopes, and tenant/user claims.
- MCP servers must not accept token passthrough from unrelated resources or forward inbound access tokens to downstream services.
- Repositories must perform tenant checks even when middleware already authenticated the request.
- Access is least-privilege, capability-scoped, and revocable.
- Consequential actions require explicit policy and approval handling.
- Logs must exclude tokens, passwords, sensitive free text, and full tool payloads.
- Stored assumptions and results retain their formula and policy versions.
- Every production capability requires an owner, audit trail, off switch, and recovery path.
