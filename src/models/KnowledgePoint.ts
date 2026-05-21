import mongoose, { Schema } from 'mongoose'
import { GradeStage, Subject, LearningTrackType } from '../types'

export interface KnowledgePointDocument {
  trackType: LearningTrackType
  gradeStage?: GradeStage
  gradeLevel?: number
  subject?: Subject
  careerRole?: string
  careerGoal?: string
  chapter: string
  title: string
  description: string
  difficulty: 1 | 2 | 3 | 4 | 5
  source: 'ai_generated' | 'manual'
  version: number
  createdAt: Date
  updatedAt: Date
}

const KnowledgePointSchema = new Schema<KnowledgePointDocument>(
  {
    trackType: {
      type: String,
      enum: ['k12', 'career'],
      required: true,
      default: 'k12'
    },
    gradeStage: {
      type: String,
      enum: ['primary', 'junior', 'senior'],
      required(this: KnowledgePointDocument) {
        return this.trackType === 'k12'
      }
    },
    gradeLevel: {
      type: Number,
      required(this: KnowledgePointDocument) {
        return this.trackType === 'k12'
      },
      min: 1,
      max: 12
    },
    subject: {
      type: String,
      enum: ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'],
      required(this: KnowledgePointDocument) {
        return this.trackType === 'k12'
      }
    },
    careerRole: {
      type: String,
      trim: true,
      maxlength: 120
    },
    careerGoal: {
      type: String,
      trim: true,
      maxlength: 240
    },
    chapter: {
      type: String,
      required: true,
      trim: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    difficulty: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    source: {
      type: String,
      enum: ['ai_generated', 'manual'],
      default: 'ai_generated'
    },
    version: {
      type: Number,
      default: 1,
      min: 1
    }
  },
  {
    timestamps: true
  }
)

KnowledgePointSchema.index({ trackType: 1, gradeStage: 1, gradeLevel: 1, subject: 1, careerRole: 1 })
KnowledgePointSchema.index(
  { trackType: 1, gradeStage: 1, gradeLevel: 1, subject: 1, careerRole: 1, chapter: 1, title: 1, version: -1 },
  { unique: true }
)

export const KnowledgePointModel = mongoose.model<KnowledgePointDocument>(
  'KnowledgePoint',
  KnowledgePointSchema
)
