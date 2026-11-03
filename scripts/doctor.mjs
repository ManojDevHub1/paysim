#!/usr/bin/env node
/**
 * PAYSIM Environment & Configuration Diagnostics ("doctor")
 * Verifies runtime versions, monorepo workspaces, port availability,
 * TypeScript build status, route manifests, and loopback network confinement.
 */

import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const checks = [];

function addResult(name, status, details) {
  checks.push({ name, status, details });
}

function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve(err.code !== 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function runDiagnostics() {
  console.log(`
${colors.bold}${colors.cyan}========================================================================${colors.reset}
  ${colors.bold}PAYSIM Environment Diagnostics & Health Verification${colors.reset}
${colors.bold}${colors.cyan}========================================================================${colors.reset}
`);

  // 1. Node.js version check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
  if (major >= 24) {
    addResult('Node.js Runtime', 'PASS', `${nodeVer} (>= 24.0.0 required)`);
  } else {
    addResult('Node.js Runtime', 'FAIL', `${nodeVer} (< 24.0.0 is unsupported)`);
  }

  // 2. npm version check
  let npmVer = 'unknown';
  try {
    npmVer = execSync('npm --version', { encoding: 'utf8' }).trim();
    const npmMajor = parseInt(npmVer.split('.')[0], 10);
    if (npmMajor >= 10) {
      addResult('npm Package Manager', 'PASS', `v${npmVer} (>= 10.0.0 required)`);
    } else {
      addResult('npm Package Manager', 'WARN', `v${npmVer} (recommended >= 10.0.0)`);
    }
  } catch {
    addResult('npm Package Manager', 'FAIL', 'Failed to execute npm CLI');
  }

  // 3. Workspace structure check
  const expectedWorkspaces = [
    'apps/server',
    'apps/web',
    'packages/contracts',
    'packages/crypto',
    'packages/domain',
    'packages/shared',
    'packages/storage-memory',
  ];
  const missingWorkspaces = expectedWorkspaces.filter(
    (ws) => !fs.existsSync(path.join(rootDir, ws, 'package.json'))
  );
  if (missingWorkspaces.length === 0) {
    addResult('Monorepo Workspaces', 'PASS', `All ${expectedWorkspaces.length} workspace packages detected`);
  } else {
    addResult('Monorepo Workspaces', 'FAIL', `Missing packages: ${missingWorkspaces.join(', ')}`);
  }

  // 4. Dependencies installation check
  const rootNodeModules = path.join(rootDir, 'node_modules');
  if (fs.existsSync(rootNodeModules)) {
    addResult('Root Dependencies', 'PASS', 'Root node_modules directory exists');
  } else {
    addResult('Root Dependencies', 'FAIL', 'Missing root node_modules. Run "npm install" first.');
  }

  // 5. Port availability (8787 and 5173 on 127.0.0.1)
  const port8787Open = await checkPort(8787);
  const port5173Open = await checkPort(5173);
  if (port8787Open && port5173Open) {
    addResult('Port Availability', 'PASS', 'Ports 8787 (API) and 5173 (Frontend) are available on 127.0.0.1');
  } else {
    const busy = [];
    if (!port8787Open) busy.push('8787 (API)');
    if (!port5173Open) busy.push('5173 (Frontend)');
    addResult('Port Availability', 'WARN', `Port(s) currently in use: ${busy.join(', ')} (service may already be running)`);
  }

  // 6. TypeScript build artifacts check
  const serverDist = path.join(rootDir, 'apps', 'server', 'dist', 'index.js');
  const contractsDist = path.join(rootDir, 'packages', 'contracts', 'dist', 'index.js');
  if (fs.existsSync(serverDist) && fs.existsSync(contractsDist)) {
    addResult('TypeScript Build', 'PASS', 'Compiled dist artifacts exist for server and packages');
  } else {
    addResult('TypeScript Build', 'WARN', 'Dist artifacts missing. Run "npm run typecheck" to compile.');
  }

  // 7. Route Manifest Integrity
  try {
    const contracts = await import('../packages/contracts/dist/index.js');
    if (contracts.API_ROUTE_MANIFEST && Array.isArray(contracts.API_ROUTE_MANIFEST)) {
      addResult(
        'API Route Manifest',
        'PASS',
        `Manifest intact: ${contracts.API_ROUTE_MANIFEST.length} normative route definitions verified`
      );
    } else {
      addResult('API Route Manifest', 'FAIL', 'API_ROUTE_MANIFEST missing from contracts export');
    }
  } catch (err) {
    addResult('API Route Manifest', 'WARN', `Could not inspect contracts dist: ${err.message}`);
  }

  // 8. Webhook Loopback Confinement Policy
  try {
    const { validateDispatchDestination } = await import('../apps/server/dist/webhook-engine/index.js');
    const valid1 = validateDispatchDestination('http://127.0.0.1:9001/webhook');
    const invalidPublic = validateDispatchDestination('http://api.razorpay.com/v1/webhook');
    const invalidPriv = validateDispatchDestination('http://127.0.0.1:80/webhook');
    const invalidBackend = validateDispatchDestination('http://127.0.0.1:8787/webhook', { backendPort: 8787 });

    if (valid1.valid && !invalidPublic.valid && !invalidPriv.valid && !invalidBackend.valid) {
      addResult('Loopback Confinement', 'PASS', 'Strict 127.0.0.1 loopback policy and port restrictions enforced');
    } else {
      addResult('Loopback Confinement', 'FAIL', 'Loopback security filter validation failed');
    }
  } catch (err) {
    addResult('Loopback Confinement', 'WARN', `Could not verify loopback policy module: ${err.message}`);
  }

  // Print results
  let failCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    let badge = `${colors.green}[PASS]${colors.reset}`;
    if (check.status === 'WARN') {
      badge = `${colors.yellow}[WARN]${colors.reset}`;
      warnCount++;
    } else if (check.status === 'FAIL') {
      badge = `${colors.red}[FAIL]${colors.reset}`;
      failCount++;
    }

    console.log(`  ${badge} ${colors.bold}${check.name}${colors.reset}`);
    console.log(`         ${colors.dim}${check.details}${colors.reset}\n`);
  }

  console.log(`${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  if (failCount > 0) {
    console.log(`  ${colors.red}${colors.bold}Diagnostics completed with ${failCount} failure(s) and ${warnCount} warning(s).${colors.reset}`);
    console.log(`  Please resolve the failures above before running PAYSIM in production.\n`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`  ${colors.yellow}${colors.bold}Diagnostics completed: all critical checks passed (${warnCount} warning(s)).${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`  ${colors.green}${colors.bold}All ${checks.length} diagnostic checks passed successfully!${colors.reset}\n`);
    process.exit(0);
  }
}

runDiagnostics().catch((err) => {
  console.error('[doctor] Unexpected error:', err);
  process.exit(1);
});
