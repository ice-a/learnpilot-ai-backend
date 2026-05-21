import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { AuthService } from '../services/AuthService'
import { ApiResponse } from '../types'
import { getRequestId } from '../utils/http'
import { requireAuth } from '../middleware/auth'

interface ChallengeBody {
  purpose: 'login' | 'register'
}

interface RegisterBody {
  email: string
  password: string
  displayName?: string
  challengeId: string
  challengeProof: string
}

interface LoginBody {
  email: string
  password: string
  challengeId: string
  challengeProof: string
}

interface ForgotPasswordBody {
  email: string
}

interface ResetPasswordBody {
  email: string
  token: string
  newPassword: string
}

interface UnlockVerifyBody {
  email: string
  token: string
}

interface UpdateProfileBody {
  displayName?: string
  learningDirection?: string
  learningGoal?: string
  preferredProviderConfigId?: string | null
  interviewProfile?: {
    targetRole?: string
    focusDirection?: string
    selfIntroduction?: string
  }
}

interface AppendProfileSessionBody {
  role?: 'user' | 'assistant' | 'system'
  content: string
}

export const authRoutes = Router()
const authService = new AuthService()

authRoutes.post(
  '/challenge',
  [body('purpose').isIn(['login', 'register']).withMessage('无效的挑战类型')],
  async (req: Request<Record<string, never>, ApiResponse, ChallengeBody>, res: Response<ApiResponse>): Promise<void> => {
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

    const result = authService.createChallenge(req.body.purpose)
    res.json({
      success: true,
      data: result,
      requestId
    })
  }
)

authRoutes.post(
  '/register',
  [
    body('email').isEmail().withMessage('请输入有效邮箱'),
    body('password').isLength({ min: 8, max: 64 }).withMessage('密码长度应在 8-64 之间'),
    body('displayName').optional().isString().trim().isLength({ min: 1, max: 60 }).withMessage('昵称长度应在 1-60 之间'),
    body('challengeId').isString().trim().notEmpty().withMessage('challengeId 不能为空'),
    body('challengeProof').isString().trim().isLength({ min: 32 }).withMessage('challengeProof 无效')
  ],
  async (req: Request<Record<string, never>, ApiResponse, RegisterBody>, res: Response<ApiResponse>): Promise<void> => {
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
      const result = await authService.register(req.body)
      res.status(201).json({
        success: true,
        data: result,
        message: '注册成功',
        requestId
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '注册失败',
        requestId
      })
    }
  }
)

authRoutes.post(
  '/login',
  [
    body('email').isEmail().withMessage('请输入有效邮箱'),
    body('password').isLength({ min: 8, max: 64 }).withMessage('密码长度应在 8-64 之间'),
    body('challengeId').isString().trim().notEmpty().withMessage('challengeId 不能为空'),
    body('challengeProof').isString().trim().isLength({ min: 32 }).withMessage('challengeProof 无效')
  ],
  async (req: Request<Record<string, never>, ApiResponse, LoginBody>, res: Response<ApiResponse>): Promise<void> => {
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
      const result = await authService.login({
        ...req.body,
        ip: req.ip || 'unknown'
      })
      res.json({
        success: true,
        data: result,
        message: '登录成功',
        requestId
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败'
      const status = message.includes('频繁') ? 429 : 400
      res.status(status).json({
        success: false,
        error: message,
        requestId
      })
    }
  }
)

authRoutes.post(
  '/password/forgot',
  [body('email').isEmail().withMessage('请输入有效邮箱')],
  async (req: Request<Record<string, never>, ApiResponse, ForgotPasswordBody>, res: Response<ApiResponse>): Promise<void> => {
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

    await authService.requestPasswordReset(req.body.email)
    res.json({
      success: true,
      message: '如果邮箱存在，重置邮件已发送',
      requestId
    })
  }
)

authRoutes.post(
  '/password/reset',
  [
    body('email').isEmail().withMessage('请输入有效邮箱'),
    body('token').isString().trim().isLength({ min: 16 }).withMessage('无效的重置令牌'),
    body('newPassword').isLength({ min: 8, max: 64 }).withMessage('新密码长度应在 8-64 之间')
  ],
  async (req: Request<Record<string, never>, ApiResponse, ResetPasswordBody>, res: Response<ApiResponse>): Promise<void> => {
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
      await authService.resetPassword(req.body)
      res.json({
        success: true,
        message: '密码已重置',
        requestId
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '重置密码失败',
        requestId
      })
    }
  }
)

authRoutes.post(
  '/unlock/request',
  [body('email').isEmail().withMessage('请输入有效邮箱')],
  async (req: Request<Record<string, never>, ApiResponse, ForgotPasswordBody>, res: Response<ApiResponse>): Promise<void> => {
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

    await authService.requestUnlockEmail(req.body.email)
    res.json({
      success: true,
      message: '如果账号被锁定，验证邮件已发送',
      requestId
    })
  }
)

authRoutes.post(
  '/unlock/verify',
  [
    body('email').isEmail().withMessage('请输入有效邮箱'),
    body('token').isString().trim().isLength({ min: 16 }).withMessage('无效的验证令牌')
  ],
  async (req: Request<Record<string, never>, ApiResponse, UnlockVerifyBody>, res: Response<ApiResponse>): Promise<void> => {
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
      await authService.verifyUnlock(req.body)
      res.json({
        success: true,
        message: '账号已解锁，请重新登录',
        requestId
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '账号验证失败',
        requestId
      })
    }
  }
)

authRoutes.get('/me', requireAuth, async (req: Request, res: Response<ApiResponse>): Promise<void> => {
  const requestId = getRequestId(req)
  if (!req.authUser?.userId) {
    res.status(401).json({
      success: false,
      error: '未登录或登录已过期',
      requestId
    })
    return
  }

  const user = await authService.getMe(req.authUser.userId)
  if (!user) {
    res.status(404).json({
      success: false,
      error: '用户不存在',
      requestId
    })
    return
  }

  res.json({
    success: true,
    data: user,
    requestId
  })
})

authRoutes.get('/profile', requireAuth, async (req: Request, res: Response<ApiResponse>): Promise<void> => {
  const requestId = getRequestId(req)
  if (!req.authUser?.userId) {
    res.status(401).json({
      success: false,
      error: '未登录或登录已过期',
      requestId
    })
    return
  }

  const profile = await authService.getProfile(req.authUser.userId)
  if (!profile) {
    res.status(404).json({
      success: false,
      error: '用户不存在',
      requestId
    })
    return
  }

  res.json({
    success: true,
    data: profile,
    requestId
  })
})

authRoutes.put(
  '/profile',
  requireAuth,
  [
    body('displayName').optional().isString().trim().isLength({ min: 1, max: 60 }).withMessage('昵称长度应在 1-60 之间'),
    body('learningDirection').optional().isString().trim().isLength({ max: 120 }).withMessage('学习方向长度应在 1-120 之间'),
    body('learningGoal').optional().isString().trim().isLength({ max: 240 }).withMessage('学习目标长度应在 1-240 之间'),
    body('preferredProviderConfigId')
      .optional({ nullable: true })
      .custom(value => value === null || (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)))
      .withMessage('个人模型配置 ID 无效'),
    body('interviewProfile').optional().isObject().withMessage('面试信息格式错误'),
    body('interviewProfile.targetRole').optional().isString().trim().isLength({ max: 120 }).withMessage('目标岗位长度应在 1-120 之间'),
    body('interviewProfile.focusDirection').optional().isString().trim().isLength({ max: 240 }).withMessage('面试关注方向长度应在 1-240 之间'),
    body('interviewProfile.selfIntroduction').optional().isString().trim().isLength({ max: 1200 }).withMessage('面试自我介绍长度应在 1-1200 之间')
  ],
  async (req: Request<Record<string, never>, ApiResponse, UpdateProfileBody>, res: Response<ApiResponse>): Promise<void> => {
    const requestId = getRequestId(req)
    if (!req.authUser?.userId) {
      res.status(401).json({
        success: false,
        error: '未登录或登录已过期',
        requestId
      })
      return
    }

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
      const profile = await authService.updateProfile(req.authUser.userId, req.body)
      res.json({
        success: true,
        data: profile,
        message: '个人信息已保存',
        requestId
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新个人信息失败',
        requestId
      })
    }
  }
)

authRoutes.post(
  '/profile/session',
  requireAuth,
  [
    body('role').optional().isIn(['user', 'assistant', 'system']).withMessage('会话角色无效'),
    body('content').isString().trim().isLength({ min: 1, max: 500 }).withMessage('会话内容长度应在 1-500 之间')
  ],
  async (
    req: Request<Record<string, never>, ApiResponse, AppendProfileSessionBody>,
    res: Response<ApiResponse>
  ): Promise<void> => {
    const requestId = getRequestId(req)
    if (!req.authUser?.userId) {
      res.status(401).json({
        success: false,
        error: '未登录或登录已过期',
        requestId
      })
      return
    }

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
      const profile = await authService.appendPersonalInfoMessage(req.authUser.userId, {
        role: req.body.role,
        content: req.body.content
      })
      res.status(201).json({
        success: true,
        data: profile,
        message: '个人信息会话已记录',
        requestId
      })
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '记录个人会话失败',
        requestId
      })
    }
  }
)
