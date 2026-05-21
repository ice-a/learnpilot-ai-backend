import { KnowledgePoint, GradeStage, Subject, LearningTrackType } from '../types'
import { KnowledgePointModel } from '../models/KnowledgePoint'
import { AIGateway } from './AIGateway'

type K12TrackContext = {
  trackType: 'k12'
  gradeStage: GradeStage
  gradeLevel: number
  subject: Subject
}

type CareerTrackContext = {
  trackType: 'career'
  careerRole: string
  careerGoal?: string
}

type TrackContext = K12TrackContext | CareerTrackContext

export class KnowledgeService {
  private aiGateway: AIGateway

  constructor() {
    this.aiGateway = new AIGateway()
  }

  async generate(params: {
    trackType?: LearningTrackType
    gradeStage?: GradeStage
    gradeLevel?: number
    subject?: Subject
    careerRole?: string
    careerGoal?: string
    providerConfigId: string
  }): Promise<KnowledgePoint[]> {
    const context = this.resolveTrackContext(params)

    const existing = await this.findLatest(context)
    if (existing.length > 0) {
      return existing
    }

    const { systemPrompt, userPrompt } = this.buildKnowledgePrompts(context)

    const result = await this.aiGateway.chat(
      params.providerConfigId,
      [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      {
        responseFormat: 'json',
        temperature: 0.3
      }
    )

    const knowledgeList = this.parseAndValidateKnowledgeJSON(result.text, context)

    const savedKnowledge = await KnowledgePointModel.insertMany(
      knowledgeList.map(item => ({
        ...item,
        source: 'ai_generated',
        version: 1
      }))
    )

    return savedKnowledge.map(item => this.toKnowledgePoint(item))
  }

  async findLatest(context: TrackContext): Promise<KnowledgePoint[]> {
    const filter: Record<string, unknown> = {}

    if (context.trackType === 'k12') {
      filter.$or = [{ trackType: 'k12' }, { trackType: { $exists: false } }]
      filter.gradeStage = context.gradeStage
      filter.gradeLevel = context.gradeLevel
      filter.subject = context.subject
    } else {
      filter.trackType = 'career'
      filter.careerRole = context.careerRole
      if (context.careerGoal) {
        filter.careerGoal = context.careerGoal
      }
    }

    const items = await KnowledgePointModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec()

    return items.map(item => this.toKnowledgePoint(item))
  }

  async findAll(params: {
    trackType?: LearningTrackType
    gradeStage?: GradeStage
    gradeLevel?: number
    subject?: Subject
    careerRole?: string
    page?: number
    limit?: number
  }): Promise<{ data: KnowledgePoint[]; total: number }> {
    const { trackType, gradeStage, gradeLevel, subject, careerRole, page = 1, limit = 20 } = params

    const filter: Record<string, unknown> = {}

    if (trackType === 'k12') {
      filter.$or = [{ trackType: 'k12' }, { trackType: { $exists: false } }]
    }

    if (trackType === 'career') {
      filter.trackType = 'career'
    }

    if (gradeStage) {
      filter.gradeStage = gradeStage
    }
    if (gradeLevel) {
      filter.gradeLevel = gradeLevel
    }
    if (subject) {
      filter.subject = subject
    }
    if (careerRole) {
      filter.careerRole = careerRole
    }

    const [data, total] = await Promise.all([
      KnowledgePointModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      KnowledgePointModel.countDocuments(filter).exec()
    ])

    return {
      data: data.map(item => this.toKnowledgePoint(item)),
      total
    }
  }

  async update(id: string, updates: Partial<KnowledgePoint>): Promise<KnowledgePoint | null> {
    const item = await KnowledgePointModel.findByIdAndUpdate(
      id,
      {
        ...updates,
        $inc: { version: 1 }
      },
      { new: true }
    )
      .lean()
      .exec()

    return item ? this.toKnowledgePoint(item) : null
  }

  async delete(id: string): Promise<boolean> {
    const result = await KnowledgePointModel.findByIdAndDelete(id).exec()
    return result !== null
  }

  private resolveTrackContext(params: {
    trackType?: LearningTrackType
    gradeStage?: GradeStage
    gradeLevel?: number
    subject?: Subject
    careerRole?: string
    careerGoal?: string
  }): TrackContext {
    const trackType = params.trackType || 'k12'

    if (trackType === 'career') {
      const careerRole = (params.careerRole || '').trim()
      const careerGoal = (params.careerGoal || '').trim()

      if (!careerRole) {
        throw new Error('岗位不能为空')
      }

      return {
        trackType: 'career',
        careerRole,
        careerGoal: careerGoal || undefined
      }
    }

    if (!params.gradeStage || !params.gradeLevel || !params.subject) {
      throw new Error('K12 模式下年级阶段、年级和学科不能为空')
    }

    return {
      trackType: 'k12',
      gradeStage: params.gradeStage,
      gradeLevel: params.gradeLevel,
      subject: params.subject
    }
  }

  private toKnowledgePoint(item: any): KnowledgePoint {
    return {
      _id: item._id?.toString?.() ?? item._id,
      trackType: (item.trackType as LearningTrackType) || 'k12',
      gradeStage: item.gradeStage,
      gradeLevel: item.gradeLevel,
      subject: item.subject,
      careerRole: item.careerRole,
      careerGoal: item.careerGoal,
      chapter: item.chapter,
      title: item.title,
      description: item.description,
      difficulty: item.difficulty,
      source: item.source,
      version: item.version,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  }

  private buildKnowledgePrompts(context: TrackContext): { systemPrompt: string; userPrompt: string } {
    if (context.trackType === 'career') {
      return {
        systemPrompt:
          '你是职业学习路径设计专家，请严格输出 JSON 数组，每项只包含 chapter、title、description、difficulty，difficulty 必须是 1-5 的整数。',
        userPrompt: this.buildCareerPrompt(context)
      }
    }

    return {
      systemPrompt:
        '你是 K12 教育教研专家，专门负责生成符合教学大纲的学科知识点。请严格按照 JSON 数组格式输出，每个知识点包含 chapter、title、description 和 difficulty 字段。',
      userPrompt: this.buildK12Prompt(context)
    }
  }

  private buildK12Prompt(context: K12TrackContext): string {
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

    return `请为 ${stageNames[context.gradeStage]} ${context.gradeLevel} 年级 ${subjectNames[context.subject]} 学科生成核心知识点。
要求：
1. 按教材章节组织知识点。
2. 每个知识点字段必须包含 chapter、title、description、difficulty。
3. difficulty 仅允许 1-5 的整数。
4. 输出格式必须是 JSON 数组。
5. 生成数量：${context.gradeStage === 'primary' ? '10-15' : context.gradeStage === 'junior' ? '15-20' : '20-25'}。`
  }

  private buildCareerPrompt(context: CareerTrackContext): string {
    return `请为岗位“${context.careerRole}”生成可执行的学习计划知识点。
${context.careerGoal ? `学习方向：${context.careerGoal}。` : '学习方向：请覆盖通用能力 + 岗位核心能力。'}
要求：
1. 按学习阶段组织章节（例如：入门基础、核心技能、实战项目、求职提升）。
2. 每个知识点字段必须包含 chapter、title、description、difficulty。
3. description 要明确“学什么 + 怎么练 + 产出什么”。
4. difficulty 仅允许 1-5 的整数。
5. 输出格式必须是 JSON 数组。
6. 生成数量：12-18。`
  }

  private parseAndValidateKnowledgeJSON(
    jsonText: string,
    context: TrackContext
  ): Omit<KnowledgePoint, '_id' | 'createdAt' | 'updatedAt'>[] {
    try {
      const parsed = this.parseKnowledgePayload(jsonText)

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array')
      }

      return parsed.map((item, index) => {
        if (!item.chapter || !item.title || !item.description || typeof item.difficulty !== 'number') {
          throw new Error(`Invalid knowledge point at index ${index}: missing required fields`)
        }

        if (![1, 2, 3, 4, 5].includes(item.difficulty)) {
          throw new Error(`Invalid difficulty at index ${index}: must be 1-5`)
        }

        const baseItem = {
          trackType: context.trackType,
          chapter: String(item.chapter).trim(),
          title: String(item.title).trim(),
          description: String(item.description).trim(),
          difficulty: item.difficulty as 1 | 2 | 3 | 4 | 5,
          source: 'ai_generated' as const,
          version: 1
        }

        if (context.trackType === 'career') {
          return {
            ...baseItem,
            careerRole: context.careerRole,
            careerGoal: context.careerGoal
          }
        }

        return {
          ...baseItem,
          gradeStage: context.gradeStage,
          gradeLevel: context.gradeLevel,
          subject: context.subject
        }
      })
    } catch (error) {
      throw new Error(`Failed to parse AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private parseKnowledgePayload(rawText: string): unknown {
    const candidates = this.buildJsonCandidates(rawText)
    let lastError: unknown = undefined

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate)
        if (Array.isArray(parsed)) {
          return parsed
        }

        if (parsed && typeof parsed === 'object') {
          const maybeArray = (parsed as { data?: unknown; knowledgePoints?: unknown }).data
            ?? (parsed as { data?: unknown; knowledgePoints?: unknown }).knowledgePoints
          if (Array.isArray(maybeArray)) {
            return maybeArray
          }
        }
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('No valid JSON payload found')
  }

  private buildJsonCandidates(rawText: string): string[] {
    const text = rawText.trim()
    const candidates: string[] = [text]

    const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    for (const match of fencedMatches) {
      if (match[1]) {
        candidates.push(match[1].trim())
      }
    }

    const firstArrayStart = text.indexOf('[')
    const lastArrayEnd = text.lastIndexOf(']')
    if (firstArrayStart !== -1 && lastArrayEnd > firstArrayStart) {
      candidates.push(text.slice(firstArrayStart, lastArrayEnd + 1))
    }

    const firstObjectStart = text.indexOf('{')
    const lastObjectEnd = text.lastIndexOf('}')
    if (firstObjectStart !== -1 && lastObjectEnd > firstObjectStart) {
      candidates.push(text.slice(firstObjectStart, lastObjectEnd + 1))
    }

    return [...new Set(candidates)]
  }
}
