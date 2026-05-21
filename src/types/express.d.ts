import 'express'

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        userId: string
      }
    }
  }
}

export {}
