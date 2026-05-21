import { Router, Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { KnowledgeService } from '../services/KnowledgeService'
import { ApiResponse, GradeStage, Subject, LearningTrackType } from '../types'
import { getRequestId, toSingleString } from '../utils/http'

interface GenerateKnowledgeBody {
  trackType?: LearningTrackType
  gradeStage?: GradeStage
  gradeLevel?: number
  subject?: Subject
  careerRole?: string
  careerGoal?: string
  providerConfigId: string
}

interface FindKnowledgeQuery {
  trackType?: string | string[]
  gradeStage?: string | string[]
  gradeLevel?: string | string[]
  subject?: string | string[]
  careerRole?: string | string[]
  page?: string | string[]
  limit?: string | string[]
}

interface UpdateKnowledgeBody {
  chapter?: string
  title?: string
  description?: string
  difficulty?: 1 | 2 | 3 | 4 | 5
  source?: 'ai_generated' | 'manual'
}

export const knowledgeRoutes = Router()
const knowledgeService = new KnowledgeService()

knowledgeRoutes.post(
  '/generate',
  [
    body('trackType').optional().isIn(['k12', 'career']).withMessage('无效的学习轨道类型'),
    body('gradeStage').optional().isIn(['primary', 'junior', 'senior']).withMessage('无效的年级阶段'),
    body('gradeLevel').optional().isInt({ min: 1, max: 12 }).withMessage('年级必须在 1-12 之间'),
    body('subject')
      .optional()
      .isIn(['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'])
      .withMessage('无效的学科'),
    body('careerRole').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('岗位长度应在 1-120 之间'),
    body('careerGoal').optional().isString().trim().isLength({ min: 1, max: 240 }).withMessage('学习方向长度应在 1-240 之间'),
    body('providerConfigId').isString().notEmpty().withMessage('提供商配置 ID 不能为空'),
    body().custom((payload: GenerateKnowledgeBody) => {
      const trackType = payload.trackType || 'k12'
      if (trackType === 'career') {
        if (!payload.careerRole || !payload.careerRole.trim()) {
          throw new Error('职业模式下岗位不能为空')
        }
        return true
      }

      if (!payload.gradeStage || !payload.gradeLevel || !payload.subject) {
        throw new Error('K12 模式下必须填写年级阶段、年级和学科')
      }
      return true
    })
  ],
  async (
    req: Request<Record<string, never>, ApiResponse, GenerateKnowledgeBody>,
    res: Response<ApiResponse>
  ): Promise<void> => {
    const requestId = getRequestId(req)
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: '输入验证失败',
        details: errors.array(),
        requestId
      })
      return
    }

    try {
      const { trackType, gradeStage, gradeLevel, subject, careerRole, careerGoal, providerConfigId } = req.body

      const knowledgePoints = await knowledgeService.generate({
        trackType,
        gradeStage,
        gradeLevel,
        subject,
        careerRole,
        careerGoal,
        providerConfigId
      })

      res.json({
        success: true,
        data: knowledgePoints,
        message: `成功生成 ${knowledgePoints.length} 个知识点`,
        requestId
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '生成知识点失败',
        requestId
      })
    }
  }
)

knowledgeRoutes.get(
  '/',
  [
    query('trackType').optional().isIn(['k12', 'career']).withMessage('无效的学习轨道类型'),
    query('gradeStage').optional().isIn(['primary', 'junior', 'senior']).withMessage('无效的年级阶段'),
    query('gradeLevel').optional().isInt({ min: 1, max: 12 }).withMessage('年级必须在 1-12 之间'),
    query('subject')
      .optional()
      .isIn(['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'])
      .withMessage('无效的学科'),
    query('careerRole').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('岗位长度应在 1-120 之间'),
    query('page').optional().isInt({ min: 1 }).withMessage('页码必须大于 0'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量必须在 1-100 之间')
  ],
  async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    const requestId = getRequestId(req)
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: '输入验证失败',
        details: errors.array(),
        requestId
      })
      return
    }

    try {
      const trackTypeRaw = toSingleString((req.query as FindKnowledgeQuery).trackType)
      const gradeStageRaw = toSingleString((req.query as FindKnowledgeQuery).gradeStage)
      const gradeLevelRaw = toSingleString((req.query as FindKnowledgeQuery).gradeLevel)
      const subjectRaw = toSingleString((req.query as FindKnowledgeQuery).subject)
      const careerRoleRaw = toSingleString((req.query as FindKnowledgeQuery).careerRole)
      const pageRaw = toSingleString((req.query as FindKnowledgeQuery).page)
      const limitRaw = toSingleString((req.query as FindKnowledgeQuery).limit)

      const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1
      const limitNum = limitRaw ? Number.parseInt(limitRaw, 10) : 20

      const result = await knowledgeService.findAll({
        trackType: trackTypeRaw as LearningTrackType | undefined,
        gradeStage: gradeStageRaw as GradeStage | undefined,
        gradeLevel: gradeLevelRaw ? Number.parseInt(gradeLevelRaw, 10) : undefined,
        subject: subjectRaw as Subject | undefined,
        careerRole: careerRoleRaw || undefined,
        page: pageNum,
        limit: limitNum
      })

      res.json({
        success: true,
        data: {
          data: result.data,
          total: result.total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(result.total / limitNum)
        },
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '获取知识点失败',
        requestId
      })
    }
  }
)

knowledgeRoutes.put(
  '/:id',
  [
    param('id').isMongoId().withMessage('无效的知识点 ID'),
    body('chapter').optional().isString().trim().notEmpty().withMessage('章节不能为空'),
    body('title').optional().isString().trim().notEmpty().withMessage('标题不能为空'),
    body('description').optional().isString().trim().notEmpty().withMessage('描述不能为空'),
    body('difficulty').optional().isInt({ min: 1, max: 5 }).withMessage('难度必须在 1-5 之间'),
    body('source').optional().isIn(['ai_generated', 'manual']).withMessage('无效的来源')
  ],
  async (req: Request<{ id: string }, ApiResponse, UpdateKnowledgeBody>, res: Response<ApiResponse>): Promise<void> => {
    const requestId = getRequestId(req)
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: '输入验证失败',
        details: errors.array(),
        requestId
      })
      return
    }

    try {
      const { id } = req.params
      const allowedFields: Array<keyof UpdateKnowledgeBody> = ['chapter', 'title', 'description', 'difficulty', 'source']
      const updates: Record<string, unknown> = {}

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field]
        }
      }

      const knowledgePoint = await knowledgeService.update(id, updates as Partial<UpdateKnowledgeBody>)

      if (!knowledgePoint) {
        res.status(404).json({
          success: false,
          error: '知识点不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        data: knowledgePoint,
        message: '知识点更新成功',
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '更新知识点失败',
        requestId
      })
    }
  }
)

knowledgeRoutes.delete(
  '/:id',
  [param('id').isMongoId().withMessage('无效的知识点 ID')],
  async (req: Request<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
    const requestId = getRequestId(req)
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: '输入验证失败',
        details: errors.array(),
        requestId
      })
      return
    }

    try {
      const { id } = req.params
      const deleted = await knowledgeService.delete(id)

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: '知识点不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        message: '知识点删除成功',
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '删除知识点失败',
        requestId
      })
    }
  }
)
