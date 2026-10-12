import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors';

/** Terminal middleware: any unmatched route becomes a 404 through `errorHandler`. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};
