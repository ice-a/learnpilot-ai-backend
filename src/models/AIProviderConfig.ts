import mongoose, { Schema } from 'mongoose'

export interface AIProviderConfigDocument {
  name: string
  baseUrl: string
  modelId: string
  apiKeyEncrypted: string
  isActive: boolean
  timeoutMs: number
  ttsEnabled: boolean
  ttsModelId?: string
  ttsVoice?: string
  ttsFormat?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'flac'
  ttsSpeed?: number
  createdAt: Date
  updatedAt: Date
}

const AIProviderConfigSchema = new Schema<AIProviderConfigDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    baseUrl: {
      type: String,
      required: true,
      trim: true
    },
    modelId: {
      type: String,
      required: true,
      trim: true
    },
    apiKeyEncrypted: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: false
    },
    timeoutMs: {
      type: Number,
      default: 30000,
      min: 1000,
      max: 300000
    },
    ttsEnabled: {
      type: Boolean,
      default: false
    },
    ttsModelId: {
      type: String,
      trim: true
    },
    ttsVoice: {
      type: String,
      trim: true
    },
    ttsFormat: {
      type: String,
      enum: ['mp3', 'wav', 'pcm', 'opus', 'flac'],
      default: 'mp3'
    },
    ttsSpeed: {
      type: Number,
      min: 0.25,
      max: 4,
      default: 1
    }
  },
  {
    timestamps: true
  }
)

AIProviderConfigSchema.index({ isActive: 1 })

export const AIProviderConfigModel = mongoose.model<AIProviderConfigDocument>(
  'AIProviderConfig',
  AIProviderConfigSchema
)
