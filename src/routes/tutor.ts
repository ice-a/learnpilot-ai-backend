import { Router, Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { TutorService } from '../services/TutorService'
import { ApiResponse, GradeStage, Subject, LearningTrackType } from '../types'
import { getRequestId, toSingleString } from '../utils/http'

interface CreateSessionBody {
  userId?: string
  trackType?: LearningTrackType
  gradeStage?: GradeStage
  gradeLevel?: number
  subject?: Subject
  careerRole?: string
  careerGoal?: string
  providerConfigId: string
  forceNew?: boolean
}

interface SendMessageBody {
  message: string
}

interface MessageQuery {
  limit?: string | string[]
}

interface UserSessionsQuery {
  userId?: string | string[]
}

export const tutorRoutes = Router()
const tutorService = new TutorService()

tutorRoutes.post(
  '/sessions',
  [
    body('trackType').optional().isIn(['k12', 'career']).withMessage('无效的学习轨道类型'),
    body('gradeStage').optional().isIn(['primary', 'junior', 'senior']).withMessage('无效的年级阶段'),
    body('gradeLevel').optional().isInt({ min: 1, max: 12 }).withMessage('年级必须在 1-12 之间'),
    body('subject')
      .optional()
      .isIn(['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'])
      .withMessage('无效的学科'),
    body('careerRole').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('岗位长度应在 1-120 之间'),
    body('careerGoal').optional().isString().trim().isLength({ min: 1, max: 240 }).withMessage('目标长度应在 1-240 之间'),
    body('providerConfigId').isMongoId().withMessage('无效的提供商配置 ID'),
    body('forceNew').optional().isBoolean().withMessage('forceNew 必须是布尔值'),
    body().custom((payload: CreateSessionBody) => {
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
    req: Request<Record<string, never>, ApiResponse, CreateSessionBody>,
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
      const { trackType, gradeStage, gradeLevel, subject, careerRole, careerGoal, providerConfigId, forceNew } = req.body
      if (!req.authUser?.userId) {
        res.status(401).json({
          success: false,
          error: '未登录或登录已过期',
          requestId
        })
        return
      }
      const session = await tutorService.createSession({
        userId: req.authUser.userId,
        trackType,
        gradeStage,
        gradeLevel,
        subject,
        careerRole,
        careerGoal,
        providerConfigId,
        forceNew
      })

      res.status(201).json({
        success: true,
        data: session,
        message: '辅导会话创建成功',
        requestId
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '创建会话失败',
        requestId
      })
    }
  }
)

tutorRoutes.get(
  '/sessions/:id',
  [param('id').isMongoId().withMessage('无效的会话 ID')],
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
      const session = await tutorService.getSession(id)

      if (!session) {
        res.status(404).json({
          success: false,
          error: '会话不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        data: session,
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '获取会话失败',
        requestId
      })
    }
  }
)

tutorRoutes.post(
  '/sessions/:id/messages',
  [
    param('id').isMongoId().withMessage('无效的会话 ID'),
    body('message').isString().trim().notEmpty().withMessage('消息内容不能为空')
  ],
  async (req: Request<{ id: string }, ApiResponse, SendMessageBody>, res: Response<ApiResponse>): Promise<void> => {
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
      const { message } = req.body

      if (message.length > 2000) {
        res.status(400).json({
          success: false,
          error: '消息内容过长，请限制在 2000 字符以内',
          requestId
        })
        return
      }

      const result = await tutorService.sendMessage(id, message)
      res.json({
        success: true,
        data: {
          response: result.response,
          usage: result.usage
        },
        message: '消息发送成功',
        requestId
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送消息失败'
      const status = message.toLowerCase().includes('timeout') ? 504 : 500
      res.status(status).json({
        success: false,
        error: status === 504 ? 'AI 响应超时，请稍后重试或调大模型超时配置' : message,
        requestId
      })
    }
  }
)

tutorRoutes.get(
  '/sessions/:id/messages',
  [
    param('id').isMongoId().withMessage('无效的会话 ID'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('消息数量限制必须在 1-100 之间')
  ],
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
      const limitRaw = toSingleString((req.query as MessageQuery).limit)
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50

      const messages = await tutorService.getMessages(id, limit)
      res.json({
        success: true,
        data: messages,
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '获取消息历史失败',
        requestId
      })
    }
  }
)

tutorRoutes.post(
  '/sessions/:id/close',
  [param('id').isMongoId().withMessage('无效的会话 ID')],
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
      const session = await tutorService.closeSession(id)

      if (!session) {
        res.status(404).json({
          success: false,
          error: '会话不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        data: session,
        message: '会话已结束',
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '结束会话失败',
        requestId
      })
    }
  }
)

tutorRoutes.get(
  '/sessions',
  async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    const requestId = getRequestId(req)
    if (!req.authUser?.userId) {
      res.status(400).json({
        success: false,
        error: '未登录或登录已过期',
        requestId
      })
      return
    }

    try {
      const sessions = await tutorService.getUserSessions(req.authUser.userId)
      res.json({
        success: true,
        data: sessions,
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '获取用户会话失败',
        requestId
      })
    }
  }
)
