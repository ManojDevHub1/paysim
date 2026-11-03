# PAYSIM PRD v2.3.0 — Resolution Register

**Date:** 3 November 2026  
**Document Status:** Normative Traceability Register  
**Normative Source:** `PRD_v2.3.md` (version 2.3.0)  
**Historical Predecessor:** `PRD_v2.2_RESOLUTION_REGISTER.md`  

---

## Purpose

This Resolution Register maps all 15 critical technical audit findings from Phase 02.1 to their normative PRD v2.3.0 sections and mandatory verification scenarios (`V23-01` through `V23-25`).

---

## Audit Finding to Requirement to Test Mapping

| Finding ID | Audit Finding | Resolution in PRD v2.3.0 | Normative Sections | Required Verification |
|---|---|---|---|---|
| **AUD-01** | Cross-origin embedded iframe authentication fails due to SameSite cookie restrictions | Replaced cookie-only auth with Dual-Auth scheme: capability exchange returns `sessionAccessToken` for `Bearer` transport | 5.9, 12.6, 13.3 | **V23-01** |
| **AUD-02** | Iframe reload or modal reopen fails with 409 consumed error | Capability defined as session-bound bearer capability; exchange route is idempotent during active 15m session | 5.9, 5.11, 10.6, 13.3 | **V23-02** |
| **AUD-03** | Section 21.1 contradiction claiming capability expiry cancels payment | Eliminated stale sentence; confirmed capability expiry leaves payment `created` and emits zero events | 5.11, 7.5, 8.4, 8.5, 21.1 | **V23-03** |
| **AUD-04** | Compatibility key rotation secret retention scope undefined | Pin key version to attempt; retain raw secret in memory until all linked attempts are terminal, then zeroize | 5.5, 13.2, 18.3 | **V23-04** |
| **AUD-05** | Webhook endpoint mode update creates ambiguity for in-flight/retry deliveries | Mode is snapshotted per delivery; updates affect only new events and Replay; Retries use snapshotted mode | 7.9, 11.4, 13.5, 13.6 | **V23-05** |
| **AUD-06** | Dynamic HTTP send timestamps in webhook retries break HMAC verification | Signed body contains only canonical event timestamp; zero dynamic send timestamps in signed payload | 11.2, 11.3, 11.4, 11.9 | **V23-06** |
| **AUD-07** | Docker/WSL container bridge IPs introduce SSRF vulnerability | Strictly reject all private RFC 1918 subnets; enforce literal host loopback with published ports (`-p 127.0.0.1:P:P`)| 5.7, 12.1, 12.4 | **V23-07** |
| **AUD-08** | Idempotency snapshots risk leaking capability tokens across replay boundaries | Store token-free snapshots; replaying returns reconstructed URL, 409 consumed, or 410 expired | 10.6, 13.8, 14 | **V23-08** |
| **AUD-09** | Unvalidated parent origin exposes checkout iframe to cross-origin framing | Mandate loopback `parentOrigin` at creation; inject into CSP `frame-ancestors`; enforce nonces | 5.9, 12.6, 21.9 | **V23-09** |
| **AUD-10** | Overstated Razorpay SDK compatibility causes integration failures | Scoped explicitly to Orders API & Standard Checkout patterns; unsupported routes return 501 | 5.2, 9.2, 9.3, 9.4 | **V23-10** |
| **AUD-11** | Delivery attempt outcome classification lacks clear distinction for redirect rejection | Classified 3xx as `redirect_rejected` outcome; client never follows redirects | 11.6, 11.7, 12.3 | **V23-11** |
| **AUD-12** | Saturated in-memory queues cause unhandled server crashes | Enforced 100-job queue limit with visible `DELIVERY_QUEUE_FULL` rejected deliveries; domain commits preserved | 11.11, 14, 17 | **V23-12** |
| **AUD-13** | Saturated memory storage triggers unsafe entity eviction | Implemented `RetentionCoordinator` with aggregate-safe cascading eviction; fails closed with 429 | 14, 14.1, 17 | **V23-13** |
| **AUD-14** | Multi-credential isolation in compatibility mode allows cross-credential order inspection | Added internal `ownerCredentialId`; cross-credential requests return 404 NOT_FOUND | 9.4, 13.1 | **V23-14** |
| **AUD-15** | Control plane login CSRF vulnerability on local loopback | Enforced SameSite cookie, Origin/Host validation, and memory-held `X-PaySim-CSRF` header | 5.10, 10.4, 12.5 | **V23-15** |

---

## Regression Test Scenario Specifications (V23-01 through V23-25)

| Test ID | Scenario | Verification Criteria |
|---|---|---|
| **V23-01** | Embedded iframe API call in third-party context | Authenticates successfully using `Authorization: Bearer <sessionAccessToken>` without sending cookies |
| **V23-02** | Iframe reload / modal reopen with same capability token | Returns 200 with valid `sessionAccessToken`; does not emit duplicate events |
| **V23-03** | Capability expiration on `created` payment | Session marked `expired`; payment remains `created`; order remains `attempted`; zero events emitted |
| **V23-04** | Compatibility key rotation while payment is `created` | New Basic auth with old key fails (`401`); synthetic callback HMAC signs successfully with pinned version |
| **V23-05** | Mutating endpoint mode from Native to Compat | In-flight Native delivery retries with Native bytes; new events serialize with Compatibility envelope |
| **V23-06** | Webhook delivery retry byte preservation | Serialized body bytes, SHA-256 digest, and HMAC signature on Retry 2 match Attempt 1 bit-for-bit |
| **V23-07** | Registering private Docker bridge IP (`172.17.0.2`) | Rejected immediately with `422 WEBHOOK_URL_REJECTED` |
| **V23-08** | Idempotent replay of checkout creation key after expiry | Returns `410 CHECKOUT_SESSION_EXPIRED` with existing `paymentId`; directs caller to reissue |
| **V23-09** | Embedding checkout in unauthorized parent origin | Blocked by browser via CSP `frame-ancestors` matching registered `parentOrigin` |
| **V23-10** | Calling unsupported Razorpay route (`/v1/refunds`) | Returns `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED` |
| **V23-11** | Webhook target responds with 302 redirect | Classified as `redirect_rejected` outcome; redirect target is not contacted |
| **V23-12** | Submitting event when delivery queue has 100 jobs | Creates delivery in `rejected` status with `DELIVERY_QUEUE_FULL`; domain commit succeeds |
| **V23-13** | Storage saturation with unexpired idempotency records | Order aggregate protected from eviction; new request rejected with `429 RESOURCE_LIMIT_REACHED` |
| **V23-14** | Compatibility fetch of another credential's order | Returns `404 NOT_FOUND` |
| **V23-15** | Control API mutating POST without `X-PaySim-CSRF` | Returns `403 CSRF_INVALID` |
| **V23-16** | Reissuing checkout session for `created` payment | Returns new session URL with new capability token; payment ID preserved; zero duplicate events |
| **V23-17** | Reissuing checkout session for `captured` payment | Rejected with `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` |
| **V23-18** | Native webhook fixture byte verification | Serializer output matches `fixtures/events-native/payment.captured.body.json` (293 bytes) |
| **V23-19** | Compatibility webhook fixture byte verification | Serializer output matches `fixtures/events-compat/payment.captured.body.json` (333 bytes) |
| **V23-20** | Secret scrubbing in server logs | Log inspection confirms headers, cookies, and secret keys are replaced with `[REDACTED]` |
| **V23-21** | Capability token fragment stripping in browser | `window.location.hash` wiped immediately via `replaceState` after reading token |
| **V23-22** | Nonce verification in checkout iframe handshake | Handshake with mismatched nonce is ignored; no state change occurs |
| **V23-23** | Graceful shutdown delivery interruption | Active outbound sockets aborted; attempt marked `interrupted_unknown`; delivery marked `interrupted` |
| **V23-24** | Manual retry budget enforcement | Delivery permits at most 3 manual retries; 4th retry returns `429 RATE_LIMITED` |
| **V23-25** | One-time dashboard control token consumption | Replayed control token returns `401 CONTROL_TOKEN_INVALID` |

---

## Invariant Summary

1. Checkout capability expiration is an invalidation of the capability token only; it never cancels a payment.
2. Cross-origin embedded iframes authenticate via in-memory `sessionAccessToken` bearer transport.
3. Every webhook delivery snapshots its wire mode, exact body bytes, and secret version at creation time.
4. Old compatibility key secrets remain in memory only while linked attempts are non-terminal; they are purged immediately when all linked attempts become terminal.
5. All outbound webhook requests are strictly confined to literal loopback addresses (`127.0.0.1` and `[::1]`).
