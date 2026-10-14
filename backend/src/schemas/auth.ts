import { z } from 'zod';

/**
 * Request schemas for the auth endpoints (spec Phase 3 task 1).
 * `validate()` replaces the request part with the parsed value, so the
 * trim/lowercase transforms below reach the service layer.
 */
/**
 * Email that is trimmed and lowercased BEFORE the format check: zod validates
 * the raw value first, so `z.email().trim()` would reject `'  A@B.COM '`.
 */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('A valid email is required'));

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name must be at most 80 characters'),
  email: emailSchema,
  // bcrypt only reads the first 72 bytes; reject longer passwords up front.
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
  role: z.enum(['brand', 'creator']),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
