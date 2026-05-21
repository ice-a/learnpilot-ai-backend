import nodemailer from 'nodemailer'

interface SendMailParams {
  to: string
  subject: string
  text: string
  html?: string
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null
  private fromAddress: string

  constructor() {
    const host = process.env.SMTP_HOST
    const port = Number(process.env.SMTP_PORT || 587)
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    this.fromAddress = process.env.SMTP_FROM || user || 'noreply@example.com'

    if (!host || !user || !pass) {
      return
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    })
  }

  async send(params: SendMailParams): Promise<void> {
    if (!this.transporter) {
      console.warn('[EmailService] SMTP 未配置，邮件内容已降级输出到日志。', {
        to: params.to,
        subject: params.subject,
        text: params.text
      })
      return
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html
    })
  }
}
