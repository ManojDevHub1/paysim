import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { generateId } from '@paysim/shared';
import type { StandardErrorEnvelope } from '@paysim/contracts';
import { ApplicationError } from '../application/errors/application.error.js';

/**
 * Centralized Express Error Handling Middleware.
 * Transforms domain errors, validation errors, JSON syntax errors, and unhandled exceptions
 * into normative StandardErrorEnvelope responses with valid Request IDs.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (res.locals.requestId as string) || generateId('req_ps');

  // 1. Application-level domain error
  if (err instanceof ApplicationError) {
    const envelope = err.toEnvelope(requestId);
    res.status(err.httpStatus).json(envelope);
    return;
  }

  // 2. Zod validation error
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    const envelope: StandardErrorEnvelope = {
      simulated: true,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Field constraint or boundary validation failure',
        requestId,
        details,
      },
    };
    res.status(422).json(envelope);
    return;
  }

  // 3. JSON body parsing syntax error
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status: number }).status === 400 &&
    'body' in err
  ) {
    const envelope: StandardErrorEnvelope = {
      simulated: true,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Unparseable or non-conforming JSON payload body',
        requestId,
        details: [{ message: (err as Error).message }],
      },
    };
    res.status(400).json(envelope);
    return;
  }

  // 4. Fallback unhandled error
  const message = err instanceof Error ? err.message : 'An unexpected internal error occurred';
  const envelope: StandardErrorEnvelope = {
    simulated: true,
    error: {
      code: 'INTERNAL_ERROR',
      message: message || 'An unexpected internal error occurred',
      requestId,
      details: [],
    },
  };
  res.status(500).json(envelope);
}
