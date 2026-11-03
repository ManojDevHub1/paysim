# Security Policy

## 1. Security Architecture & Threat Model

PAYSIM is a local-first payment simulator and webhook testing laboratory designed to run strictly on developer workstations. It is **not** a production payment processor and does not hold real credit card numbers, live UPI VPAs, or real banking credentials.

### Critical Security Boundaries

1. **Loopback Confinement**:
   - Outbound HTTP webhook dispatches are strictly confined to `127.0.0.1` and `[::1]` on ports `1024` through `65535`.
   - The delivery engine rejects socket creation to public IPs, cloud metadata IP addresses (`169.254.169.254`), broadcast addresses, and active server listener ports (e.g., 8787, 5173).
2. **In-Memory Vault Isolation & Zeroization**:
   - Webhook signing secrets and delivery snapshots are isolated in memory within `WebhookSecretVault` and `DeliveryBodyVault`.
   - Signing secrets are scrubbed with zeroes (`0x00`) in volatile memory upon permanent delivery exhaustion.
3. **Zero Secrets Persistence**:
   - The one-time bootstrap control token is generated in volatile RAM at startup and disclosed exclusively via terminal stdout.
   - It is never written to disk, config files, dotfiles, or browser local storage (SET-02/SET-03).
4. **Contract Response Sanitization**:
   - Public delivery API endpoints sanitize domain records through `WebhookDeliveryEntitySchema` to prevent leaking internal scheduler or attempt metadata.

---

## 2. Supported Versions

Security fixes and patches are applied to the active major release line:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## 3. Reporting a Vulnerability

We take the security of PAYSIM and the developer environments that run it seriously.

If you discover a security vulnerability, please report it responsibly:

1. **Do not create a public GitHub issue.**
2. Report the vulnerability privately via **GitHub Private Vulnerability Reporting**:
   - Navigate to the **Security** tab of this repository on GitHub.
   - Click on **Report a vulnerability** to open an advisory draft.
3. If Private Vulnerability Reporting is unavailable, contact the repository maintainers through official repository administrative channels.

### What to Include in Your Report

To help us triage and resolve the issue quickly, please include:
- A clear description of the vulnerability and its potential impact.
- Exact steps to reproduce the issue (including sample code, payloads, or configuration).
- The operating system, Node.js version, and PAYSIM version where the issue was observed.
- Any suggested remediations or mitigations.

### Our Commitment

- We will acknowledge receipt of your vulnerability report within 48 hours.
- We will provide a timeline for triage and resolution.
- We will coordinate public disclosure through a GitHub Security Advisory once a patched release is published.
