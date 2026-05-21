import { Request } from 'express'

export const getRequestId = (req: Request): string | undefined => {
  const raw = req.headers['x-request-id']
  if (Array.isArray(raw)) {
    return raw[0]
  }
  return raw
}

export const toSingleString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}
