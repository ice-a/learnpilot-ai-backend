import crypto from 'crypto'

export class SecretCryptoService {
  private readonly masterKey: Buffer
  private readonly algorithm = 'aes-256-gcm'
  private readonly keyLength = 32 // 256 bits
  private readonly ivLength = 12 // 96 bits for GCM
  private readonly authTagLength = 16 // 128 bits

  constructor() {
    const masterKeyHex = process.env.MASTER_KEY
    if (!masterKeyHex) {
      throw new Error('MASTER_KEY environment variable is required')
    }

    // 验证密钥长度
    if (masterKeyHex.length !== 64) { // 32 bytes = 64 hex characters
      throw new Error('MASTER_KEY must be a 32-byte (64 character) hex string')
    }

    this.masterKey = Buffer.from(masterKeyHex, 'hex')
  }

  encrypt(plainText: string): string {
    try {
      // 生成随机IV
      const iv = crypto.randomBytes(this.ivLength)

      // 创建加密器
      const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv)

      // 加密数据
      let encrypted = cipher.update(plainText, 'utf8', 'base64')
      encrypted += cipher.final('base64')

      // 获取认证标签
      const authTag = cipher.getAuthTag()

      // 返回格式: base64(iv):base64(encrypted):base64(authTag)
      return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  decrypt(cipherText: string): string {
    try {
      const [ivBase64, encrypted, authTagBase64] = cipherText.split(':')

      if (!ivBase64 || !encrypted || !authTagBase64) {
        throw new Error('Invalid cipher text format')
      }

      // 解码各部分
      const iv = Buffer.from(ivBase64, 'base64')
      const authTag = Buffer.from(authTagBase64, 'base64')

      // 创建解密器
      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv)
      decipher.setAuthTag(authTag)

      // 解密数据
      let decrypted = decipher.update(encrypted, 'base64', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // 验证加密密钥是否有效
  validateMasterKey(): boolean {
    try {
      const testString = 'test-encryption-key-validation'
      const encrypted = this.encrypt(testString)
      const decrypted = this.decrypt(encrypted)
      return decrypted === testString
    } catch {
      return false
    }
  }
}