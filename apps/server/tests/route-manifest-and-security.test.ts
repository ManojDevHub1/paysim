import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  API_ROUTE_MANIFEST,
  NON_NORMATIVE_ROUTE_ALIASES,
  ALL_ROUTE_CONTRACTS,
} from '@paysim/contracts';
import { createApp } from '../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../src/application/index.js';

describe('Route Manifest Coverage & Security Matrix (Phase 03.4.1)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let nativeToken: string;
  let basicAuthHeader: string;
  let bootstrapToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    bootstrapToken = appContext.control.getBootstrapToken();
    app = createApp(appContext);
    nativeToken = appContext.control.getActiveNativeToken()!;

    const compatCred = appContext.control.getActiveCompatCredential()!;
    const rawCredentials = `${compatCred.keyId}:${compatCred.keySecret}`;
    basicAuthHeader = `Basic ${Buffer.from(rawCredentials).toString('base64')}`;
  });

  describe('Task 2 — Programmatic Route Manifest Coverage', () => {
    function extractExpressRoutes(appInstance: ReturnType<typeof createApp>) {
      const routes: Array<{ method: string; path: string }> = [];

      function walkStack(stack: Array<{ route?: { path: string; methods: Record<string, boolean> }; name?: string; handle?: { stack?: unknown[] } }>, prefix = '') {
        for (const layer of stack) {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
            for (const method of methods) {
              routes.push({ method, path: prefix + layer.route.path });
            }
          } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
            walkStack(layer.handle.stack as never[], prefix);
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      walkStack((appInstance as any)._router.stack);
      return routes;
    }

    it('verifies exact 1:1 match for all 30 normative routes + 1 non-normative alias (31 total)', () => {
      const registeredRoutes = extractExpressRoutes(app);

      expect(API_ROUTE_MANIFEST.length).toBe(30);
      expect(NON_NORMATIVE_ROUTE_ALIASES.length).toBe(1);
      expect(ALL_ROUTE_CONTRACTS.length).toBe(31);
      expect(registeredRoutes.length).toBe(31);

      // Verify no duplicates in registered routes
      const routeKeys = registeredRoutes.map((r) => `${r.method} ${r.path}`);
      const uniqueKeys = new Set(routeKeys);
      expect(uniqueKeys.size).toBe(31);

      // Verify every contract route has an exact registration
      for (const contractRoute of ALL_ROUTE_CONTRACTS) {
        const found = registeredRoutes.find(
          (r) => r.method === contractRoute.method && r.path === contractRoute.path
        );
        expect(
          found,
          `Expected route ${contractRoute.method} ${contractRoute.path} (${contractRoute.id}) to be registered in Express`
        ).toBeDefined();
      }
    });

    it('executes an HTTP call against all 31 registered routes to verify route handlers respond', async () => {
      for (const contract of ALL_ROUTE_CONTRACTS) {
        // Build mock URL substituting path params
        const url = contract.path
          .replace(':id', 'mock_id_for_coverage')
          .replace(':sessionId', 'sess_ps_mock_for_coverage');

        let reqBuilder;
        switch (contract.method) {
          case 'GET':
            reqBuilder = request(app).get(url);
            break;
          case 'POST':
            reqBuilder = request(app).post(url);
            break;
          case 'PATCH':
            reqBuilder = request(app).patch(url);
            break;
          case 'PUT':
            reqBuilder = request(app).put(url);
            break;
          case 'DELETE':
            reqBuilder = request(app).delete(url);
            break;
        }

        const res = await reqBuilder;

        // A registered route must NEVER return 404 or 405 (which indicates missing or bad method mapping)
        // It must return either 2xx, 401 (auth failure), 403 (csrf), 404 on entity not found, or 422
        expect(res.status).not.toBe(405);
        if (res.status === 404) {
          // 404 is acceptable only from entity lookup, not from route gateway
          expect(res.body.error?.message).not.toContain('No route matches the path');
        }
      }
    });
  });

  describe('Task 3 — Authentication & Security Matrix Verification', () => {
    it('verifies credentials cannot cross API namespaces', async () => {
      // 1. Bearer token sent to Compat route -> 401
      const res1 = await request(app)
        .get('/compat/razorpay/v1/orders/ord_ps_123')
        .set('Authorization', `Bearer ${nativeToken}`);
      expect(res1.status).toBe(401);
      expect(res1.body.error.code).toBe('UNAUTHORIZED');

      // 2. Basic auth sent to Native route -> 401
      const res2 = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', basicAuthHeader);
      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('UNAUTHORIZED');

      // 3. Control session token sent to Native route -> 401
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });
      const sessionToken = exchangeRes.header['x-control-session'];

      const res3 = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(res3.status).toBe(401);
      expect(res3.body.error.code).toBe('UNAUTHORIZED');

      // 4. Native bearer token sent to Control route -> 401
      const res4 = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', nativeToken);
      expect(res4.status).toBe(401);
      expect(res4.body.error.code).toBe('CONTROL_SESSION_EXPIRED');
    });

    it('verifies revoked credentials fail immediately upon rotation', async () => {
      // 1. Establish session
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });
      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // 2. Test initial native token works
      const preRotRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${nativeToken}`);
      expect(preRotRes.status).toBe(200);

      // 3. Rotate native token
      const rotRes = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);
      expect(rotRes.status).toBe(200);
      const newNativeToken = rotRes.body.token;

      // 4. Old native token immediately fails
      const postRotOldRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${nativeToken}`);
      expect(postRotOldRes.status).toBe(401);
      expect(postRotOldRes.body.error.code).toBe('UNAUTHORIZED');

      // 5. New native token succeeds
      const postRotNewRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${newNativeToken}`);
      expect(postRotNewRes.status).toBe(200);

      // 6. Test compat credential rotation
      const preCompatRes = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', basicAuthHeader)
        .send({ amount: 1000 });
      expect(preCompatRes.status).toBe(201);

      const rotCompatRes = await request(app)
        .post('/control/v1/credentials/compat/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);
      expect(rotCompatRes.status).toBe(200);

      // 7. Old Basic auth credentials immediately fail
      const postCompatOldRes = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', basicAuthHeader)
        .send({ amount: 1000 });
      expect(postCompatOldRes.status).toBe(401);
      expect(postCompatOldRes.body.error.code).toBe('UNAUTHORIZED');

      // 8. New Basic auth credentials succeed
      const newBasicHeader = `Basic ${Buffer.from(`${rotCompatRes.body.keyId}:${rotCompatRes.body.keySecret}`).toString('base64')}`;
      const postCompatNewRes = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', newBasicHeader)
        .send({ amount: 1000 });
      expect(postCompatNewRes.status).toBe(201);
    });

    it('verifies expired / logged-out sessions fail', async () => {
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });
      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // Logout
      await request(app)
        .post('/control/v1/session/logout')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);

      // Next request fails
      const res = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', sessionToken);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONTROL_SESSION_EXPIRED');
    });

    it('verifies CSRF is required ONLY on mutating control endpoints', async () => {
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });
      const sessionToken = exchangeRes.header['x-control-session'];
      const csrfToken = exchangeRes.body.csrfToken;

      // GET /control/v1/credentials succeeds WITHOUT CSRF
      const getRes = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', sessionToken);
      expect(getRes.status).toBe(200);

      // POST mutating endpoint fails WITHOUT CSRF
      const mutateNoCsrf = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken);
      expect(mutateNoCsrf.status).toBe(403);
      expect(mutateNoCsrf.body.error.code).toBe('CSRF_INVALID');

      // POST mutating endpoint succeeds WITH CSRF
      const mutateWithCsrf = await request(app)
        .post('/control/v1/credentials/native/rotate')
        .set('X-Control-Session', sessionToken)
        .set('X-PaySim-CSRF', csrfToken);
      expect(mutateWithCsrf.status).toBe(200);
    });

    it('verifies raw secrets NEVER leak in error responses or safe overview DTOs', async () => {
      const exchangeRes = await request(app)
        .post('/control/v1/session/exchange')
        .send({ token: bootstrapToken });
      const sessionToken = exchangeRes.header['x-control-session'];

      // 1. Overview DTO
      const overviewRes = await request(app)
        .get('/control/v1/credentials')
        .set('X-Control-Session', sessionToken);
      const overviewText = JSON.stringify(overviewRes.body);

      // Verify masking
      expect(overviewText).toContain('••••••••');
      expect(overviewRes.body.native.token).toBeUndefined();

      // 2. Error responses
      const errRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer invalid_raw_token_xyz')
        .send({ broken: true });

      const errText = JSON.stringify(errRes.body);
      expect(errText).not.toContain(nativeToken);
      expect(errText).not.toContain(bootstrapToken);
    });
  });
});
