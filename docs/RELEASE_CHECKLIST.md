# PAYSIM v1.0.0 — Maintainer Release Checklist

> **Step-by-Step Release Verification and Publication Procedure**
> **Version Target:** `v1.0.0`
> **Audience:** Repository Maintainers & Release Managers

---

## 1. Pre-Flight Quality Gates

Before tagging or publishing a release, execute all local verification scripts from a clean working environment:

```bash
# 1. Verify environment and port availability
npm run doctor
# Requirement: All 8 checks return [PASS]

# 2. Verify TypeScript static compilation
npm run typecheck
# Requirement: Exit code 0, zero diagnostic errors

# 3. Verify ESLint static analysis
npm run lint
# Requirement: Exit code 0, zero errors and zero warnings

# 4. Execute the complete automated test suite
npm test
# Requirement: All 541 tests pass across 48 suites

# 5. Verify production bundle compilation
npm run build
# Requirement: Exit code 0, apps/web/dist compiled with favicon assets

# 6. Verify reproducible clean installation and live webhook dispatch
node scripts/verify-fresh-checkout.mjs
# Requirement: Exit code 0, lockfile SHA-256 unchanged, 100% test drive success
```

---

## 2. Boundary & Immutability Verification

Ensure that the core architectural boundaries have remained strictly uncompromised:

- [ ] **Frozen Contracts**: Run `git diff packages/contracts/`.
  *Acceptance Criteria:* Diff must be 100% empty (0 lines modified).
- [ ] **No Secret Leaks**: Ensure no `.env`, `.env.local`, or secret tokens exist in the repository.
- [ ] **No Orphan Background Processes**: Verify ports `8787` and `5173` are released.
- [ ] **Loopback Confinement**: Outbound HTTP sockets strictly restricted to `127.0.0.1:[1024-65535]`.

---

## 3. Legal & Metadata Verification

- [ ] **Approved License**: [`LICENSE`](../LICENSE) contains standard MIT License text.
- [ ] **Copyright Notice**: Candidate notice `Copyright (c) 2026 PAYSIM Contributors` (pending explicit repository-owner confirmation).
- [ ] **Package Manifests**: Root and all workspace packages specify `"version": "1.0.0"` and `"license": "MIT"`.
- [ ] **No Contradictory Licenses**: Repository sources contain zero conflicting proprietary or GPL declarations.

---

## 4. Documentation & Community Assets

- [ ] **README**: [`README.md`](../README.md) reflects current version, actual screenshots, architecture diagrams, and limitation disclaimers.
- [ ] **Changelog**: [`CHANGELOG.md`](../CHANGELOG.md) documents all added features under `[1.0.0] - 2026-11-03`.
- [ ] **Release Notes**: [`docs/RELEASE_NOTES_v1.0.0.md`](RELEASE_NOTES_v1.0.0.md) is complete and accurate.
- [ ] **Community Files**: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `.github/` templates are verified.
- [ ] **Screenshots Directory**: All 7 real screenshots exist in [`docs/screenshots/`](screenshots/).

---

## 5. Release Publication Execution (Repository Owner Only)

*Note: These steps are performed by the human repository owner. Automated agents must never tag or push releases.*

```bash
# 1. Review all modified and untracked files
git status

# 2. Stage verified release files
git add .

# 3. Create release commit
git commit -m "chore(release): prepare v1.0.0 [skip ci]"

# 4. Create annotated release tag
git tag -a v1.0.0 -m "PAYSIM v1.0.0 — Local Payment Simulator & Webhook Laboratory"

# 5. Push commit and tag to GitHub remote
git push origin master --tags

# 6. Create GitHub Release
# - Title: PAYSIM v1.0.0 — Local Payment Simulator & Webhook Testing Laboratory
# - Tag: v1.0.0
# - Description: Paste contents of docs/RELEASE_NOTES_v1.0.0.md
```
