import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { ApiResponse } from '../types'
import { getRequestId } from '../utils/http'
import { InterviewService, InterviewTranscriptItem } from '../services/InterviewService'

interface StartInterviewBody {
  providerConfigId: string
  markdown: string
  targetRole?: string
}

interface SubmitInterviewAnswerBody {
  providerConfigId: string
  markdown: string
  targetRole?: string
  transcript?: InterviewTranscriptItem[]
  answer: string
}

export const interviewRoutes = Router()
const interviewService = new InterviewService()

interviewRoutes.post(
  '/start',
  [
    body('providerConfigId').isMongoId().withMessage('无效的提供商配置 ID'),
    body('markdown')
      .isString()
      .trim()
      .isLength({ min: 20, max: 20000 })
      .withMessage('Markdown 内容长度应在 20-20000 之间'),
    body('targetRole')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('目标岗位长度应在 1-120 之间')
  ],
  async (
    req: Request<Record<string, never>, ApiResponse, StartInterviewBody>,
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
      const { providerConfigId, markdown, targetRole } = req.body
      const result = await interviewService.startInterview({
        providerConfigId,
        markdown,
        targetRole
      })

      res.json({
        success: true,
        data: result,
        message: '面试辅导已开始',
        requestId
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '开始面试辅导失败',
        requestId
      })
    }
  }
)

interviewRoutes.post(
  '/answer',
  [
    body('providerConfigId').isMongoId().withMessage('无效的提供商配置 ID'),
    body('markdown')
      .isString()
      .trim()
      .isLength({ min: 20, max: 20000 })
      .withMessage('Markdown 内容长度应在 20-20000 之间'),
    body('targetRole')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('目标岗位长度应在 1-120 之间'),
    body('transcript').optional().isArray({ max: 60 }).withMessage('对话历史最多 60 条'),
    body('transcript.*.role').optional().isIn(['assistant', 'user']).withMessage('无效的消息角色'),
    body('transcript.*.content').optional().isString().trim().isLength({ min: 1, max: 2000 }).withMessage('消息内容长度应在 1-2000 之间'),
    body('answer').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('回答长度应在 1-2000 之间')
  ],
  async (
    req: Request<Record<string, never>, ApiResponse, SubmitInterviewAnswerBody>,
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
      const { providerConfigId, markdown, targetRole, transcript = [], answer } = req.body
      const result = await interviewService.submitAnswer({
        providerConfigId,
        markdown,
        targetRole,
        transcript,
        answer
      })

      res.json({
        success: true,
        data: result,
        message: '回答分析完成',
        requestId
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '分析回答失败',
        requestId
      })
    }
  }
)
