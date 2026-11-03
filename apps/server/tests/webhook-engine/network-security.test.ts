import { describe, it, expect } from 'vitest';
import { validateDispatchDestination } from '../../src/webhook-engine/dispatcher-security.js';

describe('Webhook Dispatcher — Network Security & Loopback Confinement (Phase 03.6)', () => {
  describe('1. Approved Loopback Destinations', () => {
    it('accepts literal 127.0.0.1 with unprivileged port', () => {
      const res = validateDispatchDestination('http://127.0.0.1:9000/webhook');
      expect(res.valid).toBe(true);
      expect(res.port).toBe(9000);
      expect(res.hostname).toBe('127.0.0.1');
    });

    it('accepts literal [::1] IPv6 loopback with unprivileged port', () => {
      const res = validateDispatchDestination('http://[::1]:9000/webhook');
      expect(res.valid).toBe(true);
      expect(res.port).toBe(9000);
      expect(res.hostname).toBe('[::1]');
    });

    it('accepts https on approved loopback', () => {
      const res = validateDispatchDestination('https://127.0.0.1:8443/webhook');
      expect(res.valid).toBe(true);
      expect(res.port).toBe(8443);
    });
  });

  describe('2. Hostname & DNS Rejection (Zero-Trust Loopback)', () => {
    it('strictly rejects localhost', () => {
      const res = validateDispatchDestination('http://localhost:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Hostname \'localhost\' is rejected');
    });

    it('strictly rejects public DNS hostnames', () => {
      const res = validateDispatchDestination('http://example.com:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('is rejected');
    });

    it('strictly rejects local domain names (.local, .test, .internal)', () => {
      const res = validateDispatchDestination('http://my-service.local:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('is rejected');
    });
  });

  describe('3. IP Family, LAN, and Cloud Metadata Rejection', () => {
    it('strictly rejects RFC 1918 private LAN 10.0.0.0/8', () => {
      const res = validateDispatchDestination('http://10.0.0.1:9000/webhook');
      expect(res.valid).toBe(false);
    });

    it('strictly rejects RFC 1918 private LAN 172.16.0.0/12', () => {
      const res = validateDispatchDestination('http://172.16.0.1:9000/webhook');
      expect(res.valid).toBe(false);
    });

    it('strictly rejects RFC 1918 private LAN 192.168.0.0/16', () => {
      const res = validateDispatchDestination('http://192.168.1.1:9000/webhook');
      expect(res.valid).toBe(false);
    });

    it('strictly rejects link-local and cloud metadata 169.254.169.254', () => {
      const res = validateDispatchDestination('http://169.254.169.254:9000/latest/meta-data');
      expect(res.valid).toBe(false);
    });

    it('strictly rejects public WAN IPs', () => {
      const res = validateDispatchDestination('http://8.8.8.8:9000/webhook');
      expect(res.valid).toBe(false);
    });

    it('strictly rejects IPv4-mapped IPv6 [::ffff:127.0.0.1]', () => {
      const res = validateDispatchDestination('http://[::ffff:127.0.0.1]:9000/webhook');
      expect(res.valid).toBe(false);
    });
  });

  describe('4. Alternate Numeric IP Representation Rejection', () => {
    it('strictly rejects hex notation (0x7f.0.0.1)', () => {
      const res = validateDispatchDestination('http://0x7f.0.0.1:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Alternate numeric IP representations');
    });

    it('strictly rejects octal notation (0177.0.0.1)', () => {
      const res = validateDispatchDestination('http://0177.0.0.1:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Alternate numeric IP representations');
    });

    it('strictly rejects dword integer notation (2130706433)', () => {
      const res = validateDispatchDestination('http://2130706433:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Dword / integer numeric IP representations');
    });
  });

  describe('5. Port & Scheme Restrictions', () => {
    it('strictly rejects privileged system ports (<1024)', () => {
      const res80 = validateDispatchDestination('http://127.0.0.1:80/webhook');
      expect(res80.valid).toBe(false);
      expect(res80.error).toContain('unprivileged range');

      const res443 = validateDispatchDestination('http://127.0.0.1:443/webhook');
      expect(res443.valid).toBe(false);
    });

    it('strictly rejects default PAYSIM listener port (8787)', () => {
      const res = validateDispatchDestination('http://127.0.0.1:8787/api/v1');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Port 8787 is restricted');
    });

    it('strictly rejects default Vite frontend UI port (5173)', () => {
      const res = validateDispatchDestination('http://127.0.0.1:5173/');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Port 5173 is restricted');
    });

    it('strictly rejects sensitive local daemon ports (Docker 2375, 2376, 4243, 5000)', () => {
      expect(validateDispatchDestination('http://127.0.0.1:2375/').valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:2376/').valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:4243/').valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:5000/').valid).toBe(false);
    });

    it('strictly rejects dynamic runtime backend listener port', () => {
      const res = validateDispatchDestination('http://127.0.0.1:9898/hook', { backendPort: 9898 });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('matches the active backend listener port');
    });

    it('strictly rejects missing port in URL', () => {
      const res = validateDispatchDestination('http://127.0.0.1/hook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Explicit numeric port is required');
    });

    it('strictly rejects non-HTTP protocols (ftp, file, gopher, ws)', () => {
      expect(validateDispatchDestination('ftp://127.0.0.1:9000/').valid).toBe(false);
      expect(validateDispatchDestination('ws://127.0.0.1:9000/').valid).toBe(false);
      expect(validateDispatchDestination('file:///etc/passwd').valid).toBe(false);
    });
  });

  describe('6. Credentials & Fragments Rejection', () => {
    it('strictly rejects embedded userinfo / credentials in URL', () => {
      const res = validateDispatchDestination('http://user:pass@127.0.0.1:9000/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('user credentials');
    });

    it('strictly rejects URL fragments in destination URL', () => {
      const res = validateDispatchDestination('http://127.0.0.1:9000/webhook#token');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('URL fragments');
    });
  });
});
