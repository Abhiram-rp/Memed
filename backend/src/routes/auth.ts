import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { NotFoundError } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { User } from '../models/User';
import { loginSchema, signupSchema } from '../schemas/auth';
import { login, signup, toUserDTO } from '../services/authService';

/**
 * Auth endpoints (spec §5.2, Phase 3 task 5). Signup/login are rate-limited
 * (20 requests / 15 min / IP); the limiter is disabled in tests.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  },
});

export const authRouter = Router();

authRouter.post(
  '/signup',
  authLimiter,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const result = await signup(req.body);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.json(result);
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    // `authenticate` verified the user exists; re-fetch for the full profile.
    const user = await User.findById(req.user!.id);
    if (!user) {
      throw new NotFoundError();
    }
    res.json({ user: toUserDTO(user) });
  }),
);
