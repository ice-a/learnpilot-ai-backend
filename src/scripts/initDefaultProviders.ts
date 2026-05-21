import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { AIProviderConfigModel } from '../models/AIProviderConfig'

// 加载环境变量
if (process.env.NODE_ENV !== 'production') {
  dotenv.config()
}

// 延迟创建加密服务，只有在需要时才实例化
function createCryptoService() {
  try {
    const { SecretCryptoService } = require('../services/SecretCryptoService')
    return new SecretCryptoService()
  } catch (error) {
    console.error('Failed to create crypto service:', error instanceof Error ? error.message : error)
    throw error
  }
}

interface ProviderConfig {
  name: string
  baseUrl: string
  modelId: string
  apiKey: string
  timeoutMs?: number
}

const defaultProviders: ProviderConfig[] = [
  {
    name: 'OpenAI',
    baseUrl: process.env.OPENAI_BASE_URL || process.env.DEFAULT_AI_BASE_URL || 'https://api.openai.com/v1',
    modelId: process.env.OPENAI_MODEL_ID || process.env.DEFAULT_AI_MODEL_ID || 'gpt-3.5-turbo',
    apiKey: process.env.OPENAI_API_KEY || '',
    timeoutMs: parseInt(process.env.DEFAULT_AI_TIMEOUT || '30000')
  }
]

async function initDefaultProviders() {
  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is required')
    }

    console.log('Connecting to MongoDB...')
    await mongoose.connect(mongoUri)
    console.log('MongoDB connected successfully')

    // 检查是否已有提供商配置
    const existingProviders = await AIProviderConfigModel.countDocuments()
    if (existingProviders > 0) {
      console.log('AI providers already exist, skipping initialization')
      return
    }

    console.log('Initializing default AI providers...')

    // 创建加密服务
    let crypto: any
    try {
      crypto = createCryptoService()
    } catch (error) {
      console.error('Failed to initialize crypto service. Cannot proceed with provider initialization.')
      return
    }

    // 创建默认提供商配置
    for (const providerConfig of defaultProviders) {
      // 只有当API密钥不为空时才创建配置
      if (providerConfig.apiKey && providerConfig.apiKey.trim() !== '') {
        try {
          const encryptedApiKey = crypto.encrypt(providerConfig.apiKey)

          const provider = new AIProviderConfigModel({
            name: providerConfig.name,
            baseUrl: providerConfig.baseUrl,
            modelId: providerConfig.modelId,
            apiKeyEncrypted: encryptedApiKey,
            isActive: providerConfig.name === 'OpenAI', // 默认激活OpenAI（如果有配置）
            timeoutMs: providerConfig.timeoutMs
          })

          await provider.save()
          console.log(`✓ Created provider: ${providerConfig.name}`)
        } catch (error) {
          console.error(`✗ Failed to create provider ${providerConfig.name}:`, error instanceof Error ? error.message : error)
        }
      } else {
        console.log(`⚠ Skipped provider ${providerConfig.name} (no API key configured)`)
      }
    }

    console.log('Default AI providers initialization completed')
  } catch (error) {
    console.error('Error during initialization:', error)
    // 仅在独立运行时退出进程，作为模块导入时不退出
    if (require.main === module) {
      process.exit(1)
    }
  }
}

// 如果是直接运行此脚本则执行初始化
if (require.main === module) {
  initDefaultProviders()
}

export { initDefaultProviders }