import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { toJSONTransform } from './toJSON';

export type CampaignPlatform = 'instagram' | 'youtube';
export type CampaignStatus = 'live' | 'exhausted';

export interface IMilestone {
  views: number;
  payout: number;
}

export interface ICampaign {
  brand: Types.ObjectId;
  name: string;
  platform: CampaignPlatform;
  budget: number;
  spent: number;
  milestones: IMilestone[];
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type CampaignDocument = HydratedDocument<ICampaign>;

const milestoneSchema = new Schema<IMilestone>(
  {
    views: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'views must be an integer' },
    },
    payout: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'payout must be an integer' },
    },
  },
  { _id: false },
);

const campaignSchema = new Schema<ICampaign>(
  {
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    platform: { type: String, required: true, enum: ['instagram', 'youtube'] },
    budget: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'budget must be an integer' },
    },
    spent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: [
        { validator: Number.isInteger, message: 'spent must be an integer' },
        {
          validator: function (this: ICampaign, value: number) {
            return value <= this.budget;
          },
          message: 'spent cannot exceed budget',
        },
      ],
    },
    milestones: { type: [milestoneSchema], required: true },
    status: { type: String, required: true, enum: ['live', 'exhausted'], default: 'live' },
  },
  {
    timestamps: true,
    toJSON: { transform: toJSONTransform },
  },
);

// Spec §4.2: index for listing live campaigns newest-first.
campaignSchema.index({ status: 1, createdAt: -1 });

// Derived value used by DTOs (spec §4.2: `remaining = budget - spent`).
campaignSchema.virtual('remaining').get(function (this: ICampaign) {
  return this.budget - this.spent;
});

export const Campaign: Model<ICampaign> = model<ICampaign>('Campaign', campaignSchema);
