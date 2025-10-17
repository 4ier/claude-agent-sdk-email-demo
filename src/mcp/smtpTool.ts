import { z } from 'zod';
import type { EmailService } from '../services/emailService';
import { tool } from '@anthropic-ai/claude-agent-sdk';

export const smtpInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
});

export function smtpHandler(emailService: EmailService) {
  return async (
    args: z.infer<typeof smtpInputSchema>,
    _extra: unknown,
  ): Promise<{ ok: boolean; messageId?: string; error?: unknown }> => {
    try {
      const res = await emailService.send(args);
      return { ok: true, messageId: res.messageId };
    } catch (err) {
      return { ok: false, error: err };
    }
  };
}

export function createSmtpTool(emailService: EmailService) {
  return tool(
    'smtp_send',
    'Send an email via SMTP',
    smtpInputSchema.shape,
    smtpHandler(emailService),
  );
}