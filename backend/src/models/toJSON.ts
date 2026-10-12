/**
 * Shared Mongoose `toJSON` transform (D18): the API returns `id` (string),
 * never `_id`/`__v`, and `passwordHash` is never serialized.
 */
export function toJSONTransform(_doc: unknown, ret: Record<string, unknown>): void {
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
  }
  delete ret._id;
  delete ret.__v;
  delete ret.passwordHash;
}
