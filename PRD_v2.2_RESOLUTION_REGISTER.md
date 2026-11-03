# PAYSIM PRD v2.2.0 — Resolution Register

**Date:** 3 November 2026  
**Normative source:** `PRD.md` (version 2.2.0)

| ID | Prior finding | Resolution in v2.2.0 | Normative sections | Required verification |
|---|---|---|---|---|
| V22-01 | Control login lacked a complete exchange contract | Added request/response, one-time consumption, cookie, CSRF, no-store and rate-limit behavior | 5.10, 10.4, 17, 21.9 | V22-01, V22-02 |
| V22-02 | Compatibility checkout creation route was unspecified | Added server-authenticated PAYSIM checkout-session extension | 6.3, 9.4, 9.5, 10.3, 21.9 | V22-04 |
| V22-03 | Compatibility order ownership was implicit | Added internal `ownerCredentialId`, never exposed in public DTOs | 9.4, 13.1 | V22-04 |
| V22-04 | Browser shim had no precise server-to-browser checkout URL handoff | Added `checkout_url`, bridge flow, parent-origin binding, same-origin iframe API calls and exact-origin messaging | 5.9, 6.3, 9.4, 9.8, 12.5–12.6 | V22-11, V22-12 |
| V22-05 | Compatibility secret retention after rotation did not cover attempts that outlive a checkout session | Retain signing secret in memory while linked payment attempts are non-terminal; reject old version for new requests | 5.5, 18.3 | V22-03 |
| V22-06 | Webhook endpoint mode not fully represented in endpoint CRUD acceptance | Require mode at creation and include it in PATCH/config version | 7.9, 10.4, 13.5 | V22-05 |
| V22-07 | Native and compatibility delivery serialization contradicted canonical event model | Canonical event is mode-neutral; deterministic serializer creates per-delivery body snapshot | 11.2, 11.4, 13.4–13.6 | V22-06, V22-07, V22-13 |
| V22-08 | Checkout expiry cancelled payment and conflicted with session reissue | Expiry invalidates capability only; payment remains created; reissue uses same payment ID and creates no second payment event | 5.11, 7.5, 8.4–8.5, 10.3, 10.8, 13.3, 17 | V22-08, V22-09, V22-10 |
| V22-09 | Idempotent create after checkout expiry had ambiguous status | Return `410 CHECKOUT_SESSION_EXPIRED` with existing payment ID and direct caller to reissue route | 10.6, 17 | V22-09 |
| V22-10 | Compatibility webhook fixture path/shape was unresolved | Added committed fixture files and declared them normative semantic contract references | 11.4, 15.3, `fixtures/` | V22-13 |
| V22-11 | Manual retry, endpoint mode and resource retention needed regression coverage | Added mandatory versioned test cases and acceptance conditions | 14, 21.9, 22 | V22-05–V22-14 |
| V22-12 | Compatibility shim options did not explicitly require local session URL | Added mandatory PAYSIM-specific `checkout_url`; key secret never goes to browser | 9.8 | V22-11 |

## Important behavior invariants

1. A checkout capability expiring is not a payment-state transition.
2. `payment.created` is emitted once per payment attempt, not once per checkout session.
3. Old compatibility credentials cannot authenticate new requests after rotation.
4. Existing attempts may finish callback signing with the credential version they were created under, while that secret version remains in the ephemeral vault.
5. Every webhook endpoint has exactly one wire mode; every delivery snapshots that mode.
6. Retry is byte-identical to the original delivery; Replay uses a new delivery snapshot and the selected endpoint's current mode.
7. The browser never receives a compatibility key secret, webhook secret, or checkout capability in query/referrer/logging channels.
8. Native and compatibility webhook fixtures are semantic reference objects; serializer tests must additionally verify deterministic exact UTF-8 bytes.

## Verification status

This register documents the required tests. It does not claim that those tests have been executed. No PAYSIM application source code is part of this PRD-only revision.

| V22-18 | Idempotency did not explicitly cover checkout-session creation/reissue | Extended idempotency to session resources, introduced parent payment references and token-free tombstones, and required new keys for reissue | 10.6, 13.8, 14 | V22-21, V22-22 |
| V22-19 | One-time capability exchange did not define how an iframe continues after token removal | Added HttpOnly, SameSite=Strict, path-scoped checkout-session cookie and verifier hash | 5.9, 12.6, 13.3, 18.3 | V22-19, V22-20 |
| V22-20 | Documentation incorrectly implied the parent JS could not inspect `checkout_url` | Explicitly documented the parent page trust boundary and prohibited only onward leakage through callbacks, messages, storage and logs | 5.9, 9.8, 12.6, 21.7 | V22-11, V22-12 |
