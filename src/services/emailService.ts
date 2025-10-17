import { z } from 'zod';
import nodemailer from 'nodemailer';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

const emailInputSchema = z.object({
  to: z.string().email({ message: 'Invalid recipient email' }),
  subject: z.string().min(1, 'Missing subject'),
  text: z.string().optional(),
  html: z.string().optional(),
});

export class EmailService {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor(private readonly config: EmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    this.from = config.auth.user;
  }

  async send(input: z.infer<typeof emailInputSchema>): Promise<{ messageId: string }>
  {
    const parsed = emailInputSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid email input';
      if (/recipient/i.test(msg)) throw new Error('Invalid recipient');
      throw new Error(msg);
    }
    const { to, subject, text, html } = parsed.data;
    if (!text && !html) {
      throw new Error('Missing content: provide text or html');
    }
    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });

    // Debug delivery details for troubleshooting
    try {
      const accepted = (info as any).accepted || [];
      const rejected = (info as any).rejected || [];
      const response = (info as any).response;
      const envelope = (info as any).envelope;
      log.info({ smtp: { accepted, rejected, response, envelope } }, 'SMTP send result');
    } catch {}

    return { messageId: (info as any).messageId ?? 'unknown' };
  }
}