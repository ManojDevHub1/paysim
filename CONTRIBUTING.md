# Contributing to PAYSIM

Thank you for your interest in contributing to **PAYSIM**! We welcome community contributions to improve our local payment simulator and webhook testing laboratory.

---

## 1. Code of Conduct

All contributors and maintainers are expected to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating in discussions or submitting pull requests.

---

## 2. Architectural Principles & Invariants

Before making code changes, please familiarize yourself with PAYSIM's architectural commitments:

1. **Local-First & Loopback Only**: PAYSIM is designed to run exclusively on loopback interfaces (`127.0.0.1` and `[::1]`). Outbound webhook dispatches to external public IP addresses or cloud metadata endpoints are strictly blocked by design.
2. **Zero Databases / Pure In-Memory**: PAYSIM maintains all state in-memory via pure domain state machines and the `CommitCoordinator`. No external database (SQL or NoSQL) may be introduced as a runtime dependency.
3. **Frozen Contracts Integrity**: Schemas in `packages/contracts/` represent frozen API and domain specifications. Changes to existing contract schemas require formal Architectural Decision Register (ADR) approval to prevent breaking changes.
4. **Zero Persistent Secrets**: The one-time bootstrap control token is generated in volatile RAM at startup and disclosed solely via terminal stdout. It must never be written to disk, dotfiles, or browser local storage.
5. **No External Payment Processing**: PAYSIM is a simulator. It does not and will never connect to live banking networks or process real funds.

---

## 3. Monorepo Structure

PAYSIM is structured as an npm workspaces monorepo:

| Directory | Role | Description |
|-----------|------|-------------|
| `packages/contracts` | Contracts | Frozen Zod schemas, API route manifests, and domain types |
| `packages/domain` | Domain | Pure, deterministic payment, order, and simulation state machines |
| `packages/storage-memory` | Storage | In-memory `RootState`, hierarchical locking, and cryptographic vaults |
| `packages/crypto` | Cryptography | Timing-safe HMAC calculation and memory buffer zeroization |
| `packages/shared` | Shared | Prefixed ID generators (`ord_ps_...`, `pay_ps_...`) and JSON utilities |
| `apps/server` | Backend | Express 4 HTTP server, middleware pipeline, and webhook worker pool |
| `apps/web` | Frontend | React 18 + Vite developer dashboard, event inspector, and simulation lab |
| `examples/` | Examples | Sample zero-dependency webhook receivers and `.http` API request files |
| `scripts/` | Tooling | Orchestrators (`dev.mjs`, `start.mjs`), diagnostics (`doctor.mjs`), and asset pipelines |

---

## 4. Local Development Setup

### Prerequisites
- **Node.js**: `v24.0.0` or higher (`node -v`)
- **npm**: `v10.0.0` or higher (`npm -v`)

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/paysim.git
cd paysim

# 2. Install dependencies across all workspaces
npm ci

# 3. Verify local environment diagnostics
npm run doctor

# 4. Start the development server and dashboard
npm run dev
```

The frontend dashboard will be accessible at `http://127.0.0.1:5173` and the backend API at `http://127.0.0.1:8787`.

---

## 5. Quality Verification & Testing

Every pull request must pass all quality gates before being merged:

```bash
# 1. Typecheck: Verify TypeScript compilation across all packages
npm run typecheck

# 2. Lint: Run ESLint across monorepo
npm run lint

# 3. Test Suite: Execute all Vitest unit and integration tests
npm test

# 4. Production Build: Compile server packages and frontend bundle
npm run build
```

---

## 6. Pull Request Process

1. **Branch Naming**: Use descriptive branch names:
   - `fix/short-description` for bug fixes
   - `feat/short-description` for new features or capabilities
   - `docs/short-description` for documentation updates
2. **Commit Messages**: Write clear, imperative commit messages (e.g., `fix(webhook): handle timing edge case in delivery queue`).
3. **Tests Required**: Every bug fix or new feature must be accompanied by comprehensive Vitest unit and/or integration tests.
4. **PR Checklist**: Complete all items in the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
5. **No Contract Breakage**: Ensure `git diff packages/contracts/` remains completely clean unless explicitly addressing an approved contract change.

---

## 7. Reporting Bugs & Requesting Features

- **Bugs**: Please use our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.yml) and include Node.js version, OS, reproduction steps, and diagnostic output (`npm run doctor`).
- **Feature Requests**: Please use our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.yml) and describe the motivation, developer workflow, and alternative approaches.
- **Security Vulnerabilities**: Do **not** report security vulnerabilities via public GitHub issues. See our [Security Policy](SECURITY.md) for responsible disclosure.
