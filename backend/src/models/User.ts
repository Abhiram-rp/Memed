import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { toJSONTransform } from './toJSON';

export type UserRole = 'brand' | 'creator';

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    // `unique` creates the unique index (spec §4.1); `lowercase`/`trim` normalize input.
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    // `select: false` keeps the hash out of queries; the toJSON transform also strips it.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ['brand', 'creator'] },
  },
  {
    timestamps: true,
    toJSON: { transform: toJSONTransform },
  },
);

export const User: Model<IUser> = model<IUser>('User', userSchema);
