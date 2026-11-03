import cors from 'cors';

/**
 * Normative Loopback CORS configuration for PAYSIM.
 * Confined strictly to local loopback origins (Vite frontend dev server and PAYSIM HTTP port).
 */
export const ALLOWED_LOOPBACK_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
] as const;

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. curl, supertest, server-to-server) where origin is undefined
    if (!origin || (ALLOWED_LOOPBACK_ORIGINS as readonly string[]).includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Idempotency-Key',
    'Idempotency-Key',
    'X-PaySim-CSRF',
    'X-Control-Session',
  ],
  exposedHeaders: ['X-Request-Id', 'X-PaySim-CSRF', 'X-Control-Session', 'Allow'],
});
