import {
  RESTRICTED_LOOPBACK_PORTS,
  MIN_LOOPBACK_PORT,
  MAX_LOOPBACK_PORT,
  type RuntimeListenerConfig,
} from '@paysim/contracts';

export interface DispatchDestinationValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly port?: number;
  readonly hostname?: string;
}

/**
 * Validates outbound socket destination immediately prior to dispatch.
 * Enforces strict, zero-trust literal loopback policy per PRD Section 12, ADR-005,
 * and Phase 03.6 Security Confinement.
 *
 * Security Requirements:
 * 1. Accepts ONLY literal loopback IPs: "127.0.0.1" or "[::1]".
 * 2. Strictly rejects "localhost", all DNS hostnames, and ".local" domains.
 * 3. Strictly rejects private LAN ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
 * 4. Strictly rejects link-local and cloud metadata IPs (169.254.0.0/16).
 * 5. Strictly rejects alternate IP notations (hex, octal, dword numeric).
 * 6. Strictly rejects IPv4-mapped IPv6 representations (e.g. "[::ffff:127.0.0.1]").
 * 7. Strictly rejects URL credentials (userinfo) and URL fragments.
 * 8. Rejects unsupported schemes (must be http: or https:).
 * 9. Rejects privileged system ports (<1024) and ports outside [1024, 65535].
 * 10. Rejects active PAYSIM listener port (8787 default or runtime config).
 * 11. Rejects frontend development server port (5173 default or runtime config).
 * 12. Rejects sensitive daemon ports (2375, 2376, 4243, 5000).
 */
export function validateDispatchDestination(
  rawUrl: string,
  runtimeConfig?: RuntimeListenerConfig
): DispatchDestinationValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'Destination URL must be a non-empty string' };
  }

  // 1. Pre-URL parse check: reject non-standard numeric notations (octal, hex, dword)
  // e.g. "0x7f", "0177", pure integer IP notations in host segment
  const trimmed = rawUrl.trim();
  const hostMatch = trimmed.match(/^https?:\/\/([^/?#:]+)/i);
  if (hostMatch && hostMatch[1]) {
    const rawHost = hostMatch[1];
    // Reject hex representations (0x...) or octal (leading 0 before digits in octet)
    if (/0x[0-9a-fA-F]/i.test(rawHost) || /\b0[0-7]{2,}\b/.test(rawHost)) {
      return {
        valid: false,
        error: 'Alternate numeric IP representations (hex/octal) are strictly rejected.',
      };
    }
    // Reject pure integer IP representations (e.g. 2130706433)
    if (/^\d+$/.test(rawHost)) {
      return {
        valid: false,
        error: 'Dword / integer numeric IP representations are strictly rejected.',
      };
    }
  }

  try {
    const u = new URL(trimmed);

    // 2. Strict scheme check
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return {
        valid: false,
        error: `Unsupported protocol '${u.protocol}'. Must be plain http: or https:.`,
      };
    }

    // 3. Reject credentials in URLs
    if (u.username || u.password) {
      return {
        valid: false,
        error: 'Webhook URLs must not contain embedded user credentials (userinfo).',
      };
    }

    // 4. Reject URL fragments
    if (u.hash) {
      return {
        valid: false,
        error: 'Webhook URLs must not contain URL fragments.',
      };
    }

    // 5. Strict literal loopback IP check: must be exact "127.0.0.1" or "[::1]"
    // Rejects "localhost", IPv4-mapped IPv6, zone IDs, LAN, WAN, and DNS hostnames
    const isLiteralLoopback = u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (!isLiteralLoopback) {
      return {
        valid: false,
        error: `Hostname '${u.hostname}' is rejected. Outbound destinations must strictly be literal loopback IP ('127.0.0.1' or '[::1]'). DNS names, localhost, LAN, and public IPs are prohibited.`,
      };
    }

    // 6. Mandatory explicit numeric port
    let port: number;
    if (u.port) {
      port = Number(u.port);
    } else {
      // Check if raw URL had explicit :80 or :443 that WHATWG URL normalized to empty string
      const explicitPortMatch = trimmed.match(/:(\d+)(?:[/?#]|$)/);
      if (explicitPortMatch && explicitPortMatch[1]) {
        port = Number(explicitPortMatch[1]);
      } else {
        return {
          valid: false,
          error: 'Explicit numeric port is required for loopback destinations.',
        };
      }
    }

    if (!Number.isInteger(port) || port < MIN_LOOPBACK_PORT || port > MAX_LOOPBACK_PORT) {
      return {
        valid: false,
        error: `Port ${port} must be within the unprivileged range [${MIN_LOOPBACK_PORT}, ${MAX_LOOPBACK_PORT}]. Privileged system ports (<1024) are prohibited.`,
      };
    }

    // 7. Check dynamic runtime-configured listener ports
    if (runtimeConfig) {
      if (runtimeConfig.backendPort && port === runtimeConfig.backendPort) {
        return {
          valid: false,
          error: `Port ${port} matches the active backend listener port. Delivery to self is prohibited.`,
        };
      }
      if (runtimeConfig.frontendPort && port === runtimeConfig.frontendPort) {
        return {
          valid: false,
          error: `Port ${port} matches the active frontend UI listener port.`,
        };
      }
      if (runtimeConfig.additionalRestrictedPorts?.includes(port)) {
        return {
          valid: false,
          error: `Port ${port} is designated as an internal restricted port.`,
        };
      }
    }

    // 8. Check static restricted ports (PAYSIM defaults and sensitive daemons)
    if ((RESTRICTED_LOOPBACK_PORTS as readonly number[]).includes(port)) {
      return {
        valid: false,
        error: `Port ${port} is restricted to prevent delivery loops or local daemon exploitation (Docker/PAYSIM internal).`,
      };
    }

    return { valid: true, port, hostname: u.hostname };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid URL structure',
    };
  }
}
