export type GradeStage = 'primary' | 'junior' | 'senior'
export type LearningTrackType = 'k12' | 'career'

export type Subject =
  | 'math'
  | 'chinese'
  | 'english'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'history'
  | 'geography'
  | 'politics'

export interface AIProviderConfig {
  _id?: string
  name: string
  baseUrl: string
  modelId: string
  apiKeyEncrypted: string
  isActive: boolean
  timeoutMs: number
  ttsEnabled?: boolean
  ttsModelId?: string
  ttsVoice?: string
  ttsFormat?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'flac'
  ttsSpeed?: number
  createdAt?: Date
  updatedAt?: Date
}

export interface KnowledgePoint {
  _id?: string
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
  createdAt?: Date
  updatedAt?: Date
}

export interface TutorSession {
  _id?: string
  userId: string
  trackType: LearningTrackType
  gradeStage?: GradeStage
  gradeLevel?: number
  subject?: Subject
  careerRole?: string
  careerGoal?: string
  providerConfigId: string
  status: 'active' | 'closed'
  createdAt?: Date
  updatedAt?: Date
}

export interface TutorMessage {
  _id?: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
  createdAt?: Date
  updatedAt?: Date
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatOptions {
  responseFormat?: 'json' | 'text'
  temperature?: number
  maxTokens?: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  details?: unknown
  requestId?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
