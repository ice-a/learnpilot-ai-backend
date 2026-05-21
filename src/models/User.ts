import mongoose, { Schema, Types } from 'mongoose'

export interface PersonalInfoSessionItem {
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
}

export interface InterviewProfile {
  targetRole?: string
  focusDirection?: string
  selfIntroduction?: string
}

export interface UserDocument {
  email: string
  displayName: string
  passwordHash: string
  emailVerified: boolean
  loginBlockedUntil?: Date
  unlockRequired: boolean
  unlockTokenHash?: string
  unlockTokenExpiresAt?: Date
  passwordResetTokenHash?: string
  passwordResetTokenExpiresAt?: Date
  lastLoginAt?: Date
  learningDirection?: string
  learningGoal?: string
  preferredProviderConfigId?: Types.ObjectId
  personalInfoSession: PersonalInfoSessionItem[]
  interviewProfile: InterviewProfile
  createdAt: Date
  updatedAt: Date
}

const PersonalInfoSessionItemSchema = new Schema<PersonalInfoSessionItem>(
  {
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
      default: 'user'
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { _id: false }
)

const InterviewProfileSchema = new Schema<InterviewProfile>(
  {
    targetRole: {
      type: String,
      trim: true,
      maxlength: 120
    },
    focusDirection: {
      type: String,
      trim: true,
      maxlength: 240
    },
    selfIntroduction: {
      type: String,
      trim: true,
      maxlength: 1200
    }
  },
  { _id: false }
)

const UserSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },
    passwordHash: {
      type: String,
      required: true
    },
    emailVerified: {
      type: Boolean,
      default: false
    },
    loginBlockedUntil: {
      type: Date
    },
    unlockRequired: {
      type: Boolean,
      default: false
    },
    unlockTokenHash: {
      type: String
    },
    unlockTokenExpiresAt: {
      type: Date
    },
    passwordResetTokenHash: {
      type: String
    },
    passwordResetTokenExpiresAt: {
      type: Date
    },
    lastLoginAt: {
      type: Date
    },
    learningDirection: {
      type: String,
      trim: true,
      maxlength: 120
    },
    learningGoal: {
      type: String,
      trim: true,
      maxlength: 240
    },
    preferredProviderConfigId: {
      type: Schema.Types.ObjectId,
      ref: 'AIProviderConfig'
    },
    personalInfoSession: {
      type: [PersonalInfoSessionItemSchema],
      default: []
    },
    interviewProfile: {
      type: InterviewProfileSchema,
      default: {}
    }
  },
  {
    timestamps: true
  }
)

UserSchema.index({ email: 1 }, { unique: true })
UserSchema.index({ unlockRequired: 1, loginBlockedUntil: 1 })

export const UserModel = mongoose.model<UserDocument>('User', UserSchema)
