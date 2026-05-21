import { Router } from 'express'
import { providerRoutes } from './providers'
import { knowledgeRoutes } from './knowledge'
import { tutorRoutes } from './tutor'
import { interviewRoutes } from './interview'
import { authRoutes } from './auth'
import { requireAuth } from '../middleware/auth'

export const apiRoutes = Router()

// 用户认证路由
apiRoutes.use('/auth', authRoutes)

// 提供商配置路由
apiRoutes.use('/providers', requireAuth, providerRoutes)

// 知识点路由
apiRoutes.use('/knowledge', requireAuth, knowledgeRoutes)

// 辅导会话路由
apiRoutes.use('/tutor', requireAuth, tutorRoutes)

// 面试辅导路由
apiRoutes.use('/interview', requireAuth, interviewRoutes)

// 版本信息
apiRoutes.get('/version', (req, res) => {
  res.json({
    version: '1.0.0',
    buildTime: new Date().toISOString(),
    environment: process.env.NODE_ENV
  })
})
