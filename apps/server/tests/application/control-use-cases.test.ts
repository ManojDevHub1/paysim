import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext,
  ApplicationError,
} from '../../src/application/index.js';

describe('Application Service Layer — Control & Credential Use Cases (Phase 03.3.3)', () => {
  let app: ApplicationContext;

  beforeEach(() => {
    app = createApplicationContext();
  });

  describe('1. Control Session Exchange and Logout Use Cases', () => {
    it('exchanges a valid bootstrap token for an active control session', () => {
      const res = app.control.sessionExchange('control_bootstrap_token_123');
      expect(res.sessionToken).toMatch(/^sess_ps_/);
      expect(app.control.isSessionValid(res.sessionToken)).toBe(true);
    });

    it('rejects empty control token', () => {
      expect(() => app.control.sessionExchange('')).toThrow(ApplicationError);
    });

    it('logs out and invalidates an active control session', () => {
      const { sessionToken } = app.control.sessionExchange('token_abc');
      expect(app.control.isSessionValid(sessionToken)).toBe(true);

      app.control.sessionLogout(sessionToken);
      expect(app.control.isSessionValid(sessionToken)).toBe(false);
    });
  });

  describe('2. Credential Rotation Use Cases', () => {
    it('rotates Native bearer credential and returns one-time disclosure', async () => {
      const preOverview = app.control.getCredentialsOverview();
      const initialId = preOverview.native?.id;

      const res = await app.control.rotateNativeCredential({
        request: { description: 'Rotated for CI test' },
      });

      expect(res.id).toMatch(/^cred_ps_/);
      expect(res.id).not.toBe(initialId);
      expect(res.token).toMatch(/^ps_test_[0-9a-f]{48}$/);
      expect(res.active).toBe(true);

      // Verify overview strictly masks the newly created token
      const postOverview = app.control.getCredentialsOverview();
      expect(postOverview.native?.id).toBe(res.id);
      expect(postOverview.native?.maskedToken).toContain('••••••••');
      // @ts-expect-error Verify raw token is absent from overview DTO
      expect(postOverview.native?.token).toBeUndefined();
    });

    it('rotates Compatibility credential pair and increments active version', async () => {
      const preOverview = app.control.getCredentialsOverview();
      expect(preOverview.activeCompatVersion).toBe(1);

      const res = await app.control.rotateCompatCredential({
        request: { description: 'Rotate for staging' },
      });

      expect(res.id).toMatch(/^cred_rzp_/);
      expect(res.keyId).toMatch(/^rzp_test_[0-9a-f]{16}$/);
      expect(res.keySecret).toHaveLength(48);
      expect(res.version).toBe(2);

      const postOverview = app.control.getCredentialsOverview();
      expect(postOverview.activeCompatVersion).toBe(2);
      expect(postOverview.compatibility.length).toBe(2);

      // Verify raw keySecret is completely absent from overview
      for (const item of postOverview.compatibility) {
        // @ts-expect-error Verify keySecret is absent from summary
        expect(item.keySecret).toBeUndefined();
      }
    });

    it('guarantees that getCredentialsOverview NEVER leaks raw secret material', () => {
      const overview = app.control.getCredentialsOverview();
      const json = JSON.stringify(overview);

      // Must not contain full unmasked token
      expect(json).not.toContain('ps_test_000');
      expect(json).not.toContain('whsec_');
    });
  });
});
