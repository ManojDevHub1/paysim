# PAYSIM — Final Gap Register (Phase 02 Baseline Closure)

**Document Version:** 1.0.0  
**Status:** All Critical Gaps Remediated — Architecture Baseline Locked  
**Current Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Auditor:** Principal Software Architect and Independent Technical Auditor  
**Date:** November 2026  

---

## 1. Executive Summary

This Final Gap Register provides the comprehensive accounting of all technical gaps, architectural ambiguities, normative contradictions, and security risks identified, analyzed, and resolved across the Phase 01 to Phase 02.1 lifecycle of PAYSIM.

All critical (P0) and high-priority (P1) issues have been formally resolved in the normative specification **PRD v2.3.0**, the **System Architecture Specification (v1.1.0)**, the **Architecture Decision Register (ADR-001 through ADR-010)**, and the **Final Architecture Audit Specification**. All remaining non-MVP features are cataloged with explicit deferral rationales.

---

## 2. Complete Discovered & Resolved Problems Catalog

| Gap ID | Severity | Problem Discovered | Resolution & Architectural Fix | Addressed In | Status |
|---|---|---|---|---|---|
| **GAP-01** | **CRITICAL** | Embedded checkout iframe fails to authenticate due to browser `SameSite` third-party cookie blocking | Dual-Authentication Scheme: capability exchange returns `sessionAccessToken`; iframe attaches `Authorization: Bearer <token>` on all internal API calls | PRD v2.3 Sec 5.9, 12.6; ADR-004 | **PASS** |
| **GAP-02** | **HIGH** | Iframe reload or modal reopen fails with 409 consumed error | Capability defined as session-bound bearer capability; exchange endpoint is idempotent during 15m session | PRD v2.3 Sec 5.9, 5.11; ADR-004 | **PASS** |
| **GAP-03** | **HIGH** | Residual text in Section 21.1 claimed capability expiry cancels `created` payments | Deleted contradictory sentence; confirmed capability expiry leaves payment `created` and emits zero events | PRD v2.3 Sec 5.11, 21.1; ADR-002 | **PASS** |
| **GAP-04** | **HIGH** | Compatibility raw secret retention undefined during asynchronous callback signing | Pinned credential version to payment attempt; retained in memory only while attempts are non-terminal; zeroized upon terminal capture | PRD v2.3 Sec 5.5, 18.3; ADR-003 | **PASS** |
| **GAP-05** | **MEDIUM** | Webhook endpoint mode update creates ambiguity for in-flight/retry deliveries | Mode is snapshotted per delivery; updates affect only new events and Replay; Retries use snapshotted mode | PRD v2.3 Sec 7.9, 11.4; ADR-006 | **PASS** |
| **GAP-06** | **MEDIUM** | Dynamic HTTP send timestamps in webhook retries break HMAC verification | Signed body contains strictly the canonical event timestamp; zero dynamic send timestamps in signed payload | PRD v2.3 Sec 11.2, 11.9; ADR-006 | **PASS** |
| **GAP-07** | **HIGH** | Docker & WSL container bridge IPs introduce SSRF vulnerability | Strictly rejected all private RFC 1918 subnets; enforced literal host loopback with published ports (`-p 127.0.0.1:P:P`) | PRD v2.3 Sec 5.7, 12.1; ADR-005 | **PASS** |
| **GAP-08** | **HIGH** | Idempotency snapshots risk leaking capability tokens across replay boundaries | Cached snapshots store token-free metadata; replaying returns reconstructed URL, 409 consumed, or 410 expired | PRD v2.3 Sec 10.6, 13.8; ADR-010 | **PASS** |
| **GAP-09** | **CRITICAL** | Unvalidated parent origin exposes checkout iframe to cross-origin framing | Mandated loopback `parentOrigin` at creation; injected into dynamic CSP `frame-ancestors`; enforced nonces | PRD v2.3 Sec 5.9, 12.6; ADR-009 | **PASS** |
| **GAP-10** | **MEDIUM** | Overstated Razorpay SDK compatibility causes integration failures | Scoped explicitly to Orders API & Standard Checkout patterns; unsupported routes return 501 | PRD v2.3 Sec 5.2, 9.2, 9.3; ADR-001 | **PASS** |
| **GAP-11** | **MEDIUM** | Delivery attempt outcome classification lacks clear distinction for redirect rejection | Classified 3xx as `redirect_rejected` outcome; client never follows redirects | PRD v2.3 Sec 11.6, 11.7, 12.3 | **PASS** |
| **GAP-12** | **HIGH** | Saturated in-memory queues cause unhandled server crashes | Enforced 100-job queue limit with visible `DELIVERY_QUEUE_FULL` rejected deliveries; domain commits preserved | PRD v2.3 Sec 11.11, 14, 17 | **PASS** |
| **GAP-13** | **HIGH** | Saturated memory storage triggers unsafe entity eviction | Implemented `RetentionCoordinator` with aggregate-safe cascading eviction; fails closed with 429 | PRD v2.3 Sec 14, 14.1, 17; ADR-007 | **PASS** |
| **GAP-14** | **HIGH** | Multi-credential isolation in compatibility mode allows cross-credential order inspection | Added internal `ownerCredentialId`; cross-credential requests return 404 NOT_FOUND | PRD v2.3 Sec 9.4, 13.1; ADR-008 | **PASS** |
| **GAP-15** | **CRITICAL** | Control plane login CSRF vulnerability on local loopback | Enforced SameSite cookie, Origin/Host validation, and memory-held `X-PaySim-CSRF` header | PRD v2.3 Sec 5.10, 10.4, 12.5 | **PASS** |
| **GAP-16** | **LOW** | Architecture documents referenced older PRD v2.2.0 baseline | Updated all architecture headers and cross-references to PRD v2.3.0 as sole normative baseline | System Architecture v1.1.0 | **PASS** |

---

## 3. Explicitly Deferred Features (Post-MVP Scope)

The following items are intentionally deferred to future versions and are non-blockers for Phase 03:

| Deferred Item | Classification | Deferral Rationale | Tracking Phase |
|---|---|---|---|
| **Multi-Tenant Project Workspaces** | Feature Enhancement | MVP is explicitly single-session local development. Multi-project isolation adds unnecessary overhead for local developer testing. | Phase 04 / Post-MVP |
| **Persistent SQLite / Disk Storage** | Feature Enhancement | MVP requires session-only storage to guarantee zero-leakage test runs and zero database setup. Clean state on restart is a core design feature. | Phase 04 / Post-MVP |
| **Simulated Payment Gateway Delay** | Feature Enhancement | Asynchronous timing delays are configurable via test harness; automated synthetic delays deferred to post-MVP polish. | Phase 04 / Post-MVP |
| **Refunds & Dispute Simulation** | Provider Feature | Core developer need is checkout capture and order fulfillment webhook testing. Refund APIs deferred to follow-on compatibility packs. | Phase 05 |
| **Custom Webhook Payload Templates** | Feature Enhancement | Native and Compatibility wire formats cover 100% of MVP testing use cases. Dynamic templating engine deferred. | Phase 05 |

---

## 4. Verification Classifications

In strict adherence to technical auditing standards:

- **PASS (16 Items):** All critical (P0) and high (P1) technical, architectural, and security gaps have been resolved with formal specifications, data contracts, and verification scenarios.
- **DEFERRED (5 Items):** Advanced post-MVP capabilities formally documented as non-goals for MVP release baseline.
- **NOT VERIFIED (3 Items):** Automated runtime test execution, live penetration testing, and third-party SDK binary testing cannot be certified during Phase 02 (as no application code has been implemented).

---

## 5. Architectural Closure Certification

This register certifies that all blocking architectural and technical risks have been resolved. The PAYSIM design is formally closed and sealed for Phase 03 implementation.
