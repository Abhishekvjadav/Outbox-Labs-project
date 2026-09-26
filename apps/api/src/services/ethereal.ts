import nodemailer, { Transporter } from 'nodemailer';

export interface SendMailOptions {
  fromName: string;
  fromEmail: string;
  etherealUser: string;
  etherealPass: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface SendMailResult {
  messageId: string;
  previewUrl: string | false;
}

export class EtherealService {
  private transporterCache = new Map<string, Transporter>();

  /**
   * Creates a brand new Ethereal test mailbox on demand
   */
  public async createTestSender(): Promise<{
    email: string;
    user: string;
    pass: string;
  }> {
    const testAccount = await nodemailer.createTestAccount();
    return {
      email: testAccount.user,
      user: testAccount.user,
      pass: testAccount.pass,
    };
  }

  /**
   * Gets or creates a reusable transporter for a specific sender account
   */
  private getTransporter(etherealUser: string, etherealPass: string): Transporter {
    const cacheKey = `${etherealUser}:${etherealPass}`;
    if (this.transporterCache.has(cacheKey)) {
      return this.transporterCache.get(cacheKey)!;
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: etherealUser,
        pass: etherealPass,
      },
    });

    this.transporterCache.set(cacheKey, transporter);
    return transporter;
  }

  /**
   * Dispatches email through Ethereal SMTP and returns messageId + test preview link
   */
  public async sendEmail(options: SendMailOptions): Promise<SendMailResult> {
    const transporter = this.getTransporter(options.etherealUser, options.etherealPass);

    const info = await transporter.sendMail({
      from: `"${options.fromName}" <${options.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text || options.subject,
      html: options.html || `<p>${options.text || options.subject}</p>`,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return {
      messageId: info.messageId,
      previewUrl: previewUrl || false,
    };
  }
}

export const etherealService = new EtherealService();
