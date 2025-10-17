import pino from 'pino';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getEnv } from './config/env';
import { createAgentOptions } from './agent/options';
import { EmailService } from './services/emailService';
import { smtpInputSchema } from './mcp/smtpTool';
import { IncomingMessage, ServerResponse, createServer } from 'http';
import { z } from 'zod';
import { SearchService } from './services/searchService';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

async function start() {
  const env = getEnv();

  // Init EmailService (reused by REST API)
  const emailService = new EmailService({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  const searchService = new SearchService({
    provider: (process.env.SEARCH_PROVIDER as any) || undefined,
    bingApiKey: process.env.BING_SEARCH_API_KEY,
  });

  const options = createAgentOptions({
    cwd: process.cwd(),
    model: env.CLAUDE_MODEL,
    sessionId: env.AGENT_SESSION_ID,
  });

  // (moved) REST API starts before Agent

  // Start lightweight REST API
  const port = Number(process.env.PORT || 3000);

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(data));
    res.end(data);
  };

  const readJson = (req: IncomingMessage): Promise<any> => {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method || 'GET';

    // Health endpoint
    if (method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }

    // General SMTP send endpoint
    if (method === 'POST' && url.pathname === '/api/smtp/send') {
      try {
        const body = await readJson(req);
        const parsed = smtpInputSchema.safeParse(body);
        if (!parsed.success) {
          return sendJson(res, 400, { ok: false, error: parsed.error.format() });
        }
        const result = await emailService.send(parsed.data);
        return sendJson(res, 200, { ok: true, messageId: result.messageId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendJson(res, 500, { ok: false, error: msg });
      }
    }

    // Joke sending convenience endpoint
    if (method === 'POST' && url.pathname === '/api/joke') {
      try {
        const body = await readJson(req);
        const to = String(body?.to || '');
        if (!to) return sendJson(res, 400, { ok: false, error: 'missing to' });
        const subject = '程序员笑话测试';
        const text = '程序员冷笑话：为什么开发者总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。';
        const result = await emailService.send({ to, subject, text });
        return sendJson(res, 200, { ok: true, messageId: result.messageId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendJson(res, 500, { ok: false, error: msg });
      }
    }

    // Agent-assisted email composing and sending endpoint
    if (method === 'POST' && url.pathname === '/api/agent/send') {
      try {
        const body = await readJson(req);
        const schema = z.object({
          to: z.string().email(),
          recipient: z.string().min(1),
          intent: z.string().min(1),
          language: z.enum(['zh-CN', 'en']).optional().default('zh-CN'),
          site: z.string().optional(),
        });
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return sendJson(res, 400, { ok: false, error: parsed.error.format() });
        }
        const { to, recipient, intent, language, site } = parsed.data;

        // Use local search service to gather context and compose content
        const results = await searchService.search(`${recipient} ${intent}`, 5, site);
        const bullets = results.slice(0, 5).map((r) => `• ${r.title} (${r.url})`).join('\n');
        const greeting = language === 'zh-CN' ? '您好' : 'Hello';
        const humor = language === 'zh-CN'
          ? '技术小幽默：为什么开发者分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。'
          : 'Tech humor: Why do developers confuse Halloween and Christmas? Because Oct 31 == Dec 25.';
        const finalText = [
          `${greeting}，根据公开资料为您整理了相关信息：`,
          bullets || '(暂未检索到更多公开资料)',
          '',
          `${humor}`,
        ].join('\n');

        if (!finalText) {
          return sendJson(res, 500, { ok: false, error: 'Agent returned no content' });
        }
        // Try parse JSON from agent final message
        let subject = '邮件';
        let html: string | undefined;
        let text: string | undefined;
        try {
          const trimmed = finalText.trim();
          const firstBrace = trimmed.indexOf('{');
          const lastBrace = trimmed.lastIndexOf('}');
          const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
          const parsedJson = JSON.parse(jsonStr);
          subject = String(parsedJson.subject || subject);
          html = parsedJson.html ? String(parsedJson.html) : undefined;
          text = parsedJson.text ? String(parsedJson.text) : undefined;
        } catch (err) {
          // Fallback: treat entire text as plain body
          text = finalText;
        }

        if (!html && !text) {
          text = '（内容生成失败，请稍后重试）';
        }

        const sendRes = await emailService.send({ to, subject, text, html });
        return sendJson(res, 200, { ok: true, messageId: sendRes.messageId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendJson(res, 500, { ok: false, error: msg });
      }
    }

    // Not found
    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(port, () => {
    log.info({ port }, 'REST API server listening');
  });

  // Start a long-running session; non-fatal if startup fails
  try {
    log.info({ env: { model: env.CLAUDE_MODEL } }, 'Starting persistent agent');
    const q = query({
      prompt: 'Initialize persistent session. You can use smtp_send tool to send emails.',
      options,
    });
    for await (const msg of q) {
      if ((msg as any).type === 'message') {
        const content = (msg as any).content ?? [];
        log.info({ content }, 'Agent message');
      }
    }
  } catch (err) {
    const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
    log.error(error, 'Agent failed to start');
  }
}

start().catch((err) => {
  const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
  log.error(error, 'Agent crashed');
  process.exit(1);
});