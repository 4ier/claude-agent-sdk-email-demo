import pino from 'pino';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getEnv } from './config/env';
import { createAgentOptions } from './agent/options';
import { EmailService } from './services/emailService';
import { smtpInputSchema } from './mcp/smtpTool';
import { IncomingMessage, ServerResponse, createServer } from 'http';
import { z } from 'zod';
import { SearchService } from './services/searchService';
import { getLastSmtpMessageId, setLastSmtpMessageId } from './mcp/smtpTool';

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

  // SSE utility functions
  const setupSSE = (res: ServerResponse) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Accept',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'X-Accel-Buffering': 'no' // 禁用nginx缓冲
    });
    
    // 立即发送连接确认和重试指令
    res.write('retry: 10000\n');
    res.write('event: connected\n');
    res.write('data: {"status":"connected"}\n\n');
    // 强制刷新缓冲区
    (res as any).flushHeaders?.();
    res.socket?.write('');
  };

  const sendSSEEvent = (res: ServerResponse, event: string, data: any, id?: string) => {
    if (id) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // 立即刷新，确保数据立即发送到客户端
    (res as any).flushHeaders?.();
    res.socket?.write('');
  };

  const isSSERequest = (req: IncomingMessage): boolean => {
    const accept = req.headers.accept || '';
    return accept.includes('text/event-stream');
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

    // SSE Test page
    if (method === 'GET' && url.pathname === '/test-sse') {
      const fs = require('fs');
      const path = require('path');
      try {
        const htmlPath = path.join(process.cwd(), 'test-sse.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      } catch (err) {
        return sendJson(res, 404, { ok: false, error: 'Test page not found' });
      }
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

        // 添加性能优化的参数验证
        const startTime = Date.now();
        log.info({ 
          request_start: startTime,
          params: { to, recipient, intent, language, site },
          route: '/api/agent/send'
        }, 'Request started with performance tracking');

        // 验证关键参数质量
        if (recipient.length < 2) {
          return sendJson(res, 400, { ok: false, error: 'Recipient must be at least 2 characters' });
        }
        if (intent.length < 5) {
          return sendJson(res, 400, { ok: false, error: 'Intent must be at least 5 characters' });
        }
        
        // 检查是否包含无效字符（如问号占位符）
        if (recipient.includes('?') || intent.includes('?')) {
          return sendJson(res, 400, { 
            ok: false, 
            error: 'Invalid characters detected in recipient or intent parameters' 
          });
        }

        // Check if client wants SSE
        const useSSE = isSSERequest(req);
        
        // Generate session ID for this request
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Delegate fully to the Agent: it decides how to search, write, and send.
        const prompt = [
          'You are an autonomous outreach agent.',
          `Recipient profile: ${recipient}`,
          `Outbound intent: ${intent}`,
          site ? `Preferred site for research (optional): ${site}` : '',
          `Language: ${language} (use this language for subject and body)`,
          '',
          'Instructions:',
          '- Decide if web research is needed. If you research, run at most ONE `web_search` with succinct keywords; limit results to 3–5; skip research if unnecessary.',
          '- Compose a concise, personalized email (subject + text or html).',
          '- You MUST call `smtp_send` to send exactly one email to the provided address. Call it within your first two tool actions; if research yields no useful results, send without research.',
          `- Use "to": ${to} as the recipient address.`,
          '- Do not ask for confirmation; do not loop; do not retry sending.',
          '- After sending, reply with ONLY this JSON object on a single line:',
          '- {"status":"sent","messageId":"<id>"}',
        ].filter(Boolean).join('\n');

        // 详细打印 Claude 输入（提示词与关键上下文）
        const claudeStartTime = Date.now();
        log.info(
          {
            claude_input: {
              route: '/api/agent/send',
              model: (options as any)?.model,
              args: { to, recipient, intent, language, site },
              prompt,
              useSSE,
              sessionId,
            },
            performance: {
              request_start: startTime,
              claude_start: claudeStartTime,
              initialization_time_ms: claudeStartTime - startTime
            }
          },
          'Claude input'
        );

        if (useSSE) {
          // SSE Mode
          setupSSE(res);
          
          // Cleanup function (no heartbeat needed for simple token streaming)
          const cleanup = () => {
            // No cleanup needed for simplified implementation
          };

          // Handle client disconnect
          req.on('close', cleanup);
          req.on('error', cleanup);

          setLastSmtpMessageId(undefined);
          const q = query({ prompt, options });
          let messageId: string | undefined;
          let finalJsonId: string | undefined;
          
          const TIMEOUT_MS = Number(process.env.AGENT_ROUTE_TIMEOUT_MS || 120000); // 增加到120秒
          let timedOut = false;
          let taskCompleted = false;
          const timer = setTimeout(() => { 
            timedOut = true;
            if (!taskCompleted) {
              sendSSEEvent(res, 'error', { 
                error: 'Agent processing timeout - task took longer than expected'
              });
              cleanup();
              res.end();
            }
          }, TIMEOUT_MS);

          try {
            for await (const ev of q) {
              const e: any = ev as any;
              
              // 详细打印 Claude 输出（完整事件）- 仅用于服务器端日志
              try {
                log.info({ claude_output: e }, 'Claude output');
              } catch {}

              // 添加详细的事件分析日志
              try {
                log.info({ 
                  event_analysis: {
                    type: e?.type,
                    message_role: e?.message?.role,
                    has_content: !!(e?.content || e?.message?.content),
                    content_length: (e?.content?.length || e?.message?.content?.length || 0),
                    tool_name: e?.name || e?.toolName || e?.tool || e?.tool_id,
                    has_result: !!(e?.result || e?.toolResult || e?.output)
                  }
                }, 'Processing Claude event');
              } catch {}

              // 处理assistant消息 - 支持多种消息格式
              const isAssistantMessage = (e && e.type === 'message') || 
                                       (e && e.message && e.message.role === 'assistant');
              
              if (isAssistantMessage) {
                // 支持多种内容格式
                const content = e.content || e.message?.content || [];
                const parts = Array.isArray(content) ? content : [content];
                
                // 处理文本内容
                for (const part of parts) {
                  if (part && part.type === 'text' && part.text) {
                    const textContent = String(part.text).trim();
                    if (textContent) {
                      // 将文本按空格分割成tokens进行流式输出
                      const tokens = textContent.split(/(\s+)/);
                      for (const token of tokens) {
                        if (token.trim()) {
                          sendSSEEvent(res, 'token', {
                            content: token
                          });
                        }
                      }
                    }

                    // 尝试解析最终的JSON响应以获取messageId
                    try {
                      const trimmed = textContent.trim();
                      const firstBrace = trimmed.indexOf('{');
                      const lastBrace = trimmed.lastIndexOf('}');
                      const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
                      const obj = JSON.parse(jsonStr);
                      if (obj && (obj.messageId || obj.status === 'sent')) {
                        if (obj.messageId) finalJsonId = String(obj.messageId);
                        taskCompleted = true; // 标记任务完成
                        log.info({ final_response: obj }, 'Task completed with final response');
                      }
                    } catch {
                      // ignore non-JSON assistant messages
                    }
                  }
                }
                
                // 处理直接的文本内容（如果不是数组格式）
                if (typeof content === 'string' && content.trim()) {
                  const textContent = content.trim();
                  const tokens = textContent.split(/(\s+)/);
                  for (const token of tokens) {
                    if (token.trim()) {
                      sendSSEEvent(res, 'token', {
                        content: token
                      });
                    }
                  }
                  
                  // 检查是否是最终JSON响应
                  try {
                    const obj = JSON.parse(textContent);
                    if (obj && (obj.messageId || obj.status === 'sent')) {
                      if (obj.messageId) finalJsonId = String(obj.messageId);
                      taskCompleted = true;
                      log.info({ final_response: obj }, 'Task completed with final response');
                    }
                  } catch {
                    // ignore non-JSON content
                  }
                }
              }

              // 静默处理工具调用和结果，不发送SSE事件，但仍然捕获messageId
              if (e && (e.type === 'tool_result' || e.type === 'mcp_tool_result')) {
                const name = e.name || e.toolName || e.tool || e.tool_id || '';
                const result = e.result || e.toolResult || e.output || {};
                
                // 捕获smtp_send的messageId
                if (String(name).includes('smtp_send')) {
                  const mid = result?.messageId || result?.data?.messageId;
                  if (mid) {
                    messageId = String(mid);
                    log.info({ smtp_messageId: messageId }, 'SMTP message ID captured');
                  }
                }
              }

              // 增加工具事件摘要日志，便于观察 e.result 等字段
              try {
                const name = e?.name || e?.toolName || e?.tool || e?.tool_id;
                const args = e?.arguments || e?.args || e?.input || e?.params || e?.toolInput;
                const result = e?.result || e?.toolResult || e?.output;
                if (e && (String(e.type).includes('tool') || name)) {
                  log.info(
                    {
                      claude_tool_summary: {
                        type: e.type,
                        name: name || undefined,
                        hasArgs: !!args,
                        hasResult: !!result,
                        resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
                      },
                    },
                    'Claude tool summary'
                  );
                }
                if (e && e.type === 'message') {
                  const blockTypes = Array.isArray(e.content) ? e.content.map((p: any) => p?.type) : [];
                  log.info({ claude_message_summary: { blockTypes } }, 'Claude message summary');
                }
              } catch {}

              if (timedOut) {
                break;
              }

              // Break if we have messageId or task is completed
              if (messageId || finalJsonId || taskCompleted) {
                log.info({ 
                  messageId, 
                  finalJsonId, 
                  taskCompleted,
                  reason: 'Breaking loop - task completed or messageId found'
                }, 'SSE loop ending');
                break;
              }
            }
          } catch (sseError) {
            // Handle SSE-specific errors
            const msg = sseError instanceof Error ? sseError.message : String(sseError);
            if (!res.headersSent) {
              setupSSE(res);
            }
            sendSSEEvent(res, 'error', { 
              error: msg
            });
            res.end();
            return;
          } finally {
            clearTimeout(timer);
            cleanup();
          }

          const id = messageId || finalJsonId || getLastSmtpMessageId();
          
          // Send final event with performance summary
          const endTime = Date.now();
          const totalDuration = endTime - startTime;
          const claudeDuration = endTime - claudeStartTime;
          
          if (taskCompleted || id) {
            sendSSEEvent(res, 'done', {
              finished: true,
              messageId: id,
              success: true,
              performance: {
                total_duration_ms: totalDuration,
                claude_duration_ms: claudeDuration,
                initialization_time_ms: claudeStartTime - startTime
              }
            });
            log.info({ 
              final_messageId: id, 
              taskCompleted,
              success: true,
              performance_summary: {
                total_duration_ms: totalDuration,
                claude_duration_ms: claudeDuration,
                initialization_time_ms: claudeStartTime - startTime,
                efficiency_score: totalDuration < 30000 ? 'good' : totalDuration < 60000 ? 'acceptable' : 'needs_optimization'
              }
            }, 'SSE completed successfully');
          } else if (timedOut) {
            sendSSEEvent(res, 'error', {
              error: 'Agent processing timeout - task took longer than expected',
              timeout: true,
              performance: {
                total_duration_ms: totalDuration,
                timeout_threshold_ms: TIMEOUT_MS
              }
            });
            log.warn({ 
              timeout_duration_ms: totalDuration,
              timeout_threshold_ms: TIMEOUT_MS 
            }, 'SSE ended due to timeout');
          } else {
            sendSSEEvent(res, 'error', {
              error: 'No response received from agent',
              noResponse: true,
              performance: {
                total_duration_ms: totalDuration
              }
            });
            log.warn({ 
              duration_ms: totalDuration 
            }, 'SSE ended with no response');
          }
          
          res.end();
          return;
        } else {
          // JSON Mode (backward compatibility)
          setLastSmtpMessageId(undefined);
          const q = query({ prompt, options });
          let messageId: string | undefined;
          let finalJsonId: string | undefined;
          
          const TIMEOUT_MS = Number(process.env.AGENT_ROUTE_TIMEOUT_MS || 45000);
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; }, TIMEOUT_MS);
          
          try {
            for await (const ev of q) {
              const e: any = ev as any;
              // 详细打印 Claude 输出（完整事件）
              try {
                log.info({ claude_output: e }, 'Claude output');
              } catch {}
              // 增加工具事件摘要日志，便于观察 e.result 等字段
              try {
                const name = e?.name || e?.toolName || e?.tool || e?.tool_id;
                const args = e?.arguments || e?.args || e?.input || e?.params || e?.toolInput;
                const result = e?.result || e?.toolResult || e?.output;
                if (e && (String(e.type).includes('tool') || name)) {
                  log.info(
                    {
                      claude_tool_summary: {
                        type: e.type,
                        name: name || undefined,
                        hasArgs: !!args,
                        hasResult: !!result,
                        resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
                      },
                    },
                    'Claude tool summary'
                  );
                }
                if (e && e.type === 'message') {
                  const blockTypes = Array.isArray(e.content) ? e.content.map((p: any) => p?.type) : [];
                  log.info({ claude_message_summary: { blockTypes } }, 'Claude message summary');
                }
              } catch {}
              // Capture tool result from smtp_send
              if (e && (e.type === 'tool_result' || e.type === 'mcp_tool_result')) {
                const name = e.name || e.toolName || e.tool || e.tool_id || '';
                if (String(name).includes('smtp_send')) {
                  const result = e.result || e.toolResult || e.output || {};
                  const mid = result?.messageId || result?.data?.messageId;
                  if (mid) messageId = String(mid);
                  if (messageId) break;
                }
              }
              // Parse final message for JSON
              if (e && e.type === 'message') {
                const parts = Array.isArray(e.content) ? e.content : [];
                const textBlob = parts.map((p: any) => String(p?.text || p?.content || '')).join('\n').trim();
                if (textBlob) {
                  try {
                    const trimmed = textBlob.trim();
                    const firstBrace = trimmed.indexOf('{');
                    const lastBrace = trimmed.lastIndexOf('}');
                    const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
                    const obj = JSON.parse(jsonStr);
                    if (obj && obj.messageId) finalJsonId = String(obj.messageId);
                    if (finalJsonId) break;
                  } catch {
                    // ignore non-JSON assistant messages
                  }
                }
              }
              if (timedOut) {
                log.warn({ route: '/api/agent/send', timedOut: true }, 'Agent route timeout reached');
                break;
              }
            }
          } finally {
            clearTimeout(timer);
          }

          const id = messageId || finalJsonId || getLastSmtpMessageId();
          if (!id) {
            return sendJson(res, timedOut ? 504 : 500, { ok: false, error: timedOut ? 'Agent timed out without messageId' : 'Agent did not provide messageId' });
          }
          return sendJson(res, 200, { ok: true, messageId: id });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isSSERequest(req)) {
          // SSE error response
          if (!res.headersSent) {
            setupSSE(res);
          }
          sendSSEEvent(res, 'error', { 
            error: msg
          });
          res.end();
        } else {
          // JSON error response
          return sendJson(res, 500, { ok: false, error: msg });
        }
      }
    }

    // Not found
    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(port, () => {
    log.info({ port }, 'REST API server listening');
  });

  // Optionally start a long-running Agent session; disabled by default
  if (env.ENABLE_PERSISTENT_AGENT) {
    (async () => {
      try {
        const persistentPrompt = 'Initialize persistent session. You can use smtp_send tool to send emails.';
        // 详细打印 Claude 输入（持久会话初始化）
        log.info(
          {
            claude_input: {
              route: 'persistent_agent',
              model: (options as any)?.model,
              prompt: persistentPrompt,
            },
          },
          'Claude input'
        );
        const q = query({ prompt: persistentPrompt, options });
        for await (const ev of q) {
          const e: any = ev as any;
          try {
            log.info({ claude_output: e }, 'Claude output');
          } catch {}
        }
      } catch (err) {
        const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
        log.error(error, 'Agent failed to start');
      }
    })();
  }
}

start().catch((err) => {
  const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
  log.error(error, 'Agent crashed');
  process.exit(1);
});