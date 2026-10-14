import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors';
import type { UserRole } from '../models/User';

/**
 * Role guard for brand/creator endpoints (spec Phase 3 task 4). Must run after
 * `authenticate`; a missing user means the route was reached unauthenticated.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthenticatedError('Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
