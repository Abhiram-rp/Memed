import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ConflictError, UnauthenticatedError } from '../errors';
import { User, type UserRole } from '../models/User';
import type { LoginInput, SignupInput } from '../schemas/auth';

/** Public user shape returned by every auth endpoint (spec §5.3). */
export interface AuthUserDTO {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  user: AuthUserDTO;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

export function toUserDTO(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  role: UserRole;
}): AuthUserDTO {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
}

/** JWT payload is `{ sub: userId, role }` (spec §5.3); expiry from env. */
export function signToken(user: { id: string; role: UserRole }): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export async function signup(input: SignupInput): Promise<AuthResult> {
  const passwordHash = await hash(input.password, 10);
  const user = new User({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
  });
  try {
    await user.save();
  } catch (err) {
    // Rely on the unique email index; never pre-check then race.
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('An account with this email already exists');
    }
    throw err;
  }
  const dto = toUserDTO(user);
  return { token: signToken(dto), user: dto };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  // `passwordHash` is `select: false`, so opt back in for the comparison.
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  // Same status and message for unknown email and wrong password (no user enumeration).
  if (!user) {
    throw new UnauthenticatedError('Invalid email or password');
  }
  const valid = await compare(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthenticatedError('Invalid email or password');
  }
  const dto = toUserDTO(user);
  return { token: signToken(dto), user: dto };
}
