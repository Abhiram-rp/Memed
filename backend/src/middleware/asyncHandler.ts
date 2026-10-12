import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler so a rejected promise is forwarded to Express's
 * error pipeline instead of becoming an unhandled rejection (spec §9).
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
