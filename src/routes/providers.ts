import { Router, Request, Response } from 'express'
import { body, param, validationResult } from 'express-validator'
import { AIProviderConfigModel } from '../models/AIProviderConfig'
import { SecretCryptoService } from '../services/SecretCryptoService'
import { ApiResponse } from '../types'
import { getRequestId } from '../utils/http'

interface CreateProviderBody {
  name: string
  baseUrl: string
  modelId: string
  apiKey: string
  timeoutMs?: number
  ttsEnabled?: boolean
  ttsModelId?: string
  ttsVoice?: string
  ttsFormat?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'flac'
  ttsSpeed?: number
}

interface UpdateProviderBody {
  name?: string
  baseUrl?: string
  modelId?: string
  apiKey?: string
  timeoutMs?: number
  ttsEnabled?: boolean
  ttsModelId?: string
  ttsVoice?: string
  ttsFormat?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'flac'
  ttsSpeed?: number
}

interface DiscoverModelsBody {
  baseUrl: string
  apiKey?: string
  providerId?: string
  timeoutMs?: number
}

interface OpenAIModelsResponse {
  data?: Array<{
    id?: string
    object?: string
  }>
}

export const providerRoutes = Router()
const crypto = new SecretCryptoService()

const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '')
}

const fetchOpenAIModelIds = async (baseUrl: string, apiKey: string, timeoutMs: number): Promise<string[]> => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const fallbackUrl = `${normalizedBaseUrl}/v1/models`
  const urls = [ `${normalizedBaseUrl}/models` ]
  if (fallbackUrl !== urls[0]) {
    urls.push(fallbackUrl)
  }

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      })

      clearTimeout(timer)

      if (!response.ok) {
        if (response.status === 404 && index < urls.length - 1) {
          continue
        }
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText || '获取模型列表失败'}`)
      }

      const payload = await response.json() as OpenAIModelsResponse
      const modelIds = (payload.data || [])
        .filter(item => item.object === 'model' && typeof item.id === 'string' && item.id.trim().length > 0)
        .map(item => item.id!.trim())

      return [...new Set(modelIds)].sort((a, b) => a.localeCompare(b))
    } catch (error) {
      clearTimeout(timer)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`请求超时（>${timeoutMs}ms）`)
      }

      if (index >= urls.length - 1) {
        throw error
      }
    }
  }

  return []
}

providerRoutes.post(
  '/',
  [
    body('name').isString().trim().notEmpty().withMessage('名称不能为空'),
    body('baseUrl').isURL().withMessage('请输入有效的 URL'),
    body('modelId').isString().trim().notEmpty().withMessage('模型 ID 不能为空'),
    body('apiKey').isString().trim().notEmpty().withMessage('API 密钥不能为空'),
    body('timeoutMs').optional().isInt({ min: 1000, max: 300000 }).withMessage('超时时间必须在 1000-300000ms 之间'),
    body('ttsEnabled').optional().isBoolean().withMessage('ttsEnabled 必须是布尔值'),
    body('ttsModelId').optional().isString().trim().notEmpty().withMessage('TTS 模型 ID 不能为空'),
    body('ttsVoice').optional().isString().trim().notEmpty().withMessage('TTS 音色不能为空'),
    body('ttsFormat').optional().isIn(['mp3', 'wav', 'pcm', 'opus', 'flac']).withMessage('TTS 格式不合法'),
    body('ttsSpeed').optional().isFloat({ min: 0.25, max: 4 }).withMessage('TTS 语速必须在 0.25-4 之间')
  ],
  async (
    req: Request<Record<string, never>, ApiResponse, CreateProviderBody>,
    res: Response<ApiResponse>
  ): Promise<void> => {
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
      const {
        name,
        baseUrl,
        modelId,
        apiKey,
        timeoutMs = 30000,
        ttsEnabled = false,
        ttsModelId,
        ttsVoice,
        ttsFormat = 'mp3',
        ttsSpeed = 1
      } = req.body
      if (ttsEnabled && (!ttsModelId || !ttsVoice)) {
        res.status(400).json({
          success: false,
          error: '启用 TTS 时必须提供 TTS 模型 ID 和音色',
          requestId
        })
        return
      }
      const existing = await AIProviderConfigModel.findOne({ name }).lean().exec()

      if (existing) {
        res.status(409).json({
          success: false,
          error: '提供商名称已存在',
          requestId
        })
        return
      }

      const encryptedApiKey = crypto.encrypt(apiKey)
      const provider = new AIProviderConfigModel({
        name,
        baseUrl,
        modelId,
        apiKeyEncrypted: encryptedApiKey,
        isActive: false,
        timeoutMs,
        ttsEnabled,
        ttsModelId: ttsEnabled ? ttsModelId : undefined,
        ttsVoice: ttsEnabled ? ttsVoice : undefined,
        ttsFormat: ttsEnabled ? ttsFormat : 'mp3',
        ttsSpeed: ttsEnabled ? ttsSpeed : 1
      })

      await provider.save()

      res.status(201).json({
        success: true,
        data: {
          _id: provider._id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          modelId: provider.modelId,
          isActive: provider.isActive,
          timeoutMs: provider.timeoutMs,
          ttsEnabled: provider.ttsEnabled,
          ttsModelId: provider.ttsModelId,
          ttsVoice: provider.ttsVoice,
          ttsFormat: provider.ttsFormat,
          ttsSpeed: provider.ttsSpeed,
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt
        },
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '创建提供商配置失败',
        requestId
      })
    }
  }
)

providerRoutes.get('/', async (req: Request, res: Response<ApiResponse>): Promise<void> => {
  const requestId = getRequestId(req)

  try {
    const providers = await AIProviderConfigModel.find().select('-apiKeyEncrypted').sort({ createdAt: -1 }).lean().exec()

    res.json({
      success: true,
      data: providers,
      requestId
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '获取提供商配置失败',
      requestId
    })
  }
})

providerRoutes.post(
  '/models/discover',
  [
    body('baseUrl').isURL().withMessage('请输入有效的 Base URL'),
    body('apiKey').optional().isString().trim().notEmpty().withMessage('API 密钥不能为空'),
    body('providerId').optional().isMongoId().withMessage('无效的提供商 ID'),
    body('timeoutMs').optional().isInt({ min: 1000, max: 300000 }).withMessage('超时时间必须在 1000-300000ms 之间'),
    body().custom((payload: DiscoverModelsBody) => {
      if (!payload.apiKey && !payload.providerId) {
        throw new Error('请提供 API 密钥或 providerId')
      }
      return true
    })
  ],
  async (req: Request<Record<string, never>, ApiResponse, DiscoverModelsBody>, res: Response<ApiResponse>): Promise<void> => {
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
      const { baseUrl, apiKey, providerId, timeoutMs = 30000 } = req.body
      let resolvedApiKey = apiKey?.trim() || ''

      if (!resolvedApiKey && providerId) {
        const provider = await AIProviderConfigModel.findById(providerId).lean().exec()
        if (!provider) {
          res.status(404).json({
            success: false,
            error: '提供商配置不存在',
            requestId
          })
          return
        }

        resolvedApiKey = crypto.decrypt(provider.apiKeyEncrypted)
      }

      if (!resolvedApiKey) {
        res.status(400).json({
          success: false,
          error: '缺少可用 API 密钥',
          requestId
        })
        return
      }

      const modelIds = await fetchOpenAIModelIds(baseUrl, resolvedApiKey, timeoutMs)
      res.json({
        success: true,
        data: modelIds,
        message: modelIds.length > 0 ? `成功获取 ${modelIds.length} 个模型` : '未获取到模型列表',
        requestId
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取模型列表失败',
        requestId
      })
    }
  }
)

providerRoutes.put(
  '/:id',
  [
    param('id').isMongoId().withMessage('无效的提供商 ID'),
    body('name').optional().isString().trim().notEmpty().withMessage('名称不能为空'),
    body('baseUrl').optional().isURL().withMessage('请输入有效的 URL'),
    body('modelId').optional().isString().trim().notEmpty().withMessage('模型 ID 不能为空'),
    body('apiKey').optional().isString().trim().notEmpty().withMessage('API 密钥不能为空'),
    body('timeoutMs').optional().isInt({ min: 1000, max: 300000 }).withMessage('超时时间必须在 1000-300000ms 之间'),
    body('ttsEnabled').optional().isBoolean().withMessage('ttsEnabled 必须是布尔值'),
    body('ttsModelId').optional().isString().trim().notEmpty().withMessage('TTS 模型 ID 不能为空'),
    body('ttsVoice').optional().isString().trim().notEmpty().withMessage('TTS 音色不能为空'),
    body('ttsFormat').optional().isIn(['mp3', 'wav', 'pcm', 'opus', 'flac']).withMessage('TTS 格式不合法'),
    body('ttsSpeed').optional().isFloat({ min: 0.25, max: 4 }).withMessage('TTS 语速必须在 0.25-4 之间')
  ],
  async (req: Request<{ id: string }, ApiResponse, UpdateProviderBody>, res: Response<ApiResponse>): Promise<void> => {
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
      const { id } = req.params
      const allowedFields: Array<keyof UpdateProviderBody> = [
        'name',
        'baseUrl',
        'modelId',
        'timeoutMs',
        'ttsEnabled',
        'ttsModelId',
        'ttsVoice',
        'ttsFormat',
        'ttsSpeed'
      ]
      const updateData: Record<string, unknown> = {}

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field]
        }
      }

      if (req.body.apiKey) {
        updateData.apiKeyEncrypted = crypto.encrypt(req.body.apiKey)
      }
      if (req.body.ttsEnabled === false) {
        updateData.ttsFormat = 'mp3'
        updateData.ttsSpeed = 1
      }
      if (req.body.ttsEnabled === true) {
        const existingProvider = await AIProviderConfigModel.findById(id).lean().exec()
        if (!existingProvider) {
          res.status(404).json({
            success: false,
            error: '提供商配置不存在',
            requestId
          })
          return
        }

        const nextTtsModelId = req.body.ttsModelId ?? existingProvider.ttsModelId
        const nextTtsVoice = req.body.ttsVoice ?? existingProvider.ttsVoice
        if (!nextTtsModelId || !nextTtsVoice) {
          res.status(400).json({
            success: false,
            error: '启用 TTS 时必须提供 TTS 模型 ID 和音色',
            requestId
          })
          return
        }
      }

      const updateQuery: Record<string, unknown> = { ...updateData }
      if (req.body.ttsEnabled === false) {
        updateQuery.$unset = {
          ttsModelId: 1,
          ttsVoice: 1
        }
      }

      const provider = await AIProviderConfigModel.findByIdAndUpdate(id, updateQuery, {
        new: true,
        runValidators: true
      })
        .select('-apiKeyEncrypted')
        .lean()
        .exec()

      if (!provider) {
        res.status(404).json({
          success: false,
          error: '提供商配置不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        data: provider,
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '更新提供商配置失败',
        requestId
      })
    }
  }
)

providerRoutes.post(
  '/:id/activate',
  [param('id').isMongoId().withMessage('无效的提供商 ID')],
  async (req: Request<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
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
      const { id } = req.params
      const target = await AIProviderConfigModel.findById(id).lean().exec()
      if (!target) {
        res.status(404).json({
          success: false,
          error: '提供商配置不存在',
          requestId
        })
        return
      }

      await AIProviderConfigModel.updateMany({}, { isActive: false }).exec()

      const provider = await AIProviderConfigModel.findByIdAndUpdate(
        id,
        { isActive: true },
        { new: true }
      )
        .select('-apiKeyEncrypted')
        .lean()
        .exec()

      res.json({
        success: true,
        data: provider,
        message: '提供商激活成功',
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '激活提供商失败',
        requestId
      })
    }
  }
)

providerRoutes.delete(
  '/:id',
  [param('id').isMongoId().withMessage('无效的提供商 ID')],
  async (req: Request<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
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
      const { id } = req.params
      const provider = await AIProviderConfigModel.findByIdAndDelete(id).exec()

      if (!provider) {
        res.status(404).json({
          success: false,
          error: '提供商配置不存在',
          requestId
        })
        return
      }

      res.json({
        success: true,
        message: '提供商配置已删除',
        requestId
      })
    } catch {
      res.status(500).json({
        success: false,
        error: '删除提供商配置失败',
        requestId
      })
    }
  }
)
