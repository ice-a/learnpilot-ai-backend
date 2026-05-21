import { AIProviderConfigModel } from '../models/AIProviderConfig'
import { ChatMessage } from '../types'
import { AIGateway } from './AIGateway'

export interface InterviewTranscriptItem {
  role: 'assistant' | 'user'
  content: string
}

interface StartInterviewParams {
  providerConfigId: string
  markdown: string
  targetRole?: string
}

interface SubmitAnswerParams {
  providerConfigId: string
  markdown: string
  targetRole?: string
  transcript: InterviewTranscriptItem[]
  answer: string
}

interface InterviewAnswerResult {
  analysis: string
  nextQuestion: string
  scoreDelta: number
  scoreReason: string
}

export class InterviewService {
  private aiGateway: AIGateway

  constructor() {
    this.aiGateway = new AIGateway()
  }

  async startInterview(params: StartInterviewParams): Promise<{ question: string }> {
    await this.assertProviderReady(params.providerConfigId)

    const role = this.normalizeRole(params.targetRole)
    const markdown = this.normalizeMarkdown(params.markdown)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          `你是一位严格但友好的 ${role} 面试官。`,
          '任务：基于候选人提供的 Markdown 材料，先提出 1 个开场面试问题。',
          '要求：',
          '1) 只输出 1 个问题，不要附带答案和解释；',
          '2) 问题长度控制在 1-2 句；',
          '3) 优先考察候选人材料里的真实经历与能力。'
        ].join('\n')
      },
      {
        role: 'user',
        content: `候选人材料（Markdown）：\n\n${markdown}`
      }
    ]

    const result = await this.aiGateway.chat(params.providerConfigId, messages, {
      temperature: 0.4,
      maxTokens: 400
    })

    return {
      question: this.normalizeQuestion(result.text)
    }
  }

  async submitAnswer(params: SubmitAnswerParams): Promise<InterviewAnswerResult> {
    await this.assertProviderReady(params.providerConfigId)

    const role = this.normalizeRole(params.targetRole)
    const markdown = this.normalizeMarkdown(params.markdown)
    const answer = params.answer.trim()
    const transcript = params.transcript.slice(-16)
    const transcriptText = this.serializeTranscript(transcript)

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          `你是一位严格但友好的 ${role} 面试官。`,
          '请阅读候选人的回答，输出 JSON：',
          '{"analysis":"", "nextQuestion":"", "scoreDelta":0, "scoreReason":""}',
          '约束：',
          '1) analysis 用 2-4 句，先肯定再指出 1-2 个改进点，总长度不超过 140 个中文字符；',
          '2) nextQuestion 必须是单个追问，不能给答案，总长度不超过 80 个中文字符；',
          '3) scoreDelta 必须是 -10 到 +10 的整数，基于本轮回答加分或减分；',
          '4) scoreReason 用 1 句话说明加减分理由；',
          '5) 只输出 JSON，不要输出 Markdown。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `候选人材料（Markdown）：\n${markdown}`,
          `历史对话（最近轮次）：\n${transcriptText || '暂无'}`,
          `候选人本轮回答：\n${answer}`
        ].join('\n\n')
      }
    ]

    const result = await this.aiGateway.chat(params.providerConfigId, messages, {
      responseFormat: 'json',
      temperature: 0.3,
      maxTokens: 900
    })

    return this.parseAnswerResult(result.text)
  }

  private async assertProviderReady(providerConfigId: string): Promise<void> {
    const provider = await AIProviderConfigModel.findById(providerConfigId).lean().exec()
    if (!provider) {
      throw new Error(`AI provider configuration not found: ${providerConfigId}`)
    }
    if (!provider.isActive) {
      throw new Error(`AI provider is not active: ${provider.name}`)
    }
  }

  private normalizeRole(raw?: string): string {
    const role = (raw || '').trim()
    return role || '通用技术'
  }

  private normalizeMarkdown(markdown: string): string {
    const clean = markdown.replace(/\r\n/g, '\n').trim()
    if (clean.length <= 12000) {
      return clean
    }
    return clean.slice(0, 12000)
  }

  private serializeTranscript(transcript: InterviewTranscriptItem[]): string {
    if (!transcript.length) {
      return ''
    }

    return transcript
      .map(item => `${item.role === 'assistant' ? '面试官' : '候选人'}：${item.content.trim()}`)
      .join('\n')
      .slice(0, 6000)
  }

  private parseAnswerResult(rawText: string): InterviewAnswerResult {
    const parsed = this.safeParseJson(rawText)
    const analysisRaw = typeof parsed?.analysis === 'string' ? parsed.analysis : ''
    const nextQuestionRaw = typeof parsed?.nextQuestion === 'string' ? parsed.nextQuestion : ''
    const scoreDeltaRaw = typeof parsed?.scoreDelta === 'number' ? parsed.scoreDelta : Number.NaN
    const scoreReasonRaw = typeof parsed?.scoreReason === 'string' ? parsed.scoreReason : ''

    const analysis = analysisRaw.trim() || '这次回答有思路，但还可以补充更多可量化的结果和细节。'
    const nextQuestion = this.normalizeQuestion(nextQuestionRaw || '请你具体说一次你亲自负责并解决难题的经历。')
    const scoreDelta = Number.isFinite(scoreDeltaRaw)
      ? Math.max(-10, Math.min(10, Math.round(scoreDeltaRaw)))
      : 0
    const scoreReason = scoreReasonRaw.trim() || '信息量一般，本轮分值保持不变。'

    return { analysis, nextQuestion, scoreDelta, scoreReason }
  }

  private safeParseJson(rawText: string): Record<string, unknown> | null {
    const text = rawText.trim()
    const direct = this.tryParse(text)
    if (direct) {
      return direct
    }

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenceMatch?.[1]) {
      const fenced = this.tryParse(fenceMatch[1].trim())
      if (fenced) {
        return fenced
      }
    }

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return this.tryParse(text.slice(start, end + 1))
    }
    return null
  }

  private tryParse(text: string): Record<string, unknown> | null {
    try {
      const data = JSON.parse(text)
      if (data && typeof data === 'object') {
        return data as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private normalizeQuestion(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) {
      return '请先做一个 30 秒的自我介绍，突出与你目标岗位最相关的经历。'
    }
    if (clean.length <= 80) {
      return clean
    }
    return `${clean.slice(0, 80).trim()}...`
  }
}
