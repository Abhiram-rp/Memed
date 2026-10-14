import type { UserRole } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware (spec Phase 3 task 3). */
      user?: { id: string; role: UserRole };
    }
  }
}

export {};
