import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { create as createSubmissionRecord, listMySubmissions as listMySubmissionsRecord } from '../services/submissionService';
import { toSubmissionDTO } from '../services/submissionDto';
import { updateViews as updateViewsRecord } from '../services/viewUpdateService';
import type { CreateSubmissionInput, UpdateViewsBody } from '../validators/submission';

export async function createSubmission(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const submission = await createSubmissionRecord(req.user.id, req.body as CreateSubmissionInput);
  res.status(201).json({ submission: toSubmissionDTO(submission) });
}

export async function listMySubmissions(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const items = await listMySubmissionsRecord(req.user.id);
  res.json({ items: items.map((item) => toSubmissionDTO(item)) });
}

/**
 * PATCH /api/submissions/:id/views — thin handler (spec §5.4). This route has
 * NO auth by decision D13, so a platform can report view counts. The route
 * chain already validated the params and body.
 */
export async function updateViews(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { views } = req.body as UpdateViewsBody;
  const result = await updateViewsRecord(id, views);
  res.status(200).json({
    submission: toSubmissionDTO(result.submission),
    payout: result.payout,
    campaign: result.campaign,
  });
}
