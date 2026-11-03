import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Higher-order function that wraps asynchronous Express route handlers,
 * ensuring unhandled Promise rejections are properly forwarded to Express next(err).
 * Essential for Express 4 async safety.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
