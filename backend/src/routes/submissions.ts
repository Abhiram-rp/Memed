import { Router } from 'express';
import { createSubmission, listMySubmissions, updateViews } from '../controllers/submissionController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import {
  createSubmissionSchema,
  updateViewsBodySchema,
  viewsParamsSchema,
} from '../validators/submission';

const router = Router();

// `/mine` is registered before any `/:id` route so the id matcher never swallows it.
router.get('/mine', authenticate, requireRole('creator'), asyncHandler(listMySubmissions));

router.post(
  '/',
  authenticate,
  requireRole('creator'),
  validate(createSubmissionSchema, 'body'),
  asyncHandler(createSubmission),
);

// Public by decision D13: no `authenticate`, no `requireRole`.
router.patch(
  '/:id/views',
  validate(viewsParamsSchema, 'params'),
  validate(updateViewsBodySchema, 'body'),
  asyncHandler(updateViews),
);

export { router as submissionsRouter };
