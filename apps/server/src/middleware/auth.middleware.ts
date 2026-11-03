import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApplicationContext } from '../application/index.js';
import {
  createUnauthorizedError,
  createControlSessionExpiredError,
  createCsrfInvalidError,
} from '../application/errors/application.error.js';

function extractCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Middleware requiring valid Native API Bearer token authorization.
 */
export function requireBearerAuth(appContext: ApplicationContext): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return next(createUnauthorizedError('Missing or invalid Authorization header. Expected Bearer token.'));
    }

    const token = authHeader.slice(7).trim();
    if (!token || !appContext.control.validateNativeToken(token)) {
      return next(createUnauthorizedError('Invalid or expired Bearer token.'));
    }

    next();
  };
}

/**
 * Middleware requiring valid Razorpay Compatibility HTTP Basic authorization.
 */
export function requireBasicAuth(appContext: ApplicationContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
      return next(createUnauthorizedError('Missing or invalid Authorization header. Expected Basic credentials.'));
    }

    const base64Credentials = authHeader.slice(6).trim();
    let decoded: string;
    try {
      decoded = Buffer.from(base64Credentials, 'base64').toString('utf8');
    } catch {
      return next(createUnauthorizedError('Malformed Basic authorization header encoding.'));
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      return next(createUnauthorizedError('Malformed Basic authorization format. Expected key_id:key_secret.'));
    }

    const keyId = decoded.slice(0, colonIdx);
    const keySecret = decoded.slice(colonIdx + 1);

    if (!appContext.control.validateCompatCredential(keyId, keySecret)) {
      return next(createUnauthorizedError('Invalid API key ID or secret.'));
    }

    res.locals.keyId = keyId;
    next();
  };
}

/**
 * Middleware requiring active Control session and CSRF protection for mutating operations.
 */
export function requireControlAuth(appContext: ApplicationContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Extract session token from X-Control-Session header, Authorization Bearer, or cookie
    const headerToken = req.header('x-control-session')?.trim();
    const bearerToken = req.header('authorization')?.toLowerCase().startsWith('bearer ')
      ? req.header('authorization')?.slice(7).trim()
      : undefined;
    const cookieToken =
      (req as unknown as { cookies?: Record<string, string> }).cookies?.ps_control_session ||
      extractCookie(req.header('cookie'), 'ps_control_session');

    const sessionToken = headerToken || bearerToken || cookieToken;

    if (!sessionToken || !appContext.control.isSessionValid(sessionToken)) {
      return next(createControlSessionExpiredError('Control session is missing, invalid, or expired.'));
    }

    res.locals.controlSessionToken = sessionToken;

    // 2. Enforce CSRF check on mutating HTTP methods
    const mutatingMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];
    if (mutatingMethods.includes(req.method.toUpperCase())) {
      const csrfToken = req.header('x-paysim-csrf')?.trim();
      if (!csrfToken || !appContext.control.validateCsrf(sessionToken, csrfToken)) {
        return next(createCsrfInvalidError('Missing or invalid X-PaySim-CSRF token for mutating control operation.'));
      }
    }

    next();
  };
}
