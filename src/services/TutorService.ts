import { TutorSession, TutorMessage, ChatMessage, GradeStage, Subject, LearningTrackType } from '../types'
import { TutorSessionModel } from '../models/TutorSession'
import { TutorMessageModel } from '../models/TutorMessage'
import { KnowledgePointModel } from '../models/KnowledgePoint'
import { AIProviderConfigModel } from '../models/AIProviderConfig'
import { AIGateway } from './AIGateway'

type K12SessionContext = {
  trackType: 'k12'
  gradeStage: GradeStage
  gradeLevel: number
  subject: Subject
}

type CareerSessionContext = {
  trackType: 'career'
  careerRole: string
  careerGoal?: string
}

type SessionContext = K12SessionContext | CareerSessionContext

export class TutorService {
  private aiGateway: AIGateway

  constructor() {
    this.aiGateway = new AIGateway()
  }

  async createSession(params: {
    userId: string
    trackType?: LearningTrackType
    gradeStage?: GradeStage
    gradeLevel?: number
    subject?: Subject
    careerRole?: string
    careerGoal?: string
    providerConfigId: string
    forceNew?: boolean
  }): Promise<TutorSession> {
    const providerExists = await AIProviderConfigModel.exists({ _id: params.providerConfigId })
    if (!providerExists) {
      throw new Error(`Provider config not found: ${params.providerConfigId}`)
    }

    const context = this.resolveSessionContext(params)

    const filter: Record<string, unknown> = {
      userId: params.userId,
      providerConfigId: params.providerConfigId,
      status: 'active',
      trackType: context.trackType
    }

    const insertPayload: Record<string, unknown> = {
      userId: params.userId,
      providerConfigId: params.providerConfigId,
      trackType: context.trackType
    }

    if (context.trackType === 'career') {
      filter.careerRole = context.careerRole
      if (context.careerGoal) {
        filter.careerGoal = context.careerGoal
      }
      insertPayload.careerRole = context.careerRole
      insertPayload.careerGoal = context.careerGoal
    } else {
      filter.gradeStage = context.gradeStage
      filter.gradeLevel = context.gradeLevel
      filter.subject = context.subject
      insertPayload.gradeStage = context.gradeStage
      insertPayload.gradeLevel = context.gradeLevel
      insertPayload.subject = context.subject
    }

    if (params.forceNew) {
      await TutorSessionModel.updateMany(
        { userId: params.userId, status: 'active' },
        { status: 'closed' }
      ).exec()

      const session = await TutorSessionModel.create(insertPayload)
      return this.toTutorSession(session.toObject())
    }

    const session = await TutorSessionModel.findOneAndUpdate(
      filter,
      { $setOnInsert: insertPayload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean().exec()

    if (!session) {
      throw new Error('Failed to create or load session')
    }

    return this.toTutorSession(session)
  }

  async getSession(sessionId: string): Promise<TutorSession | null> {
    const session = await TutorSessionModel.findById(sessionId).lean().exec()
    return session ? this.toTutorSession(session) : null
  }

  async sendMessage(
    sessionId: string,
    userQuestion: string
  ): Promise<{
    response: string
    usage?: {
      prompt: number
      completion: number
      total: number
    }
  }> {
    const session = await TutorSessionModel.findById(sessionId).exec()
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.status === 'closed') {
      throw new Error('Session is closed')
    }

    const sessionContext = this.resolveStoredSessionContext(session)
    const knowledgeFilter = this.buildKnowledgeFilter(sessionContext)

    const knowledgePoints = await KnowledgePointModel.find(knowledgeFilter)
      .sort({ difficulty: 1, createdAt: -1 })
      .limit(30)
      .lean()
      .exec()

    const history = await TutorMessageModel.find({
      sessionId: session._id
    })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean()
      .exec()

    const systemPrompt = this.buildSystemPrompt(sessionContext)
    const contextPrompt = this.buildContextPrompt(knowledgePoints, sessionContext)
    const turnPrompt = this.buildTurnPrompt()

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: contextPrompt },
      { role: 'system', content: turnPrompt },
      ...history.map(msg => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: userQuestion }
    ]

    try {
      await TutorMessageModel.create({
        sessionId: session._id,
        role: 'user',
        content: userQuestion
      })

      const aiResponse = await this.aiGateway.chat(session.providerConfigId.toString(), messages, {
        temperature: 0.7,
        maxTokens: 900
      })

      await TutorMessageModel.create({
        sessionId: session._id,
        role: 'assistant',
        content: aiResponse.text,
        tokenUsage: aiResponse.usage
      })

      return {
        response: aiResponse.text,
        usage: aiResponse.usage
      }
    } catch (error) {
      console.error('Tutor service error:', error)
      throw new Error(`Failed to get AI response: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async getMessages(sessionId: string, limit = 50): Promise<TutorMessage[]> {
    const messages = await TutorMessageModel.find({
      sessionId
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec()

    return messages.map(item => this.toTutorMessage(item))
  }

  async closeSession(sessionId: string): Promise<TutorSession | null> {
    const session = await TutorSessionModel.findByIdAndUpdate(
      sessionId,
      { status: 'closed' },
      { new: true }
    )
      .lean()
      .exec()

    return session ? this.toTutorSession(session) : null
  }

  async getUserSessions(userId: string): Promise<TutorSession[]> {
    const sessions = await TutorSessionModel.find({
      userId
    })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return sessions.map(item => this.toTutorSession(item))
  }

  private resolveSessionContext(params: {
    trackType?: LearningTrackType
    gradeStage?: GradeStage
    gradeLevel?: number
    subject?: Subject
    careerRole?: string
    careerGoal?: string
  }): SessionContext {
    const trackType = params.trackType || 'k12'

    if (trackType === 'career') {
      const careerRole = (params.careerRole || '').trim()
      if (!careerRole) {
        throw new Error('职业模式下岗位不能为空')
      }

      const careerGoal = (params.careerGoal || '').trim()
      return {
        trackType: 'career',
        careerRole,
        careerGoal: careerGoal || undefined
      }
    }

    if (!params.gradeStage || !params.gradeLevel || !params.subject) {
      throw new Error('K12 模式下必须填写年级阶段、年级和学科')
    }

    return {
      trackType: 'k12',
      gradeStage: params.gradeStage,
      gradeLevel: params.gradeLevel,
      subject: params.subject
    }
  }

  private resolveStoredSessionContext(session: any): SessionContext {
    const trackType = (session.trackType as LearningTrackType) || 'k12'

    if (trackType === 'career') {
      const careerRole = String(session.careerRole || '').trim()
      if (!careerRole) {
        throw new Error('职业会话缺少岗位信息')
      }

      const careerGoal = String(session.careerGoal || '').trim()
      return {
        trackType: 'career',
        careerRole,
        careerGoal: careerGoal || undefined
      }
    }

    return {
      trackType: 'k12',
      gradeStage: session.gradeStage,
      gradeLevel: session.gradeLevel,
      subject: session.subject
    }
  }

  private buildKnowledgeFilter(context: SessionContext): Record<string, unknown> {
    if (context.trackType === 'career') {
      const filter: Record<string, unknown> = {
        trackType: 'career',
        careerRole: context.careerRole
      }
      if (context.careerGoal) {
        filter.careerGoal = context.careerGoal
      }
      return filter
    }

    return {
      gradeStage: context.gradeStage,
      gradeLevel: context.gradeLevel,
      subject: context.subject,
      $or: [{ trackType: 'k12' }, { trackType: { $exists: false } }]
    }
  }

  private toTutorSession(item: any): TutorSession {
    return {
      _id: item._id?.toString?.() ?? item._id,
      userId: item.userId,
      trackType: (item.trackType as LearningTrackType) || 'k12',
      gradeStage: item.gradeStage,
      gradeLevel: item.gradeLevel,
      subject: item.subject,
      careerRole: item.careerRole,
      careerGoal: item.careerGoal,
      providerConfigId: item.providerConfigId?.toString?.() ?? item.providerConfigId,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  }

  private toTutorMessage(item: any): TutorMessage {
    return {
      _id: item._id?.toString?.() ?? item._id,
      sessionId: item.sessionId?.toString?.() ?? item.sessionId,
      role: item.role,
      content: item.content,
      tokenUsage: item.tokenUsage,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  }

  private buildSystemPrompt(context: SessionContext): string {
    const guidedRules = [
      '请采用引导式辅导，不要一次性把全部结论直接丢给用户。',
      '每轮必须先响应用户刚输入的内容，明确他当前卡点或目标，再继续讲解。',
      '每次回复按“先确认目标 -> 讲 1 个关键点 -> 给 1 个小练习 -> 用 1 个问题收尾”组织。',
      '除非用户明确要求“直接答案”，否则优先给提示和思路，再给答案。',
      '回复尽量简洁，控制在 3-6 句，避免长篇罗列。',
      '单次回复总长度尽量不超过 180 个中文字符；超出内容请分轮次继续讲。',
      '最多给 3 个要点，每个要点最多 2 句；不输出大段列表。'
    ].join('\n')

    if (context.trackType === 'career') {
      return `你是岗位“${context.careerRole}”的 AI 学习教练。
${context.careerGoal ? `学习目标：${context.careerGoal}。` : ''}
请用“讲解 -> 示例 -> 可执行练习 -> 反馈标准”的结构来辅导，避免空泛描述。
${guidedRules}`
    }

    const stageNames: Record<GradeStage, string> = {
      primary: '小学',
      junior: '初中',
      senior: '高中'
    }

    const subjectNames: Record<Subject, string> = {
      math: '数学',
      chinese: '语文',
      english: '英语',
      physics: '物理',
      chemistry: '化学',
      biology: '生物',
      history: '历史',
      geography: '地理',
      politics: '政治'
    }

    return `你是 ${stageNames[context.gradeStage]} ${context.gradeLevel} 年级 ${subjectNames[context.subject]} 学科的 AI 辅导老师。
请使用循序渐进的方式讲解，并给出可执行的练习建议。
${guidedRules}`
  }

  private buildContextPrompt(knowledgePoints: any[], context: SessionContext): string {
    if (knowledgePoints.length === 0) {
      return context.trackType === 'career'
        ? '当前暂无匹配岗位知识点，请结合岗位通用能力与实战任务进行辅导。'
        : '当前暂无相关知识点数据，请基于学科基础知识进行辅导。'
    }

    const contextLines = knowledgePoints
      .slice(0, 10)
      .map(kp => `【${kp.chapter}】${kp.title}（难度：${kp.difficulty}/5）\n${kp.description}`)
      .join('\n\n')

    return `相关知识点参考：\n\n${contextLines}\n\n请只选择与用户当前问题最相关的 1-2 个知识点展开讲解；示例最多 1 个。`
  }

  private buildTurnPrompt(): string {
    return [
      '本轮对话要求：',
      '1) 先用 1 句话确认你理解了用户刚输入的内容。',
      '2) 再给出下一步引导，不要跳过用户输入直接讲新内容。',
      '3) 结尾必须给 1 个追问，引导用户继续思考或继续作答。'
    ].join('\n')
  }
}
