import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { getCreatorEarnings } from '../services/earningsService';

/**
 * GET /api/creators/me/earnings — thin handler (spec §9): the route chain
 * already ran `authenticate` + `requireRole('creator')`, so `req.user` is the
 * creator whose earnings are summarized.
 */
export async function getMyEarnings(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const earnings = await getCreatorEarnings(req.user.id);
  res.json({ earnings });
}