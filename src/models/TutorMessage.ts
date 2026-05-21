import mongoose, { Schema, Types } from 'mongoose'

interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface TutorMessageDocument {
  sessionId: Types.ObjectId
  role: 'user' | 'assistant' | 'system'
  content: string
  tokenUsage?: TokenUsage
  createdAt: Date
  updatedAt: Date
}

const TutorMessageSchema = new Schema<TutorMessageDocument>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TutorSession',
      required: true
    },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    tokenUsage: {
      type: {
        prompt: { type: Number, default: 0 },
        completion: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      },
      required: false
    }
  },
  {
    timestamps: true
  }
)

TutorMessageSchema.index({ sessionId: 1, createdAt: 1 })

export const TutorMessageModel = mongoose.model<TutorMessageDocument>(
  'TutorMessage',
  TutorMessageSchema
)
