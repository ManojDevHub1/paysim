# PAYSIM PRD v2.2.0 — Validation Report

**Date:** 3 November 2026  
**Scope:** Documentation and fixture consistency only; no application implementation was executed.

## Checks performed

| Check | Result |
|---|---|
| PRD version/header consistency | PASS — normative document declares v2.2.0 |
| Numbered H1 sections | PASS — sections 1 through 30 appear once and in order |
| Checkout expiry semantics | PASS — capability expiry does not cancel payment or emit payment events |
| Native/Compatibility checkout reissue routes | PASS — both routes are specified; reissue preserves payment ID |
| Control-token exchange contract | PASS — request, response, one-time consumption, cookie, CSRF and rate-limit behavior are documented |
| Compatibility ownership binding | PASS — order ownership is internal and exposed only through authorization decisions |
| Webhook endpoint mode | PASS — required, editable, versioned, and snapshotted per delivery |
| Event serialization | PASS — canonical event is mode-neutral; per-delivery deterministic serializer is specified |
| Retry/Replay distinction | PASS — Retry preserves exact bytes; Replay serializes for selected endpoint's current mode |
| HTTP status/error catalogue | PASS — consumed capability is 409; expired/revoked capability is 410 |
| Fixture JSON parsing | PASS — native and compatibility semantic fixtures parse |
| Exact byte fixtures | PASS — compact `.body.json` files match deterministic sorted-key JSON serialization exactly, without trailing newline |
| Archive preservation | PASS — v1.0, v2.0 and v2.1 archives are present |

## Automated fixture verification

The semantic fixture objects are parsed and serialized with recursively sorted keys, compact JSON separators, UTF-8 encoding, and no trailing newline. The produced bytes match each committed `payment.captured.body.json` fixture exactly.

## Not performed

- TypeScript compilation
- Unit, integration, browser, end-to-end, or security tests against running code
- API contract tests against an implementation
- Node.js runtime compatibility execution
- Build, lint, or package installation

## Important status

PRD v2.2.0 is a detailed implementation specification, not a completed or tested PAYSIM application. Do not claim the product is implemented until the release gates in `PRD.md` have been executed against source code.
