import mongoose, { Schema, Types } from 'mongoose'
import { GradeStage, LearningTrackType, Subject } from '../types'

export interface TutorSessionDocument {
  userId: string
  trackType: LearningTrackType
  gradeStage?: GradeStage
  gradeLevel?: number
  subject?: Subject
  careerRole?: string
  careerGoal?: string
  providerConfigId: Types.ObjectId
  status: 'active' | 'closed'
  createdAt: Date
  updatedAt: Date
}

const TutorSessionSchema = new Schema<TutorSessionDocument>(
  {
    userId: {
      type: String,
      required: true,
      trim: true
    },
    trackType: {
      type: String,
      enum: ['k12', 'career'],
      required: true,
      default: 'k12'
    },
    gradeStage: {
      type: String,
      enum: ['primary', 'junior', 'senior'],
      required(this: TutorSessionDocument) {
        return this.trackType === 'k12'
      }
    },
    gradeLevel: {
      type: Number,
      min: 1,
      max: 12,
      required(this: TutorSessionDocument) {
        return this.trackType === 'k12'
      }
    },
    subject: {
      type: String,
      enum: ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'],
      required(this: TutorSessionDocument) {
        return this.trackType === 'k12'
      }
    },
    careerRole: {
      type: String,
      trim: true,
      maxlength: 120,
      required(this: TutorSessionDocument) {
        return this.trackType === 'career'
      }
    },
    careerGoal: {
      type: String,
      trim: true,
      maxlength: 240
    },
    providerConfigId: {
      type: Schema.Types.ObjectId,
      ref: 'AIProviderConfig',
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'closed'],
      default: 'active'
    }
  },
  {
    timestamps: true
  }
)

TutorSessionSchema.index({ userId: 1, createdAt: -1 })
TutorSessionSchema.index({ status: 1 })
TutorSessionSchema.index({ trackType: 1, userId: 1, providerConfigId: 1, status: 1 })

export const TutorSessionModel = mongoose.model<TutorSessionDocument>(
  'TutorSession',
  TutorSessionSchema
)
