import { ChatMessage, ChatOptions } from '../types'
import { AIProviderConfigModel } from '../models/AIProviderConfig'
import { SecretCryptoService } from './SecretCryptoService'

interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (params: {
        model: string
        messages: ChatMessage[]
        response_format?: { type: string }
        temperature?: number
        max_tokens?: number
      }) => Promise<{
        choices: Array<{ message: { content: string | Array<{ type?: string; text?: string }> } }>
        usage?: {
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
        }
      }>
    }
  }
}

export class AIGateway {
  private crypto: SecretCryptoService

  constructor() {
    this.crypto = new SecretCryptoService()
  }

  async chat(
    providerConfigId: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{
    text: string
    usage?: {
      prompt: number
      completion: number
      total: number
    }
  }> {
    try {
      const provider = await AIProviderConfigModel.findById(providerConfigId)
      if (!provider) {
        throw new Error(`AI provider configuration not found: ${providerConfigId}`)
      }
      if (!provider.isActive) {
        throw new Error(`AI provider is not active: ${provider.name}`)
      }

      let apiKey: string
      try {
        apiKey = this.crypto.decrypt(provider.apiKeyEncrypted)
      } catch {
        throw new Error(`Failed to decrypt API key for provider: ${provider.name}`)
      }

      const timeoutMs = Math.max(provider.timeoutMs || 30000, 45000)
      const requestPayload = {
        model: provider.modelId,
        messages,
        response_format: options?.responseFormat === 'json' ? { type: 'json_object' } : undefined,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000
      }

      let response: Awaited<ReturnType<OpenAICompatibleClient['chat']['completions']['create']>>
      try {
        const client = this.createHttpClient(provider.baseUrl, apiKey, timeoutMs)
        response = await client.chat.completions.create(requestPayload)
      } catch (error) {
        if (!this.isTimeoutError(error)) {
          throw error
        }

        const retryTimeoutMs = Math.min(Math.max(timeoutMs * 2, 60000), 180000)
        const retryClient = this.createHttpClient(provider.baseUrl, apiKey, retryTimeoutMs)
        response = await retryClient.chat.completions.create(requestPayload)
      }

      if (!response.choices || response.choices.length === 0) {
        throw new Error('No response from AI provider')
      }

      const content = response.choices[0].message.content
      const text = typeof content === 'string'
        ? content
        : content
          .filter(item => item.type === 'text' && typeof item.text === 'string')
          .map(item => item.text)
          .join('\n')

      return {
        text,
        usage: response.usage
          ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens
          }
          : undefined
      }
    } catch (error) {
      console.error('AI Gateway error:', error)
      throw new Error(`AI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private createHttpClient(baseUrl: string, apiKey: string, timeout: number): OpenAICompatibleClient {
    return {
      chat: {
        completions: {
          async create(params) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            try {
              const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
              const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify(params),
                signal: controller.signal
              })

              clearTimeout(timeoutId)

              if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${errorText}`)
              }

              const payload = await response.json() as Awaited<ReturnType<OpenAICompatibleClient['chat']['completions']['create']>>
              return payload
            } catch (error) {
              clearTimeout(timeoutId)
              if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`)
              }
              throw error
            }
          }
        }
      }
    }
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('timeout')
  }
}
