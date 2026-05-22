import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs/promises'
import jwt from 'jsonwebtoken'
import path from 'path'
import { Types } from 'mongoose'
import { AIProviderConfigModel } from '../models/AIProviderConfig'
import { UserDocument, UserModel } from '../models/User'
import { EmailService } from './EmailService'

type ChallengePurpose = 'login' | 'register'

type ChallengePayload = {
  challengeText: string
  purpose: ChallengePurpose
  expiresAt: number
}

export type AuthUser = {
  id: string
  email: string
  displayName: string
  preferredProviderConfigId?: string
}

export type AuthResult = {
  token: string
  user: AuthUser
}

export type UserProfilePublic = AuthUser & {
  learningDirection?: string
  learningGoal?: string
  personalInfoSession: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    createdAt: string
  }>
  interviewProfile: {
    targetRole?: string
    focusDirection?: string
    selfIntroduction?: string
  }
}

type UpdateUserProfileParams = {
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

const CHALLENGE_TTL_MS = 2 * 60 * 1000
const LOGIN_WINDOW_MS = 60 * 1000
const MAX_LOGIN_PER_IP_PER_MINUTE = 5
const UNLOCK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
const PROFILE_SESSION_MAX_ITEMS = 80

export class AuthService {
  private static challengeStore = new Map<string, ChallengePayload>()
  private static ipLoginAttempts = new Map<string, number[]>()
  private emailService: EmailService

  constructor() {
    this.emailService = new EmailService()
  }

  createChallenge(purpose: ChallengePurpose): { challengeId: string; challengeText: string; expiresInSec: number } {
    this.cleanExpiredChallenges()

    const challengeId = crypto.randomUUID()
    const challengeText = crypto.randomBytes(16).toString('hex')
    const expiresAt = Date.now() + CHALLENGE_TTL_MS
    AuthService.challengeStore.set(challengeId, {
      challengeText,
      purpose,
      expiresAt
    })

    return {
      challengeId,
      challengeText,
      expiresInSec: Math.floor(CHALLENGE_TTL_MS / 1000)
    }
  }

  async register(params: {
    email: string
    password: string
    displayName?: string
    challengeId: string
    challengeProof: string
  }): Promise<AuthResult> {
    const email = this.normalizeEmail(params.email)
    const displayName = (params.displayName || email.split('@')[0]).trim().slice(0, 60)
    this.verifyChallenge({
      challengeId: params.challengeId,
      purpose: 'register',
      email,
      password: params.password,
      challengeProof: params.challengeProof
    })

    const exists = await UserModel.findOne({ email }).lean().exec()
    if (exists) {
      throw new Error('该邮箱已注册')
    }

    const passwordHash = await bcrypt.hash(params.password, 12)
    const user = await UserModel.create({
      email,
      displayName: displayName || '用户',
      passwordHash,
      emailVerified: true,
      unlockRequired: false,
      personalInfoSession: [],
      interviewProfile: {}
    })

    try {
      await this.sendRegisterSuccessEmail(user)
    } catch (error) {
      console.warn('[AuthService] Register success email send failed', {
        email: user.email,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return this.buildAuthResult(user)
  }

  async login(params: {
    email: string
    password: string
    ip: string
    challengeId: string
    challengeProof: string
  }): Promise<AuthResult> {
    const email = this.normalizeEmail(params.email)
    this.verifyChallenge({
      challengeId: params.challengeId,
      purpose: 'login',
      email,
      password: params.password,
      challengeProof: params.challengeProof
    })

    const user = await UserModel.findOne({ email }).exec()
    const ipExceeded = this.recordLoginAttemptAndCheckLimit(params.ip)

    if (ipExceeded && user) {
      await this.lockUserForTodayAndSendUnlockEmail(user)
      throw new Error('当前 IP 登录过于频繁，该账号今日已锁定，请先完成邮箱验证解锁')
    }

    if (!user) {
      throw new Error('邮箱或密码错误')
    }

    if (this.isUserBlocked(user) || user.unlockRequired) {
      throw new Error('账号已被锁定，请通过邮箱验证后再登录')
    }

    const ok = await bcrypt.compare(params.password, user.passwordHash)
    if (!ok) {
      throw new Error('邮箱或密码错误')
    }

    user.lastLoginAt = new Date()
    await user.save()
    return this.buildAuthResult(user)
  }

  async getMe(userId: string): Promise<AuthUser | null> {
    const user = await UserModel.findById(userId).lean().exec()
    if (!user) {
      return null
    }
    return this.toAuthUser(user)
  }

  async getProfile(userId: string): Promise<UserProfilePublic | null> {
    const user = await UserModel.findById(userId).lean().exec()
    if (!user) {
      return null
    }
    return this.toPublicProfile(user)
  }

  async updateProfile(userId: string, params: UpdateUserProfileParams): Promise<UserProfilePublic> {
    const user = await UserModel.findById(userId).exec()
    if (!user) {
      throw new Error('用户不存在')
    }

    if (params.displayName !== undefined) {
      const nextDisplayName = params.displayName.trim()
      if (!nextDisplayName) {
        throw new Error('昵称不能为空')
      }
      user.displayName = nextDisplayName.slice(0, 60)
    }

    if (params.learningDirection !== undefined) {
      user.learningDirection = params.learningDirection.trim().slice(0, 120) || undefined
    }
    if (params.learningGoal !== undefined) {
      user.learningGoal = params.learningGoal.trim().slice(0, 240) || undefined
    }

    if (params.preferredProviderConfigId !== undefined) {
      if (params.preferredProviderConfigId === null || params.preferredProviderConfigId === '') {
        user.preferredProviderConfigId = undefined
      } else {
        const exists = await AIProviderConfigModel.exists({ _id: params.preferredProviderConfigId })
        if (!exists) {
          throw new Error('个人模型配置无效，指定的模型不存在')
        }
        user.preferredProviderConfigId = new Types.ObjectId(params.preferredProviderConfigId)
      }
    }

    if (params.interviewProfile) {
      const current = user.interviewProfile || {}
      if (params.interviewProfile.targetRole !== undefined) {
        current.targetRole = params.interviewProfile.targetRole.trim().slice(0, 120) || undefined
      }
      if (params.interviewProfile.focusDirection !== undefined) {
        current.focusDirection = params.interviewProfile.focusDirection.trim().slice(0, 240) || undefined
      }
      if (params.interviewProfile.selfIntroduction !== undefined) {
        current.selfIntroduction = params.interviewProfile.selfIntroduction.trim().slice(0, 1200) || undefined
      }
      user.interviewProfile = current
    }

    await user.save()
    return this.toPublicProfile(user)
  }

  async appendPersonalInfoMessage(
    userId: string,
    params: { content: string; role?: 'user' | 'assistant' | 'system' }
  ): Promise<UserProfilePublic> {
    const user = await UserModel.findById(userId).exec()
    if (!user) {
      throw new Error('用户不存在')
    }

    const content = params.content.trim().slice(0, 500)
    if (!content) {
      throw new Error('会话内容不能为空')
    }

    const role = params.role || 'user'
    user.personalInfoSession = [...(user.personalInfoSession || []), {
      role,
      content,
      createdAt: new Date()
    }]

    if (user.personalInfoSession.length > PROFILE_SESSION_MAX_ITEMS) {
      user.personalInfoSession = user.personalInfoSession.slice(-PROFILE_SESSION_MAX_ITEMS)
    }

    await user.save()
    return this.toPublicProfile(user)
  }

  async requestPasswordReset(emailRaw: string): Promise<void> {
    const email = this.normalizeEmail(emailRaw)
    const user = await UserModel.findOne({ email }).exec()
    if (!user) {
      return
    }

    const token = this.randomToken()
    user.passwordResetTokenHash = this.sha256(token)
    user.passwordResetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    await user.save()

    const appUrl = process.env.APP_BASE_URL || 'http://localhost:5173'
    const resetUrl = `${appUrl}/auth/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
    try {
      await this.emailService.send({
        to: email,
        subject: '重置密码',
        text: `请点击以下链接重置密码（30 分钟内有效）：\n${resetUrl}`
      })
    } catch (error) {
      // Keep forgot-password response stable to avoid leaking account state and SMTP internals.
      console.warn('[AuthService] Password reset email send failed', {
        email,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async resetPassword(params: { email: string; token: string; newPassword: string }): Promise<void> {
    const email = this.normalizeEmail(params.email)
    const user = await UserModel.findOne({ email }).exec()
    if (!user || !user.passwordResetTokenHash || !user.passwordResetTokenExpiresAt) {
      throw new Error('重置链接无效或已过期')
    }

    if (user.passwordResetTokenExpiresAt.getTime() < Date.now()) {
      throw new Error('重置链接无效或已过期')
    }

    const tokenHash = this.sha256(params.token)
    if (tokenHash !== user.passwordResetTokenHash) {
      throw new Error('重置链接无效或已过期')
    }

    user.passwordHash = await bcrypt.hash(params.newPassword, 12)
    user.passwordResetTokenHash = undefined
    user.passwordResetTokenExpiresAt = undefined
    await user.save()
  }

  async requestUnlockEmail(emailRaw: string): Promise<void> {
    const email = this.normalizeEmail(emailRaw)
    const user = await UserModel.findOne({ email }).exec()
    if (!user) {
      return
    }

    if (!user.unlockRequired && !this.isUserBlocked(user)) {
      return
    }

    await this.lockUserForTodayAndSendUnlockEmail(user)
  }

  async verifyUnlock(params: { email: string; token: string }): Promise<void> {
    const email = this.normalizeEmail(params.email)
    const user = await UserModel.findOne({ email }).exec()
    if (!user || !user.unlockTokenHash || !user.unlockTokenExpiresAt) {
      throw new Error('验证链接无效或已过期')
    }

    if (user.unlockTokenExpiresAt.getTime() < Date.now()) {
      throw new Error('验证链接无效或已过期')
    }

    const tokenHash = this.sha256(params.token)
    if (tokenHash !== user.unlockTokenHash) {
      throw new Error('验证链接无效或已过期')
    }

    user.unlockRequired = false
    user.loginBlockedUntil = undefined
    user.unlockTokenHash = undefined
    user.unlockTokenExpiresAt = undefined
    user.emailVerified = true
    await user.save()
  }

  verifyToken(token: string): { userId: string } {
    const jwtSecret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me'
    const payload = jwt.verify(token, jwtSecret) as { userId?: string }
    if (!payload?.userId) {
      throw new Error('无效的令牌')
    }
    return { userId: payload.userId }
  }

  private buildAuthResult(user: UserDocument & { _id: unknown }): AuthResult {
    const jwtSecret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me'
    const token = jwt.sign(
      { userId: this.idToString(user._id) },
      jwtSecret,
      { expiresIn: '7d' }
    )
    return {
      token,
      user: this.toAuthUser(user)
    }
  }

  private verifyChallenge(params: {
    challengeId: string
    purpose: ChallengePurpose
    email: string
    password: string
    challengeProof: string
  }): void {
    this.cleanExpiredChallenges()
    const challenge = AuthService.challengeStore.get(params.challengeId)
    AuthService.challengeStore.delete(params.challengeId)

    if (!challenge || challenge.purpose !== params.purpose) {
      throw new Error('挑战验证失败，请刷新后重试')
    }

    const expected = this.sha256(
      `${params.purpose}|${params.email}|${params.password}|${challenge.challengeText}`
    )
    if (expected !== params.challengeProof) {
      throw new Error('挑战验证失败，请刷新后重试')
    }
  }

  private cleanExpiredChallenges(): void {
    const now = Date.now()
    for (const [key, value] of AuthService.challengeStore.entries()) {
      if (value.expiresAt <= now) {
        AuthService.challengeStore.delete(key)
      }
    }
  }

  private recordLoginAttemptAndCheckLimit(ip: string): boolean {
    const now = Date.now()
    const validStart = now - LOGIN_WINDOW_MS
    const list = (AuthService.ipLoginAttempts.get(ip) || []).filter(ts => ts >= validStart)
    list.push(now)
    AuthService.ipLoginAttempts.set(ip, list)
    return list.length > MAX_LOGIN_PER_IP_PER_MINUTE
  }

  private async lockUserForTodayAndSendUnlockEmail(
    user: UserDocument & { _id: unknown; save: () => Promise<unknown> }
  ): Promise<void> {
    const now = new Date()
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const unlockToken = this.randomToken()
    user.loginBlockedUntil = endOfDay
    user.unlockRequired = true
    user.unlockTokenHash = this.sha256(unlockToken)
    user.unlockTokenExpiresAt = new Date(Date.now() + UNLOCK_TOKEN_TTL_MS)
    await user.save()

    const appUrl = process.env.APP_BASE_URL || 'http://localhost:5173'
    const unlockUrl = `${appUrl}/auth/unlock?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(unlockToken)}`
    await this.emailService.send({
      to: user.email,
      subject: '账号登录保护验证',
      text: `检测到异常登录频率。请点击以下链接完成验证并解除锁定：\n${unlockUrl}`
    })
  }

  private isUserBlocked(user: UserDocument): boolean {
    if (!user.loginBlockedUntil) {
      return false
    }
    return user.loginBlockedUntil.getTime() > Date.now()
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
  }

  private sha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex')
  }

  private randomToken(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  private idToString(id: unknown): string {
    if (!id) {
      return ''
    }
    if (typeof id === 'string') {
      return id
    }
    if (id instanceof Types.ObjectId) {
      return id.toHexString()
    }
    if (typeof id === 'object') {
      const candidate = id as {
        _id?: unknown
        toHexString?: () => string
        toString?: () => string
      }

      if (typeof candidate.toHexString === 'function') {
        return candidate.toHexString()
      }

      if (typeof candidate.toString === 'function') {
        const rendered = candidate.toString()
        if (rendered && rendered !== '[object Object]') {
          return rendered
        }
      }

      if ('_id' in candidate && candidate._id && candidate._id !== id) {
        return this.idToString(candidate._id)
      }
    }
    return String(id)
  }

  private toAuthUser(user: UserDocument & { _id: unknown }): AuthUser {
    return {
      id: this.idToString(user._id),
      email: user.email,
      displayName: user.displayName,
      preferredProviderConfigId: this.toOptionalIdString(user.preferredProviderConfigId)
    }
  }

  private toPublicProfile(user: UserDocument & { _id: unknown }): UserProfilePublic {
    return {
      ...this.toAuthUser(user),
      learningDirection: user.learningDirection || undefined,
      learningGoal: user.learningGoal || undefined,
      personalInfoSession: (user.personalInfoSession || []).map(item => ({
        role: item.role,
        content: item.content,
        createdAt: new Date(item.createdAt).toISOString()
      })),
      interviewProfile: {
        targetRole: user.interviewProfile?.targetRole || undefined,
        focusDirection: user.interviewProfile?.focusDirection || undefined,
        selfIntroduction: user.interviewProfile?.selfIntroduction || undefined
      }
    }
  }

  private toOptionalIdString(id: unknown): string | undefined {
    if (!id) {
      return undefined
    }
    return this.idToString(id)
  }

  private async sendRegisterSuccessEmail(user: UserDocument & { _id: unknown }): Promise<void> {
    const blessing = await this.pickRandomPublicBlessing()
    const text = [
      `你好，${user.displayName}！`,
      '',
      '你已成功注册 AI 能力工坊账号，欢迎开始学习。',
      `--- ${blessing}`,
      '',
      '祝你学习进步，面试顺利。'
    ].join('\n')

    await this.emailService.send({
      to: user.email,
      subject: '【LearnPilot AI】注册成功，立即开启智能学习',
      text
    })
  }

  private async pickRandomPublicBlessing(): Promise<string> {
    const files = [
      path.resolve(process.cwd(), 'public', '一言.json'),
      path.resolve(process.cwd(), 'backend', 'public', '一言.json'),
      path.resolve(__dirname, '../../public/一言.json')
    ]

    for (const filePath of files) {
      const list = await this.readBlessings(filePath)
      if (list.length > 0) {
        const index = Math.floor(Math.random() * list.length)
        return list[index]
      }
    }
    return '每一天都比昨天更接近目标。'
  }

  private async readBlessings(filePath: string): Promise<string[]> {
    try {
      const data = await fs.readFile(filePath)
      const candidates = this.decodeTextCandidates(data)
      for (const text of candidates) {
        const parsed = this.tryParseJsonArray(text)
        if (parsed.length > 0) {
          return parsed
        }
      }
      return []
    } catch {
      return []
    }
  }

  private decodeTextCandidates(buffer: Buffer): string[] {
    const result: string[] = [buffer.toString('utf8')]

    try {
      result.push(new TextDecoder('gb18030').decode(buffer))
    } catch {
      // ignore unsupported decoder
    }

    return result
  }

  private tryParseJsonArray(text: string): string[] {
    try {
      const value = JSON.parse(text) as unknown
      if (!Array.isArray(value)) {
        return []
      }
      return value
        .map(item => {
          if (typeof item === 'string') {
            return item
          }
          if (item && typeof item === 'object' && 'text' in item) {
            const content = (item as { text?: unknown }).text
            return typeof content === 'string' ? content : ''
          }
          return ''
        })
        .map(item => item.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }
}
