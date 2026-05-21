import { Request, Response, NextFunction } from 'express'
import { getRequestId } from '../utils/http'

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now()
  const requestId = getRequestId(req) ?? 'unknown'

  console.log({
    requestId,
    type: 'request_start',
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  })

  res.on('finish', () => {
    const duration = Date.now() - start

    console.log({
      requestId,
      type: 'request_end',
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || 0
    })
  })

  next()
}
