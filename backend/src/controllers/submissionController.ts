import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { create as createSubmissionRecord } from '../services/submissionService';
import { toSubmissionDTO } from '../services/submissionDto';
import type { CreateSubmissionInput } from '../validators/submission';

export async function createSubmission(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const submission = await createSubmissionRecord(req.user.id, req.body as CreateSubmissionInput);
  res.status(201).json({ submission: toSubmissionDTO(submission) });
}
