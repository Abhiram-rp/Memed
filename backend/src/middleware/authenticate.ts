import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { UnauthenticatedError } from '../errors';
import { User } from '../models/User';

interface TokenPayload {
  sub?: unknown;
  role?: unknown;
}

/**
 * Parses `Authorization: Bearer <jwt>`, verifies the token, and loads the user
 * from the DB (so deleted users lose access immediately). Attaches
 * `req.user = { id, role }` (spec Phase 3 task 3).
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthenticatedError('Missing authentication token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new UnauthenticatedError('Missing authentication token');
    }

    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
      throw new UnauthenticatedError('Invalid or expired token');
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      throw new UnauthenticatedError('Invalid or expired token');
    }

    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    // JWT errors and AppErrors both land in the central error handler.
    next(err);
  }
};
