import { v4 as uuidv4 } from 'uuid'

export const generateRequestId = (): string => {
  return uuidv4()
}

export const formatRequestId = (requestId: string): string => {
  return `req_${requestId.substring(0, 8)}`
}