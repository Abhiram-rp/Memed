import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { toJSONTransform } from './toJSON';

export interface ISubmission {
  campaign: Types.ObjectId;
  creator: Types.ObjectId;
  postUrl: string;
  normalizedUrl: string;
  views: number;
  entitledAmount: number;
  paidAmount: number;
  lastViewsUpdatedAt: Date;
  flagged: boolean;
  flagReason?: string | null;
  flaggedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubmissionDocument = HydratedDocument<ISubmission>;

const submissionSchema = new Schema<ISubmission>(
  {
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    postUrl: { type: String, required: true, trim: true },
    // Globally unique (D11): the same post cannot be submitted twice, in any campaign.
    normalizedUrl: { type: String, required: true, unique: true },
    views: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'views must be an integer' },
    },
    entitledAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'entitledAmount must be an integer' },
    },
    paidAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'paidAmount must be an integer' },
    },
    lastViewsUpdatedAt: { type: Date, required: true, default: Date.now },
    flagged: { type: Boolean, required: true, default: false },
    flagReason: { type: String },
    flaggedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { transform: toJSONTransform },
  },
);

// Derived value used by DTOs (spec §5.3: `capped = paidAmount < entitledAmount`).
submissionSchema.virtual('capped').get(function (this: ISubmission) {
  return this.paidAmount < this.entitledAmount;
});

export const Submission: Model<ISubmission> = model<ISubmission>('Submission', submissionSchema);
