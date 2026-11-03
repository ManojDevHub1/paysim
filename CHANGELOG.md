# Changelog

All notable changes to **PAYSIM** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-03 (Release Prepared)

### Added
- **Standard MIT License (`LICENSE`)**: Standard open-source MIT License approved by repository owner with copyright notice `Copyright (c) 2026 PAYSIM Contributors`.
- **Brand Assets & Multi-Resolution Favicons**: Master vector SVG icon, multi-resolution Microsoft ICO container (16/32/48 px), Apple Touch icon, and high-DPI manifest PNGs based on Concept V2 ("The Webhook Signal P").
- **GitHub Community & CI Automation**: Multi-OS GitHub Actions workflow (`.github/workflows/ci.yml`), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and issue/PR templates.
- **Release Documentation & Demonstration Storyboard**: Version 1.0.0 release notes (`docs/RELEASE_NOTES_v1.0.0.md`), maintainer checklist (`docs/RELEASE_CHECKLIST.md`), architecture diagrams (`docs/ARCHITECTURE_DIAGRAMS.md`), and 60–90 second demo storyboard (`docs/DEMO_STORYBOARD.md`).
- **One-Command Developer Startup (`npm run dev`)**: Launches Express API backend (`127.0.0.1:8787`) and Vite React frontend (`127.0.0.1:5173`) concurrently with pre-flight port checks, ASCII startup banner, multiplexed logging, and clean child-tree termination on Windows/POSIX without orphan processes.
- **Environment Diagnostics (`npm run doctor`)**: Validates Node.js (>= 24), npm, monorepo workspaces (7 packages), port availability, TypeScript build artifacts, API route manifest integrity (30 normative routes), and loopback network confinement.
- **Sample Webhook Receiver (`examples/node-webhook-receiver/`)**: Minimal, zero-dependency Node.js webhook receiver listening on `127.0.0.1:9001` demonstrating raw byte buffering, constant-time HMAC-SHA256 signature verification (`crypto.timingSafeEqual`) for both native and Razorpay-compat modes, and in-memory event deduplication.
- **Developer Quick Start Guide (`docs/QUICK_START.md`)**: Comprehensive 12-step walkthrough from repository cloning to order creation, simulation, webhook delivery, and signature verification with exact PowerShell and cmd syntax.
- **HTTP API Examples (`examples/api/`)**: Ready-to-run REST Client `.http` files for order creation, payment simulation, webhook configuration, event replaying, and manual delivery retries.
- **Outbound Webhook Delivery Engine (Phase 03.6)**: 5-worker concurrent delivery pool with immediate attempt dispatch, fixed retry backoff scheduling (Immediate, 500ms, 2000ms), manual retry quota enforcement (up to 3 manual retries), and payload body snapshot preservation (`DeliveryBodyVault`).
- **Developer Web Dashboard (Phase 03.5)**: React 18 + Vite dashboard with 9 full-featured views: Overview, Orders, Payments (with Simulation Lab), Checkout Sessions, Webhooks, Deliveries (with payload inspection and retry triggers), Canonical Events, Credentials, and Settings.
- **Express HTTP Transport Ingress (Phase 03.4)**: Express 4 server implementing all 30 concrete normative routes in `API_ROUTE_MANIFEST` plus 1 non-normative credentials alias, with RFC 9110 405 Method Not Allowed handling and centralized error management.
- **RootState Memory Storage Coordinator (Phase 03.3)**: Pure domain state machines with atomic multi-aggregate commit coordinator, 5-tier hierarchical locking, monotonic BigInt global event sequencing, and isolated cryptographic vaults (`WebhookSecretVault`, `DeliveryBodyVault`).
- **Frozen Contract Specifications (Phase 03.2)**: 12 Zod schema modules in `@paysim/contracts` defining domain entities, wire serialization formats, error catalogue, and route manifests.

### Security
- **Strict Loopback Confinement**: Outbound webhook dispatches strictly restricted to `127.0.0.1` and `[::1]` on unprivileged ports (1024–65535); dispatches to public IPs, cloud metadata, broadcast, and active server ports (8787, 5173) are blocked.
- **Secret Memory Containment & Zeroization**: Webhook secrets stored only in isolated `WebhookSecretVault` Buffers; wiped with `0x00` upon permanent delivery exhaustion.
- **Safe Bootstrap Token Disclosure**: Ephemeral bootstrap control token displayed once in terminal stdout at startup; never written to disk, config files, or environment dotfiles (SET-02/SET-03).
- **Public Contract Sanitization**: Webhook delivery API responses parsed strictly with `WebhookDeliveryEntitySchema` to strip internal attempt classification and scheduling metadata.
