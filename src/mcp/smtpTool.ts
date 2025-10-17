import { z } from 'zod';
import type { EmailService } from '../services/emailService';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// lightweight in-memory state for last SMTP message id
const lastIdRef: { id?: string } = {};
export function getLastSmtpMessageId(): string | undefined {
  return lastIdRef.id;
}
export function setLastSmtpMessageId(id: string | undefined) {
  lastIdRef.id = id;
}

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
      log.info({ mcp_tool: 'smtp_send', stage: 'start', args }, 'MCP tool start');
      const res = await emailService.send(args);
      setLastSmtpMessageId(res.messageId);
      log.info({ mcp_tool: 'smtp_send', stage: 'success', messageId: res.messageId }, 'MCP tool success');
      return { ok: true, messageId: res.messageId };
    } catch (err) {
      const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
      log.error({ mcp_tool: 'smtp_send', stage: 'error', error }, 'MCP tool error');
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