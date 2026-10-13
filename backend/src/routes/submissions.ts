import { Router } from 'express';
import { createSubmission, listMySubmissions } from '../controllers/submissionController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { createSubmissionSchema } from '../validators/submission';

const router = Router();

router.get('/mine', authenticate, requireRole('creator'), asyncHandler(listMySubmissions));

router.post(
  '/',
  authenticate,
  requireRole('creator'),
  validate(createSubmissionSchema, 'body'),
  asyncHandler(createSubmission),
);

export { router as submissionsRouter };
