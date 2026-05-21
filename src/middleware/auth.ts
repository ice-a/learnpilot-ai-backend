import { NextFunction, Request, Response } from 'express'
import { AuthService } from '../services/AuthService'
import { ApiResponse } from '../types'
import { getRequestId } from '../utils/http'

const authService = new AuthService()

export const requireAuth = (req: Request, res: Response<ApiResponse>, next: NextFunction): void => {
  const requestId = getRequestId(req)
  const authorization = req.headers.authorization || ''

  if (!authorization.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: '未登录或登录已过期',
      requestId
    })
    return
  }

  const token = authorization.slice('Bearer '.length).trim()
  if (!token) {
    res.status(401).json({
      success: false,
      error: '未登录或登录已过期',
      requestId
    })
    return
  }

  try {
    const payload = authService.verifyToken(token)
    req.authUser = {
      userId: payload.userId
    }
    next()
  } catch {
    res.status(401).json({
      success: false,
      error: '未登录或登录已过期',
      requestId
    })
  }
}
