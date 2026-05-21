import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { Request, Response, NextFunction } from 'express'

// 加载环境变量
if (process.env.NODE_ENV !== 'production') {
  dotenv.config()
}

import { apiRoutes } from './routes'
import { errorHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
import { generateRequestId } from './utils/requestId'
import { initDefaultProviders } from './scripts/initDefaultProviders'

const app = express()
const PORT = process.env.PORT || 3000

// 安全中间件
app.use(helmet({
  crossOriginResourcePolicy: false,
}))

// CORS配置
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://yourdomain.com']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}))

// 速率限制
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 60, // 每分钟最多60个请求
  message: {
    success: false,
    error: '请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api/', limiter)

// 请求处理中间件 - 先生成 request ID，再记录日志
app.use((req: Request, res: Response, next: NextFunction) => {
  req.headers['x-request-id'] = generateRequestId()
  next()
})
app.use(requestLogger)

// 解析中间件
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  })
})

// API路由
app.use('/api/v1', apiRoutes)

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: '路由不存在',
    requestId: req.headers['x-request-id']
  })
})

// 错误处理中间件
app.use(errorHandler)

// 数据库连接
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is required')
    }

    await mongoose.connect(mongoUri)
    console.log('MongoDB connected successfully')
  } catch (error) {
    console.error('MongoDB connection error:', error)
    process.exit(1)
  }
}

// 启动服务器
const startServer = async () => {
  await connectDB()

  // 初始化默认AI提供商配置
  await initDefaultProviders()

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`Health check: http://localhost:${PORT}/health`)
  })
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

startServer().catch(console.error)

export default app