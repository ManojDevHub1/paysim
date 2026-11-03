import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Control API Integration (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let bootstrapToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    bootstrapToken = appContext.control.getBootstrapToken();
    app = createApp(appContext);
  });

  describe('1. Control Token Exchange & Single-Use Security', () => {
    it('exchanges one-time bootstrap token for session cookie and CSRF token', async () => {
      const res = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      expect(res.status).toBe(200);
      expect(res.body.csrfToken).toHaveLength(64);
      expect(res.body.expiresAt).toBeDefined();

      // Verify Set-Cookie header contains ps_control_session with HttpOnly and SameSite=Strict
      const cookieHeader = res.header['set-cookie'];
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader[0]).toContain('ps_control_session=');
      expect(cookieHeader[0]).toContain('HttpOnly');
      expect(cookieHeader[0]).toContain('SameSite=Strict');
    });

    it('enforces SET-03 single-use consumption of bootstrap token', async () => {
      // 1. Initial exchange succeeds
      const res1 = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      expect(res1.status).toBe(200);

      // 2. Second exchange with same token is rejected
      const res2 = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('CONTROL_TOKEN_INVALID');
    });

    it('rejects mismatched control token', async () => {
      const wrongToken = 'a'.repeat(64);
      const res = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: wrongToken });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONTROL_TOKEN_INVALID');
    });
  });

  describe('2. Session Authentication & CSRF Protection', () => {
    it('rejects access to protected control endpoints without session token', async () => {
      const res = await request(app).get('/control/v1/credentials');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONTROL_SESSION_EXPIRED');
    });

    it('enforces SET-04 CSRF protection on mutating control endpoints', async () => {
      // 1. Exchange bootstrap token
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // 2. Call mutating endpoint without CSRF header -> 403 CSRF_INVALID
      const missingCsrfRes = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken);

      expect(missingCsrfRes.status).toBe(403);
      expect(missingCsrfRes.body.error.code).toBe('CSRF_INVALID');

      // 3. Call mutating endpoint with wrong CSRF token -> 403 CSRF_INVALID
      const wrongCsrfRes = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', 'invalid_csrf_token_value');

      expect(wrongCsrfRes.status).toBe(403);
      expect(wrongCsrfRes.body.error.code).toBe('CSRF_INVALID');

      // 4. Call mutating endpoint with valid session + CSRF -> 200 OK
      const successRes = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken)
        .send({ description: 'Rotated via integration test' });

      expect(successRes.status).toBe(200);
      expect(successRes.body.token).toMatch(/^ps_test_/);
      expect(successRes.body.active).toBe(true);
    });

    it('rotates compatibility credentials and verifies safe metadata overview', async () => {
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // Rotate compat credentials
      const rotateRes = await request(app)
        .post('/control/v1/credentials/compat/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.keyId).toMatch(/^rzp_test_/);
      expect(rotateRes.body.keySecret).toBeDefined();

      // Fetch overview via canonical route
      const overviewRes = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', sessionToken);

      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.native.maskedToken).toContain('••••••••');
      expect(overviewRes.body.compatibility.length).toBeGreaterThanOrEqual(2);

      // Verify zero raw secrets in overview payload
      const overviewText = JSON.stringify(overviewRes.body);
      expect(overviewText).not.toContain(rotateRes.body.keySecret);

      // Also verify non-normative overview alias
      const aliasRes = await request(app)
        .get('/control/v1/credentials/overview')
        .set('X-Control-Session', sessionToken);

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.native.maskedToken).toBe(overviewRes.body.native.maskedToken);
    });

    it('logs out and revokes active control session', async () => {
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });

      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // Logout
      const logoutRes = await request(app)
        .post('/control/v1/session/logout')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Next request with that session fails with 401
      const afterRes = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', sessionToken);

      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error.code).toBe('CONTROL_SESSION_EXPIRED');
    });
  });
});
