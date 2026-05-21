import { ErrorRequestHandler } from 'express'
import { ApiResponse } from '../types'
import { getRequestId } from '../utils/http'

export const errorHandler: ErrorRequestHandler = (error, req, res, _next): void => {
  const requestId = getRequestId(req) ?? 'unknown'

  console.error({
    requestId,
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  })

  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: '数据验证失败',
      details: error.message,
      requestId
    } satisfies ApiResponse)
    return
  }

  if (error.name === 'CastError') {
    res.status(400).json({
      success: false,
      error: '请求参数格式错误',
      requestId
    } satisfies ApiResponse)
    return
  }

  if (error.message && error.message.includes('not found')) {
    res.status(404).json({
      success: false,
      error: error.message,
      requestId
    } satisfies ApiResponse)
    return
  }

  if (error.message && error.message.includes('timeout')) {
    res.status(504).json({
      success: false,
      error: '请求超时，请稍后重试',
      requestId
    } satisfies ApiResponse)
    return
  }

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : error.message,
    requestId
  } satisfies ApiResponse)
}
