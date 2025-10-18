# 📄 api/agent/send SSE方案

**版本**：v1.2
**状态**：已完成（Completed）
**编写时间**：2025-10-18
**更新时间**：2025-01-27
**负责人**：4ier
**目标**：提供 Claude Agent 推理过程的实时流式输出接口，实现持续传输（SSE, Server-Sent Events）协议。

---

## 1. 🎯 设计目标

后端在执行 `/api/agent/send` 任务时，允许客户端实时接收 Claude Agent 的输出事件，包括：

* 文字生成（token 级输出）
* 工具调用（web_search、smtp_send 等）
* 系统状态（init、done、error、timeout）

以保证**人类可读的实时可观测性**和**前端可视化调试能力**。

此方案不依赖 WebSocket，仅基于标准 HTTP/1.1 长连接，向前兼容 REST 架构。

### 🔄 向后兼容性

本实现支持**自动协议检测**，根据客户端请求头自动选择响应格式：

- **SSE模式**：当 `Accept: text/event-stream` 时，返回实时事件流
- **JSON模式**：当 `Accept: application/json` 或默认时，返回传统JSON响应

这确保了现有客户端无需修改即可继续工作，同时新客户端可以享受实时流式体验。

---

## 2. ⚙️ 接口定义

### Endpoint

```
POST /api/agent/send
```

### 2.1 向后兼容性设计

接口根据 `Accept` 请求头自动选择响应格式：

| Accept 头                | 响应格式      | 说明                    |
| ----------------------- | --------- | --------------------- |
| `text/event-stream`     | SSE 流式输出  | 实时推送 Agent 执行过程      |
| `application/json`      | JSON 响应   | 传统格式，等待完成后返回结果      |
| 未指定或其他                 | JSON 响应   | 默认行为，保持向后兼容         |

### 2.2 请求头

**SSE 模式：**
```http
Content-Type: application/json
Accept: text/event-stream
```

**传统 JSON 模式：**
```http
Content-Type: application/json
Accept: application/json
```

### 2.3 响应头

**SSE 模式：**
```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, Accept
```

**JSON 模式：**
```http
Content-Type: application/json; charset=utf-8
```

### 2.4 请求体示例

```json
{
  "to": "yang.fourier@gmail.com",
  "recipient": "百度",
  "intent": "在邮件中推广宣传AI招聘应用 lovtalent.com",
  "language": "zh-CN",
  "site": "lovtalent.com"
}
```

### 2.5 请求体字段说明

| 字段         | 类型     | 必填 | 说明                           |
| ---------- | ------ | -- | ---------------------------- |
| `to`       | string | ✅  | 收件人邮箱地址，必须是有效的邮箱格式         |
| `recipient`| string | ✅  | 收件人名称或公司名称，用于个性化邮件内容       |
| `intent`   | string | ✅  | 邮件发送意图，描述邮件的目的和内容要求        |
| `language` | string | ❌  | 邮件语言，支持 `zh-CN`、`en`，默认 `zh-CN` |
| `site`     | string | ❌  | 可选的网站信息，用于研究和邮件内容参考        |

---

## 3. 🧩 SSE事件流规范

每个事件遵循以下格式：

```
event: <eventName>
data: <JSON>
```

事件之间用空行分隔。

---

### 3.1 事件类型定义

| 事件类型          | 含义                 | 示例数据                                                               |
| ------------- | ------------------ | ------------------------------------------------------------------ |
| `init`        | 初始化，提供session、模型信息 | `{"session_id":"d58d9e8e","model":"claude-sonnet-4-5-20250929","timestamp":"2025-01-18T10:30:00Z"}`   |
| `thinking`    | Agent 思考过程输出       | `{"text":"我需要先搜索关于百度的信息..."}`                                      |
| `token`       | Claude 生成中的流式输出    | `{"text":"I'll search for information about 百度...","delta":"search"}`               |
| `tool_start`  | 工具调用开始             | `{"tool":"web_search","stage":"start","args":{"query":"百度 AI招聘"},"timestamp":"2025-01-18T10:30:05Z"}` |
| `tool_progress` | 工具执行进度           | `{"tool":"web_search","stage":"progress","message":"正在搜索相关信息..."}`  |
| `tool_result` | 工具调用成功结果           | `{"tool":"smtp_send","stage":"success","result":{"messageId":"<id>"},"timestamp":"2025-01-18T10:30:15Z"}`        |
| `progress`    | 整体进度更新             | `{"stage":"composing","progress":60,"message":"正在撰写邮件内容..."}`        |
| `error`       | 错误或异常              | `{"type":"timeout","message":"Agent route timeout reached","timestamp":"2025-01-18T10:31:00Z"}`                        |
| `warning`     | 警告信息               | `{"message":"搜索结果较少，将基于现有信息撰写邮件","timestamp":"2025-01-18T10:30:10Z"}` |
| `done`        | 执行结束，返回最终状态        | `{"status":"sent","messageId":"<id>","duration_ms":15000,"timestamp":"2025-01-18T10:30:20Z"}`                             |

### 3.2 完整事件流示例

以下是一个典型的SSE事件序列，展示从初始化到完成的完整流程：

```
event: init
data: {"session_id":"d58d9e8e-4d6f-4a2b-8c3e-1f5a7b9c2d4e","model":"claude-sonnet-4-5-20250929","timestamp":"2025-01-27T10:30:00.000Z"}

event: token
data: {"text":"我需要搜索关于"}

event: token
data: {"text":"百度的信息来撰写个性化邮件。"}

event: tool
data: {"tool":"web_search","stage":"start","args":{"query":"百度 AI招聘 lovtalent.com"}}

event: tool_result
data: {"tool":"web_search","stage":"success","result":{"results":[{"title":"百度AI招聘平台","url":"https://example.com","snippet":"百度正在招聘AI工程师..."}]}}

event: token
data: {"text":"基于搜索结果，我将为百度撰写一封关于AI招聘应用的推广邮件。"}

event: tool
data: {"tool":"smtp_send","stage":"start","args":{"to":"yang.fourier@gmail.com","subject":"AI招聘新机遇 - lovtalent.com助力百度人才发现","text":"尊敬的百度团队..."}}

event: tool_result
data: {"tool":"smtp_send","stage":"success","result":{"messageId":"<7b4c8a30-1e2f-4d5c-9a8b-3f6e2d1c4b7a@gmail.com>"}}

event: token
data: {"text":"邮件已成功发送！"}

event: done
data: {"status":"sent","messageId":"<7b4c8a30-1e2f-4d5c-9a8b-3f6e2d1c4b7a@gmail.com>","duration_ms":12450}
```

### 3.3 错误场景事件流

当发生错误时的事件序列：

```
event: init
data: {"session_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","model":"claude-sonnet-4-5-20250929","timestamp":"2025-01-27T10:35:00.000Z"}

event: token
data: {"text":"开始处理邮件发送请求..."}

event: tool
data: {"tool":"web_search","stage":"start","args":{"query":"无效查询"}}

event: error
data: {"message":"Agent route timeout reached","timeout_ms":45000,"timestamp":"2025-01-27T10:35:45.000Z"}
```



---

## 4. 客户端实现指南

### 4.1 JavaScript/TypeScript 客户端

#### 基础 SSE 客户端实现

```typescript
interface SSEEventData {
  init?: {
    session_id: string;
    model: string;
    timestamp: string;
  };
  token?: {
    text: string;
    delta: string;
  };
  tool_start?: {
    tool: string;
    stage: string;
    args: any;
    timestamp: string;
  };
  tool_result?: {
    tool: string;
    stage: string;
    result: any;
    timestamp: string;
  };
  error?: {
    code: string;
    message: string;
    timestamp: string;
  };
  done?: {
    status: string;
    messageId?: string;
    duration_ms: number;
    timestamp: string;
  };
}

class AgentSSEClient {
  private eventSource: EventSource | null = null;
  private abortController: AbortController | null = null;

  async sendEmail(
    recipient: string,
    intent: string,
    site?: string,
    onEvent?: (eventType: string, data: any) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      
      const requestBody = {
        recipient,
        intent,
        ...(site && { site })
      };

      // 发送POST请求并建立SSE连接
      fetch('/api/agent/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              this.processSSELine(line, onEvent, resolve, reject);
            }

            processStream();
          }).catch(reject);
        };

        processStream();
      })
      .catch(reject);
    });
  }

  private processSSELine(
    line: string,
    onEvent?: (eventType: string, data: any) => void,
    resolve?: (value: string) => void,
    reject?: (reason: any) => void
  ) {
    if (line.startsWith('event: ')) {
      this.currentEventType = line.substring(7);
    } else if (line.startsWith('data: ')) {
      const dataStr = line.substring(6);
      
      try {
        const data = JSON.parse(dataStr);
        
        if (onEvent) {
          onEvent(this.currentEventType, data);
        }

        // 处理特定事件
        switch (this.currentEventType) {
          case 'done':
            if (data.status === 'sent' && data.messageId && resolve) {
              resolve(data.messageId);
            }
            break;
          case 'error':
            if (reject) {
              reject(new Error(`Agent error: ${data.message}`));
            }
            break;
        }
      } catch (e) {
        console.warn('Failed to parse SSE data:', dataStr);
      }
    }
  }

  private currentEventType: string = '';

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}
```

#### React Hook 实现

```typescript
import { useState, useCallback, useRef } from 'react';

interface UseAgentSendOptions {
  onToken?: (text: string, delta: string) => void;
  onToolStart?: (tool: string, args: any) => void;
  onToolResult?: (tool: string, result: any) => void;
  onError?: (error: string) => void;
  onComplete?: (messageId: string) => void;
}

export function useAgentSend(options: UseAgentSendOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState<string>('');
  const [generatedText, setGeneratedText] = useState('');
  const clientRef = useRef<AgentSSEClient>();

  const sendEmail = useCallback(async (
    recipient: string,
    intent: string,
    site?: string
  ) => {
    setIsLoading(true);
    setProgress(0);
    setCurrentStage('initializing');
    setGeneratedText('');

    try {
      if (!clientRef.current) {
        clientRef.current = new AgentSSEClient();
      }

      const messageId = await clientRef.current.sendEmail(
        recipient,
        intent,
        site,
        (eventType, data) => {
          switch (eventType) {
            case 'init':
              setCurrentStage('initialized');
              setProgress(10);
              break;
            
            case 'token':
              setGeneratedText(data.text);
              options.onToken?.(data.text, data.delta);
              break;
            
            case 'tool_start':
              setCurrentStage(`tool: ${data.tool}`);
              setProgress(30);
              options.onToolStart?.(data.tool, data.args);
              break;
            
            case 'tool_result':
              setProgress(60);
              options.onToolResult?.(data.tool, data.result);
              break;
            
            case 'progress':
              setProgress(data.progress || 0);
              setCurrentStage(data.message || data.stage);
              break;
            
            case 'error':
              options.onError?.(data.message);
              break;
            
            case 'done':
              setProgress(100);
              setCurrentStage('completed');
              options.onComplete?.(data.messageId);
              break;
          }
        }
      );

      return messageId;
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  const abort = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.abort();
    }
    setIsLoading(false);
    setCurrentStage('aborted');
  }, []);

  return {
    sendEmail,
    abort,
    isLoading,
    progress,
    currentStage,
    generatedText
  };
}
```

#### Vue 3 Composable 实现

```typescript
import { ref, onUnmounted } from 'vue';

export function useAgentSend() {
  const isLoading = ref(false);
  const progress = ref(0);
  const currentStage = ref('');
  const generatedText = ref('');
  const error = ref<string | null>(null);
  
  let client: AgentSSEClient | null = null;

  const sendEmail = async (
    recipient: string,
    intent: string,
    site?: string
  ) => {
    isLoading.value = true;
    progress.value = 0;
    currentStage.value = 'initializing';
    generatedText.value = '';
    error.value = null;

    try {
      client = new AgentSSEClient();
      
      const messageId = await client.sendEmail(
        recipient,
        intent,
        site,
        (eventType, data) => {
          switch (eventType) {
            case 'init':
              currentStage.value = 'initialized';
              progress.value = 10;
              break;
            
            case 'token':
              generatedText.value = data.text;
              break;
            
            case 'tool_start':
              currentStage.value = `tool: ${data.tool}`;
              progress.value = 30;
              break;
            
            case 'tool_result':
              progress.value = 60;
              break;
            
            case 'progress':
              progress.value = data.progress || 0;
              currentStage.value = data.message || data.stage;
              break;
            
            case 'error':
              error.value = data.message;
              break;
            
            case 'done':
              progress.value = 100;
              currentStage.value = 'completed';
              break;
          }
        }
      );

      return messageId;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const abort = () => {
    if (client) {
      client.abort();
      client = null;
    }
    isLoading.value = false;
    currentStage.value = 'aborted';
  };

  onUnmounted(() => {
    abort();
  });

  return {
    sendEmail,
    abort,
    isLoading: readonly(isLoading),
    progress: readonly(progress),
    currentStage: readonly(currentStage),
    generatedText: readonly(generatedText),
    error: readonly(error)
  };
}
```

### 4.2 错误处理和重连机制

```typescript
class RobustAgentSSEClient extends AgentSSEClient {
  private maxRetries = 3;
  private retryDelay = 1000;
  private currentRetry = 0;

  async sendEmailWithRetry(
    recipient: string,
    intent: string,
    site?: string,
    onEvent?: (eventType: string, data: any) => void
  ): Promise<string> {
    while (this.currentRetry <= this.maxRetries) {
      try {
        return await this.sendEmail(recipient, intent, site, onEvent);
      } catch (error) {
        this.currentRetry++;
        
        if (this.currentRetry > this.maxRetries) {
          throw new Error(`Failed after ${this.maxRetries} retries: ${error}`);
        }

        // 指数退避
        const delay = this.retryDelay * Math.pow(2, this.currentRetry - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        console.warn(`Retry ${this.currentRetry}/${this.maxRetries} after ${delay}ms`);
      }
    }
    
    throw new Error('Unexpected retry loop exit');
  }
}
```

---

## 5. 🔧 后端实现约定（Node.js）

### 5.1 基于当前 server.ts 的 SSE 实现

以下是基于当前项目实际代码的 SSE 实现方案：

```typescript
import { IncomingMessage, ServerResponse } from 'http';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// SSE 响应头设置
function setupSSEHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });
}

// SSE 事件发送器
function sendSSEEvent(res: ServerResponse, eventType: string, data: any) {
  const timestamp = new Date().toISOString();
  const eventData = { ...data, timestamp };
  
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(eventData)}\n\n`);
}

// 修改后的 /api/agent/send 端点
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
    
    // 检查 Accept 头决定响应格式
    const acceptHeader = req.headers.accept || '';
    const isSSE = acceptHeader.includes('text/event-stream');
    
    if (isSSE) {
      // SSE 模式
      setupSSEHeaders(res);
      
      // 发送初始化事件
      sendSSEEvent(res, 'init', {
        session_id: crypto.randomUUID(),
        model: (options as any)?.model || 'claude-sonnet-4-5-20250929',
        recipient,
        intent,
        language
      });
      
      // 构建提示词
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
      
      // 详细打印 Claude 输入
      log.info({
        claude_input: {
          route: '/api/agent/send',
          model: (options as any)?.model,
          args: { to, recipient, intent, language, site },
          prompt,
        },
      }, 'Claude input');
      
      setLastSmtpMessageId(undefined);
      const q = query({ prompt, options });
      let messageId: string | undefined;
      let finalJsonId: string | undefined;
      let currentText = '';
      
      const TIMEOUT_MS = Number(process.env.AGENT_ROUTE_TIMEOUT_MS || 45000);
      let timedOut = false;
      const timer = setTimeout(() => { 
        timedOut = true;
        sendSSEEvent(res, 'error', {
          code: 'TIMEOUT',
          message: 'Agent processing timeout'
        });
        res.end();
      }, TIMEOUT_MS);
      
      // 心跳机制
      const heartbeatInterval = setInterval(() => {
        if (!res.destroyed) {
          res.write(': heartbeat\n\n');
        }
      }, 30000);
      
      try {
        for await (const ev of q) {
          if (timedOut || res.destroyed) break;
          
          const e: any = ev as any;
          
          // 详细打印 Claude 输出
          log.info({ claude_output: e }, 'Claude output');
          
          // 处理不同类型的事件
          switch (e.type) {
            case 'message':
              // 处理消息内容
              const parts = Array.isArray(e.content) ? e.content : [];
              const textBlob = parts
                .map((p: any) => String(p?.text || p?.content || ''))
                .join('\n')
                .trim();
              
              if (textBlob) {
                // 检查是否为最终 JSON 响应
                try {
                  const trimmed = textBlob.trim();
                  const firstBrace = trimmed.indexOf('{');
                  const lastBrace = trimmed.lastIndexOf('}');
                  const jsonStr = firstBrace >= 0 && lastBrace > firstBrace 
                    ? trimmed.slice(firstBrace, lastBrace + 1) 
                    : trimmed;
                  const obj = JSON.parse(jsonStr);
                  if (obj && obj.messageId) {
                    finalJsonId = String(obj.messageId);
                    sendSSEEvent(res, 'done', {
                      status: 'sent',
                      messageId: finalJsonId,
                      duration_ms: Date.now() - startTime
                    });
                    break;
                  }
                } catch {
                  // 不是 JSON，作为普通文本处理
                  if (textBlob !== currentText) {
                    const delta = textBlob.slice(currentText.length);
                    currentText = textBlob;
                    sendSSEEvent(res, 'token', {
                      text: currentText,
                      delta: delta
                    });
                  }
                }
              }
              break;
              
            case 'tool_use':
            case 'tool_start':
              const toolName = e.name || e.toolName || e.tool || e.tool_id;
              const toolArgs = e.arguments || e.args || e.input || e.params || e.toolInput;
              
              sendSSEEvent(res, 'tool_start', {
                tool: toolName,
                stage: 'start',
                args: toolArgs
              });
              break;
              
            case 'tool_result':
            case 'mcp_tool_result':
              const resultToolName = e.name || e.toolName || e.tool || e.tool_id || '';
              const result = e.result || e.toolResult || e.output || {};
              
              sendSSEEvent(res, 'tool_result', {
                tool: resultToolName,
                stage: 'success',
                result: result
              });
              
              // 特殊处理 smtp_send 结果
              if (String(resultToolName).includes('smtp_send')) {
                const mid = result?.messageId || result?.data?.messageId;
                if (mid) {
                  messageId = String(mid);
                  sendSSEEvent(res, 'progress', {
                    stage: 'email_sent',
                    progress: 90,
                    message: 'Email sent successfully'
                  });
                }
              }
              break;
              
            case 'thinking':
              if (e.content) {
                sendSSEEvent(res, 'thinking', {
                  text: e.content
                });
              }
              break;
          }
        }
        
        // 如果没有通过 JSON 响应获得 messageId，尝试其他方式
        const id = messageId || finalJsonId || getLastSmtpMessageId();
        if (id && !finalJsonId) {
          sendSSEEvent(res, 'done', {
            status: 'sent',
            messageId: id,
            duration_ms: Date.now() - startTime
          });
        } else if (!id && !timedOut) {
          sendSSEEvent(res, 'error', {
            code: 'NO_MESSAGE_ID',
            message: 'Agent did not provide messageId'
          });
        }
        
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendSSEEvent(res, 'error', {
          code: 'PROCESSING_ERROR',
          message: msg
        });
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeatInterval);
        if (!res.destroyed) {
          res.end();
        }
      }
      
    } else {
      // 传统 JSON 模式（保持原有逻辑）
      const startTime = Date.now();
      
      // ... 原有的 JSON 响应逻辑保持不变 ...
      
    }
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (acceptHeader.includes('text/event-stream')) {
      setupSSEHeaders(res);
      sendSSEEvent(res, 'error', {
        code: 'REQUEST_ERROR',
        message: msg
      });
      res.end();
    } else {
      return sendJson(res, 500, { ok: false, error: msg });
    }
  }
}
```

### 5.2 关键实现要点

#### 协议检测
```typescript
const acceptHeader = req.headers.accept || '';
const isSSE = acceptHeader.includes('text/event-stream');
```

#### 事件映射
- `message` → `token` 事件（文本生成）
- `tool_use` → `tool_start` 事件
- `tool_result` → `tool_result` 事件
- `thinking` → `thinking` 事件（如果支持）
- 超时 → `error` 事件
- 完成 → `done` 事件

#### 错误处理
```typescript
// 超时处理
const timer = setTimeout(() => { 
  timedOut = true;
  sendSSEEvent(res, 'error', {
    code: 'TIMEOUT',
    message: 'Agent processing timeout'
  });
  res.end();
}, TIMEOUT_MS);

// 连接断开检测
if (res.destroyed) break;
```

#### 心跳机制
```typescript
const heartbeatInterval = setInterval(() => {
  if (!res.destroyed) {
    res.write(': heartbeat\n\n');
  }
}, 30000);
```

## 6. 错误处理最佳实践

### 6.1 客户端错误处理

```typescript
class RobustSSEClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  async sendEmailWithErrorHandling(
    recipient: string,
    intent: string,
    site?: string,
    onEvent?: (eventType: string, data: any) => void,
    onError?: (error: Error) => void
  ) {
    try {
      return await this.sendEmail(recipient, intent, site, (eventType, data) => {
        if (eventType === 'error') {
          this.handleServerError(data, onError);
        } else {
          onEvent?.(eventType, data);
        }
      });
    } catch (error) {
      this.handleConnectionError(error as Error, onError);
      throw error;
    }
  }

  private handleServerError(errorData: any, onError?: (error: Error) => void) {
    const error = new Error(errorData.message || 'Server error');
    (error as any).code = errorData.code;
    (error as any).timestamp = errorData.timestamp;
    
    switch (errorData.code) {
      case 'TIMEOUT':
        console.warn('Agent processing timeout, consider retrying');
        break;
      case 'NO_MESSAGE_ID':
        console.error('Agent failed to provide message ID');
        break;
      case 'PROCESSING_ERROR':
        console.error('Agent processing error:', errorData.message);
        break;
      default:
        console.error('Unknown server error:', errorData);
    }
    
    onError?.(error);
  }

  private handleConnectionError(error: Error, onError?: (error: Error) => void) {
    if (error.name === 'AbortError') {
      console.log('Request was aborted');
      return;
    }
    
    console.error('Connection error:', error.message);
    onError?.(error);
  }
}
```

### 6.2 服务端错误处理

```typescript
// 增强的错误处理中间件
function handleSSEError(res: ServerResponse, error: Error, code: string = 'INTERNAL_ERROR') {
  if (!res.headersSent) {
    setupSSEHeaders(res);
  }
  
  sendSSEEvent(res, 'error', {
    code,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
  
  if (!res.destroyed) {
    res.end();
  }
}

// 请求验证错误
function handleValidationError(res: ServerResponse, validationError: any) {
  handleSSEError(res, new Error('Invalid request parameters'), 'VALIDATION_ERROR');
}

// 超时错误
function handleTimeout(res: ServerResponse) {
  handleSSEError(res, new Error('Request timeout'), 'TIMEOUT');
}
```

## 7. 安全考虑

### 7.1 CORS 配置

```typescript
// 生产环境 CORS 配置
function setupSecureSSEHeaders(res: ServerResponse, origin?: string) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': isAllowedOrigin ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control',
    'Access-Control-Allow-Credentials': 'true',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  });
}
```

### 7.2 认证和授权

```typescript
// JWT 认证中间件
async function authenticateSSERequest(req: IncomingMessage): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }
  
  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    return true;
  } catch (error) {
    return false;
  }
}

// 速率限制
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(clientIP: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(clientIP);
  
  if (!limit || now > limit.resetTime) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + 60000 }); // 1分钟窗口
    return true;
  }
  
  if (limit.count >= 10) { // 每分钟最多10次请求
    return false;
  }
  
  limit.count++;
  return true;
}
```

### 7.3 输入验证和清理

```typescript
import DOMPurify from 'isomorphic-dompurify';

// 输入清理
function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
}

// 增强的请求验证
const enhancedSchema = z.object({
  to: z.string().email().max(254),
  recipient: z.string().min(1).max(500).transform(sanitizeInput),
  intent: z.string().min(1).max(2000).transform(sanitizeInput),
  language: z.enum(['zh-CN', 'en']).optional().default('zh-CN'),
  site: z.string().url().optional(),
});
```

## 8. 性能优化建议

### 8.1 连接池管理

```typescript
class SSEConnectionPool {
  private connections = new Map<string, ServerResponse>();
  private maxConnections = 1000;

  addConnection(sessionId: string, res: ServerResponse) {
    if (this.connections.size >= this.maxConnections) {
      this.closeOldestConnection();
    }
    
    this.connections.set(sessionId, res);
    
    // 连接清理
    res.on('close', () => {
      this.connections.delete(sessionId);
    });
  }

  private closeOldestConnection() {
    const [oldestId] = this.connections.keys();
    const oldestRes = this.connections.get(oldestId);
    if (oldestRes && !oldestRes.destroyed) {
      oldestRes.end();
    }
    this.connections.delete(oldestId);
  }

  getActiveConnectionCount(): number {
    return this.connections.size;
  }
}
```

### 8.2 内存管理

```typescript
// 事件缓冲区管理
class EventBuffer {
  private buffer: string[] = [];
  private maxBufferSize = 1000;

  addEvent(eventType: string, data: any) {
    const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    
    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift(); // 移除最旧的事件
    }
    
    this.buffer.push(event);
  }

  flush(res: ServerResponse) {
    for (const event of this.buffer) {
      if (!res.destroyed) {
        res.write(event);
      }
    }
    this.buffer = [];
  }
}
```

### 8.3 压缩和优化

```typescript
import { createGzip } from 'zlib';

// 响应压缩
function setupCompressedSSEHeaders(res: ServerResponse, acceptEncoding: string) {
  const headers: any = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };

  if (acceptEncoding.includes('gzip')) {
    headers['Content-Encoding'] = 'gzip';
    const gzip = createGzip();
    gzip.pipe(res);
    return gzip;
  }

  res.writeHead(200, headers);
  return res;
}
```

## 9. 部署注意事项

### 9.1 环境变量配置

```bash
# .env.production
NODE_ENV=production
AGENT_ROUTE_TIMEOUT_MS=60000
MAX_SSE_CONNECTIONS=500
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
JWT_SECRET=your-super-secret-jwt-key
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=10
```

### 9.2 Nginx 配置

```nginx
# nginx.conf
server {
    listen 80;
    server_name yourdomain.com;

    location /api/agent/send {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE 特定配置
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        
        # 禁用缓存
        add_header Cache-Control no-cache;
        add_header X-Accel-Buffering no;
    }
}
```

### 9.3 Docker 配置

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["npm", "start"]
```

### 9.4 监控和日志

```typescript
// 监控指标
class SSEMetrics {
  private activeConnections = 0;
  private totalRequests = 0;
  private errorCount = 0;

  incrementConnections() {
    this.activeConnections++;
    this.totalRequests++;
  }

  decrementConnections() {
    this.activeConnections--;
  }

  incrementErrors() {
    this.errorCount++;
  }

  getMetrics() {
    return {
      activeConnections: this.activeConnections,
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      errorRate: this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0
    };
  }
}

// 结构化日志
function logSSEEvent(eventType: string, sessionId: string, data?: any) {
  log.info({
    event: 'sse_event',
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    data: data ? JSON.stringify(data).slice(0, 200) : undefined
  });
}
```

## 10. 调试和故障排除

### 10.1 常见问题和解决方案

#### 问题1：SSE 连接立即断开
**症状**：客户端连接后立即收到连接关闭事件
**原因**：
- 服务器端错误导致响应提前结束
- CORS 配置问题
- 代理服务器缓冲设置

**解决方案**：
```typescript
// 调试连接状态
function debugSSEConnection(res: ServerResponse, sessionId: string) {
  res.on('close', () => {
    log.warn({ sessionId, event: 'connection_closed' }, 'SSE connection closed');
  });
  
  res.on('error', (error) => {
    log.error({ sessionId, error: error.message }, 'SSE connection error');
  });
  
  res.on('finish', () => {
    log.info({ sessionId, event: 'connection_finished' }, 'SSE connection finished');
  });
}
```

#### 问题2：事件数据格式错误
**症状**：客户端无法解析事件数据
**原因**：JSON 序列化问题或特殊字符

**解决方案**：
```typescript
function safeJSONStringify(data: any): string {
  try {
    return JSON.stringify(data, (key, value) => {
      // 处理循环引用
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    log.error({ error: error.message, data }, 'JSON stringify failed');
    return JSON.stringify({ error: 'Serialization failed' });
  }
}
```

#### 问题3：内存泄漏
**症状**：服务器内存使用持续增长
**原因**：未正确清理 SSE 连接或事件监听器

**解决方案**：
```typescript
class SSEConnectionManager {
  private connections = new Map<string, {
    response: ServerResponse;
    timers: NodeJS.Timeout[];
    cleanup: () => void;
  }>();

  addConnection(sessionId: string, res: ServerResponse) {
    const timers: NodeJS.Timeout[] = [];
    
    const cleanup = () => {
      // 清理定时器
      timers.forEach(timer => clearTimeout(timer));
      timers.length = 0;
      
      // 移除连接
      this.connections.delete(sessionId);
      
      // 清理响应对象
      if (!res.destroyed) {
        res.removeAllListeners();
        res.end();
      }
    };

    // 连接超时清理
    const timeoutTimer = setTimeout(cleanup, 300000); // 5分钟超时
    timers.push(timeoutTimer);

    res.on('close', cleanup);
    res.on('error', cleanup);

    this.connections.set(sessionId, { response: res, timers, cleanup });
  }

  cleanupAll() {
    for (const [sessionId, connection] of this.connections) {
      connection.cleanup();
    }
    this.connections.clear();
  }
}
```

### 10.2 调试工具和技巧

#### 服务端调试
```typescript
// 详细的 SSE 事件日志
function debugSSEEvent(eventType: string, data: any, sessionId: string) {
  if (process.env.DEBUG_SSE === 'true') {
    log.debug({
      sse_debug: {
        eventType,
        sessionId,
        dataSize: JSON.stringify(data).length,
        timestamp: Date.now(),
        memoryUsage: process.memoryUsage()
      }
    }, 'SSE Event Debug');
  }
}

// 连接状态监控
function monitorSSEHealth() {
  setInterval(() => {
    const metrics = {
      activeConnections: connectionPool.getActiveConnectionCount(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    log.info({ sse_health: metrics }, 'SSE Health Check');
  }, 30000);
}
```

#### 客户端调试
```typescript
class DebugSSEClient extends AgentSSEClient {
  private debugMode = process.env.NODE_ENV === 'development';

  protected processSSELine(line: string, onEvent?: Function, resolve?: Function, reject?: Function) {
    if (this.debugMode) {
      console.log(`[SSE Debug] Raw line: ${line}`);
    }
    
    super.processSSELine(line, (eventType, data) => {
      if (this.debugMode) {
        console.log(`[SSE Debug] Event: ${eventType}`, data);
      }
      onEvent?.(eventType, data);
    }, resolve, reject);
  }
}
```

## 11. 完整测试用例

### 11.1 单元测试

```typescript
// tests/sse.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'http';
import { AgentSSEClient } from '../src/client/sse-client';

describe('SSE Client', () => {
  let server: Server;
  let client: AgentSSEClient;

  beforeEach(() => {
    client = new AgentSSEClient();
  });

  afterEach(() => {
    client.abort();
    server?.close();
  });

  it('should handle successful email sending', async () => {
    // 模拟服务器
    server = createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // 发送测试事件序列
      res.write('event: init\n');
      res.write('data: {"session_id":"test-123","model":"claude-sonnet-4-5-20250929"}\n\n');
      
      res.write('event: token\n');
      res.write('data: {"text":"Hello","delta":"Hello"}\n\n');
      
      res.write('event: done\n');
      res.write('data: {"status":"sent","messageId":"msg-123"}\n\n');
      
      res.end();
    });

    server.listen(3001);

    const events: Array<{type: string, data: any}> = [];
    
    const messageId = await client.sendEmail(
      'test@example.com',
      'Test intent',
      undefined,
      (eventType, data) => {
        events.push({ type: eventType, data });
      }
    );

    expect(messageId).toBe('msg-123');
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('token');
    expect(events[2].type).toBe('done');
  });

  it('should handle server errors', async () => {
    server = createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      res.write('event: error\n');
      res.write('data: {"code":"TIMEOUT","message":"Processing timeout"}\n\n');
      res.end();
    });

    server.listen(3002);

    await expect(
      client.sendEmail('test@example.com', 'Test intent')
    ).rejects.toThrow('Agent error: Processing timeout');
  });

  it('should handle connection abort', async () => {
    server = createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // 不发送任何数据，保持连接开放
    });

    server.listen(3003);

    const promise = client.sendEmail('test@example.com', 'Test intent');
    
    // 1秒后中止连接
    setTimeout(() => client.abort(), 1000);

    await expect(promise).rejects.toThrow();
  });
});
```

### 11.2 集成测试

```typescript
// tests/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

describe('SSE Integration Tests', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // 启动测试服务器
    serverProcess = spawn('npm', ['start'], {
      env: { ...process.env, PORT: '3004', NODE_ENV: 'test' }
    });

    // 等待服务器启动
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  afterAll(() => {
    serverProcess?.kill();
  });

  it('should support both SSE and JSON responses', async () => {
    const testData = {
      to: 'test@example.com',
      recipient: 'Test User',
      intent: 'Test email',
      language: 'en'
    };

    // 测试 SSE 响应
    const sseResponse = await fetch('http://localhost:3004/api/agent/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(testData)
    });

    expect(sseResponse.headers.get('content-type')).toBe('text/event-stream');

    // 测试 JSON 响应
    const jsonResponse = await fetch('http://localhost:3004/api/agent/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(testData)
    });

    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
  });

  it('should handle concurrent SSE connections', async () => {
    const testData = {
      to: 'test@example.com',
      recipient: 'Test User',
      intent: 'Test email',
      language: 'en'
    };

    // 创建多个并发连接
    const promises = Array.from({ length: 5 }, () =>
      fetch('http://localhost:3004/api/agent/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(testData)
      })
    );

    const responses = await Promise.all(promises);
    
    // 所有响应都应该成功
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
    });
  });
});
```

### 11.3 性能测试

```typescript
// tests/performance.test.ts
import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';

describe('SSE Performance Tests', () => {
  it('should handle high-frequency events efficiently', async () => {
    const client = new AgentSSEClient();
    const events: any[] = [];
    let eventCount = 0;

    const startTime = performance.now();

    // 模拟高频事件处理
    const mockEventHandler = (eventType: string, data: any) => {
      eventCount++;
      events.push({ eventType, data, timestamp: performance.now() });
    };

    // 模拟1000个事件
    for (let i = 0; i < 1000; i++) {
      mockEventHandler('token', { text: `Token ${i}`, delta: `Token ${i}` });
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(eventCount).toBe(1000);
    expect(duration).toBeLessThan(100); // 应该在100ms内完成
    expect(events).toHaveLength(1000);
  });

  it('should manage memory efficiently with large payloads', async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    
    // 创建大量连接和数据
    const clients = Array.from({ length: 100 }, () => new AgentSSEClient());
    const largeData = 'x'.repeat(10000); // 10KB 数据

    // 模拟处理大量数据
    clients.forEach((client, index) => {
      for (let i = 0; i < 10; i++) {
        // 模拟事件处理
        (client as any).processSSELine(
          `data: ${JSON.stringify({ text: largeData, index, iteration: i })}`,
          () => {},
          () => {},
          () => {}
        );
      }
    });

    // 清理
    clients.forEach(client => client.abort());

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    // 内存增长应该在合理范围内（小于50MB）
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
  });
});
```

### 11.4 手动测试脚本

```bash
#!/bin/bash
# tests/manual-test.sh

echo "=== SSE Manual Testing Script ==="

# 测试 SSE 连接
echo "Testing SSE connection..."
curl -N -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "to": "test@example.com",
       "recipient": "Test User",
       "intent": "Test email for SSE",
       "language": "en"
     }' \
     http://localhost:3000/api/agent/send

echo -e "\n\n=== Testing JSON fallback ==="
curl -H "Accept: application/json" \
     -H "Content-Type: application/json" \
     -d '{
       "to": "test@example.com",
       "recipient": "Test User", 
       "intent": "Test email for JSON",
       "language": "en"
     }' \
     http://localhost:3000/api/agent/send

echo -e "\n\n=== Testing error handling ==="
curl -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "to": "invalid-email",
       "recipient": "Test User",
       "intent": "Test email"
     }' \
     http://localhost:3000/api/agent/send

echo -e "\n\nManual testing completed."
```

伪代码（基于 Express + Anthropic SDK）：

```javascript
app.post("/api/agent/send", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const { to, recipient, intent, language, site } = req.body;

  const stream = await claude.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    messages: [{
      role: "user",
      content: `You are an autonomous outreach agent ...`
    }]
  });

  // 1. 初始化事件
  res.write(`event: init\ndata: ${JSON.stringify({ session_id: stream.sessionId, model: stream.model })}\n\n`);

  // 2. 持续推送 Claude 的生成文本
  for await (const event of stream) {
    if (event.type === "message_delta" && event.delta?.type === "text_delta") {
      res.write(`event: token\ndata: ${JSON.stringify({ text: event.delta.text })}\n\n`);
    }

    if (event.type === "message_delta" && event.delta?.type === "tool_use") {
      res.write(`event: tool\ndata: ${JSON.stringify(event.delta)}\n\n`);
    }

    if (event.type === "message_stop") {
      res.write(`event: done\ndata: ${JSON.stringify({ status: "sent" })}\n\n`);
    }
  }

  res.end();
});
```

> 每个 `.write()` 操作立即刷新到客户端；
> 不需要等整段完成；
> 不对 Claude 响应进行聚合或延迟处理。

---

## 5. 🧠 日志与监控要求

每次调用 `/api/agent/send` 需打印如下关键日志：

| 字段          | 说明                               |
| ----------- | -------------------------------- |
| route       | `/api/agent/send`                |
| model       | 当前模型（claude-sonnet-4-5-20250929） |
| session_id  | Claude 会话 UUID                   |
| timedOut    | 超时标记                             |
| mcp_tool    | 工具调用类型（web_search, smtp_send等）   |
| messageId   | 邮件发送唯一ID                         |
| duration_ms | 总耗时                              |
| status      | "success" / "timeout" / "error"  |

示例：

```
{"level":30,"route":"/api/agent/send","session_id":"d58d9e8e-4d6f...","mcp_tool":"smtp_send","stage":"success","messageId":"<7b4c8a30...>","duration_ms":10234}
```

---

## 6. 🧪 测试与验收标准

| 编号   | 测试项          | 验收标准                              |
| ---- | ------------ | --------------------------------- |
| TC-1 | SSE连接建立      | 返回`200`，响应头包含`text/event-stream`  |
| TC-2 | Claude输出流式推送 | 前端收到连续 `event: token` 数据          |
| TC-3 | 工具调用可见       | `event: tool` 和 `tool_result` 均出现 |
| TC-4 | 正常结束         | 收到 `event: done`，含 `messageId`    |
| TC-5 | 超时处理         | 在 agent 执行超时后发送 `event: error`    |
| TC-6 | 并发稳定性        | 同时发起≥5请求无异常断流                     |

---

## 7. ⚡ 性能与容错要求

| 项     | 指标                          |
| ----- | --------------------------- |
| 超时策略  | 默认 60s，超时触发 `event: error`  |
| 并发连接  | 支持 50 个 SSE 长连接并发           |
| 心跳机制  | 每 20s 发送一次空白 `:ping\n\n` 保活 |
| 客户端重连 | 前端断线后可重连并重新开始任务             |

---

## 8. 🔧 实际后端实现详解

### 8.1 核心实现代码

基于当前项目的真实实现（`src/server.ts`）：

```typescript
// SSE 辅助函数
const setupSSE = (res: ServerResponse) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
};

const sendSSEEvent = (res: ServerResponse, event: string, data: any, id?: string) => {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const isSSERequest = (req: IncomingMessage): boolean => {
  const accept = req.headers.accept || '';
  return accept.includes('text/event-stream');
};

// 主要的 /api/agent/send 处理逻辑
if (method === 'POST' && url.pathname === '/api/agent/send') {
  try {
    const body = await readJson(req);
    const parsed = smtpInputSchema.safeParse(body);
    
    if (!parsed.success) {
      // 错误处理...
      return;
    }

    const { to, recipient, intent, language, site } = parsed.data;
    
    // 检测是否为 SSE 请求
    const useSSE = isSSERequest(req);
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 构建 Claude 提示词
    const prompt = `You are an autonomous outreach agent...`;
    const options = { model: 'claude-3-5-sonnet-20241022' };

    if (useSSE) {
      // === SSE 模式 ===
      setupSSE(res);
      
      // 发送初始化事件
      sendSSEEvent(res, 'init', {
        sessionId,
        model: options.model,
        timestamp: new Date().toISOString(),
        request: { to, recipient, intent, language, site }
      });

      // 设置心跳保活机制
      const heartbeatInterval = setInterval(() => {
        sendSSEEvent(res, 'heartbeat', { 
          timestamp: new Date().toISOString() 
        });
      }, 20000);

      // 清理函数
      const cleanup = () => {
        clearInterval(heartbeatInterval);
      };

      // 处理客户端断开连接
      req.on('close', cleanup);
      req.on('error', cleanup);

      // 执行 Claude Agent
      const q = query({ prompt, options });
      const TIMEOUT_MS = Number(process.env.AGENT_ROUTE_TIMEOUT_MS || 45000);
      let timedOut = false;
      let messageId = '';
      
      const timer = setTimeout(() => { 
        timedOut = true;
        sendSSEEvent(res, 'error', { 
          error: 'Agent timed out', 
          timestamp: new Date().toISOString() 
        });
        cleanup();
        res.end();
      }, TIMEOUT_MS);

      try {
        // 处理 Claude Agent 的输出流
        for await (const ev of q) {
          const e: any = ev as any;
          
          // 处理消息内容
          if (e && e.type === 'message') {
            const parts = Array.isArray(e.content) ? e.content : [];
            const textBlob = parts
              .map((p: any) => String(p?.text || p?.content || ''))
              .join('\n')
              .trim();
            
            if (textBlob) {
              // 发送文本内容事件
              sendSSEEvent(res, 'token', {
                content: textBlob,
                timestamp: new Date().toISOString()
              });
            }
          }

          // 处理工具调用
          if (e && (e.type === 'tool_use' || e.type === 'mcp_tool_use')) {
            const name = e.name || e.toolName || e.tool || e.tool_id || '';
            const args = e.arguments || e.args || e.input || e.params || e.toolInput;
            
            sendSSEEvent(res, 'tool', {
              name,
              arguments: args,
              timestamp: new Date().toISOString()
            });
          }

          // 处理工具结果
          if (e && (e.type === 'tool_result' || e.type === 'mcp_tool_result')) {
            const name = e.name || e.toolName || e.tool || e.tool_id || '';
            const result = e.result || e.toolResult || e.output || {};
            
            sendSSEEvent(res, 'tool_result', {
              name,
              result,
              timestamp: new Date().toISOString()
            });

            // 特别处理邮件发送结果，捕获 messageId
            if (String(name).includes('smtp_send')) {
              const mid = result?.messageId || result?.data?.messageId;
              if (mid) messageId = String(mid);
            }
          }

          // 检查是否应该退出循环
          if (timedOut || messageId) break;
        }
      } finally {
        clearTimeout(timer);
        cleanup();
      }

      // 发送最终事件
      if (messageId) {
        sendSSEEvent(res, 'done', {
          messageId,
          timestamp: new Date().toISOString(),
          status: 'sent'
        });
      } else {
        sendSSEEvent(res, 'error', {
          error: timedOut ? 'Agent timed out without messageId' : 'Agent did not provide messageId',
          timestamp: new Date().toISOString()
        });
      }
      
      res.end();
      return;
    } else {
      // === JSON 模式（向后兼容）===
      // 执行相同的 Claude Agent 逻辑，但收集结果后一次性返回
      // ... 原有的 JSON 处理逻辑
    }
  } catch (err) {
    // 统一错误处理
    logger.error({ error: err, route: '/api/agent/send' }, 'Route error');
    
    if (useSSE) {
      sendSSEEvent(res, 'error', {
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
      res.end();
    } else {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
```

### 8.2 关键实现要点

#### 8.2.1 协议检测
```typescript
const isSSERequest = (req: IncomingMessage): boolean => {
  const accept = req.headers.accept || '';
  return accept.includes('text/event-stream');
};
```

通过检查 `Accept` 头来判断客户端期望的响应格式，实现自动协议选择。

#### 8.2.2 SSE 响应头设置
```typescript
const setupSSE = (res: ServerResponse) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
};
```

正确设置 SSE 相关的 HTTP 响应头，确保浏览器正确处理事件流。

#### 8.2.3 事件格式化
```typescript
const sendSSEEvent = (res: ServerResponse, event: string, data: any, id?: string) => {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};
```

严格遵循 SSE 规范的事件格式，确保客户端能正确解析事件。

#### 8.2.4 心跳保活机制
```typescript
const heartbeatInterval = setInterval(() => {
  sendSSEEvent(res, 'heartbeat', { 
    timestamp: new Date().toISOString() 
  });
}, 20000);
```

每20秒发送心跳事件，防止长时间无数据导致的连接超时。

#### 8.2.5 资源清理
```typescript
const cleanup = () => {
  clearInterval(heartbeatInterval);
};

req.on('close', cleanup);
req.on('error', cleanup);
```

正确处理客户端断开连接的情况，避免资源泄漏。

#### 8.2.6 超时处理
```typescript
const timer = setTimeout(() => { 
  timedOut = true;
  sendSSEEvent(res, 'error', { 
    error: 'Agent timed out', 
    timestamp: new Date().toISOString() 
  });
  cleanup();
  res.end();
}, TIMEOUT_MS);
```

设置合理的超时机制，防止长时间挂起的请求。

### 8.3 测试页面

项目提供了一个完整的测试页面 `/test-sse`，可以直接在浏览器中测试 SSE 功能：

```html
<!DOCTYPE html>
<html>
<head>
    <title>SSE Test Page</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .form-group { margin: 10px 0; }
        label { display: inline-block; width: 100px; }
        input, textarea { width: 300px; padding: 5px; }
        button { padding: 10px 20px; margin: 5px; }
        #log { border: 1px solid #ccc; height: 400px; overflow-y: scroll; padding: 10px; background: #f9f9f9; }
        .event { margin: 5px 0; padding: 5px; border-left: 3px solid #007cba; }
        .error { border-left-color: #d32f2f; }
        .success { border-left-color: #388e3c; }
    </style>
</head>
<body>
    <h1>SSE Test Page</h1>
    
    <form id="testForm">
        <div class="form-group">
            <label>To:</label>
            <input type="email" id="to" value="yang.fourier@gmail.com" required>
        </div>
        <div class="form-group">
            <label>Recipient:</label>
            <input type="text" id="recipient" value="百度" required>
        </div>
        <div class="form-group">
            <label>Intent:</label>
            <textarea id="intent" required>在邮件中推广宣传AI招聘应用 lovtalent.com</textarea>
        </div>
        <div class="form-group">
            <label>Language:</label>
            <input type="text" id="language" value="zh-CN">
        </div>
        <div class="form-group">
            <label>Site:</label>
            <input type="text" id="site" value="lovtalent.com">
        </div>
        
        <button type="button" onclick="testSSE()">Test SSE</button>
        <button type="button" onclick="testJSON()">Test JSON</button>
        <button type="button" onclick="clearLog()">Clear Log</button>
    </form>
    
    <h2>Event Log</h2>
    <div id="log"></div>
    
    <script>
        // SSE 测试和 JSON 测试的完整实现...
    </script>
</body>
</html>
```

### 8.4 部署注意事项

1. **环境变量配置**：
   ```bash
   AGENT_ROUTE_TIMEOUT_MS=45000  # Agent 超时时间
   SMTP_HOST=smtp.gmail.com      # SMTP 服务器配置
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

2. **反向代理配置**（Nginx）：
   ```nginx
   location /api/agent/send {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       
       # SSE 特殊配置
       proxy_buffering off;
       proxy_cache off;
       proxy_set_header Connection '';
       proxy_http_version 1.1;
       chunked_transfer_encoding off;
   }
   ```

3. **监控和日志**：
    - 使用 `pino` 记录详细的请求日志
    - 监控 SSE 连接数量和持续时间
    - 设置适当的告警阈值

---

## 9. 📱 客户端实现指南

### 9.1 JavaScript/TypeScript 客户端

#### 9.1.1 基础 SSE 客户端类

```typescript
interface SSEEventData {
  init?: {
    sessionId: string;
    model: string;
    timestamp: string;
    request: any;
  };
  token?: {
    content: string;
    timestamp: string;
  };
  tool?: {
    name: string;
    arguments: any;
    timestamp: string;
  };
  tool_result?: {
    name: string;
    result: any;
    timestamp: string;
  };
  heartbeat?: {
    timestamp: string;
  };
  error?: {
    error: string;
    timestamp: string;
  };
  done?: {
    messageId: string;
    timestamp: string;
    status: string;
  };
}

class AgentSSEClient {
  private eventSource: EventSource | null = null;
  private abortController: AbortController | null = null;

  /**
   * 发送邮件并监听实时事件
   */
  async sendEmail(
    requestData: {
      to: string;
      recipient: string;
      intent: string;
      language?: string;
      site?: string;
    },
    callbacks: {
      onInit?: (data: SSEEventData['init']) => void;
      onToken?: (data: SSEEventData['token']) => void;
      onTool?: (data: SSEEventData['tool']) => void;
      onToolResult?: (data: SSEEventData['tool_result']) => void;
      onHeartbeat?: (data: SSEEventData['heartbeat']) => void;
      onError?: (data: SSEEventData['error']) => void;
      onDone?: (data: SSEEventData['done']) => void;
    }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      
      // 使用 fetch 发送 POST 请求并建立 SSE 连接
      fetch('/api/agent/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestData),
        signal: this.abortController.signal
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              this.processSSELine(line, callbacks, resolve, reject);
            }

            processStream();
          }).catch(reject);
        };

        processStream();
      })
      .catch(reject);
    });
  }

  /**
   * 处理 SSE 事件行
   */
  private processSSELine(
    line: string,
    callbacks: any,
    resolve: (value: string) => void,
    reject: (reason: any) => void
  ) {
    if (line.startsWith('event: ')) {
      this.currentEvent = line.substring(7);
    } else if (line.startsWith('data: ')) {
      const dataStr = line.substring(6);
      
      try {
        const data = JSON.parse(dataStr);
        
        switch (this.currentEvent) {
          case 'init':
            callbacks.onInit?.(data);
            break;
          case 'token':
            callbacks.onToken?.(data);
            break;
          case 'tool':
            callbacks.onTool?.(data);
            break;
          case 'tool_result':
            callbacks.onToolResult?.(data);
            break;
          case 'heartbeat':
            callbacks.onHeartbeat?.(data);
            break;
          case 'error':
            callbacks.onError?.(data);
            reject(new Error(data.error));
            break;
          case 'done':
            callbacks.onDone?.(data);
            resolve(data.messageId);
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE data:', dataStr, err);
      }
    }
  }

  private currentEvent: string = '';

  /**
   * 取消当前请求
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}
```

#### 9.1.2 使用示例

```typescript
// 创建客户端实例
const client = new AgentSSEClient();

// 发送邮件并监听事件
try {
  const messageId = await client.sendEmail(
    {
      to: "yang.fourier@gmail.com",
      recipient: "百度",
      intent: "在邮件中推广宣传AI招聘应用 lovtalent.com",
      language: "zh-CN",
      site: "lovtalent.com"
    },
    {
      onInit: (data) => {
        console.log('Session started:', data.sessionId);
        console.log('Using model:', data.model);
      },
      onToken: (data) => {
        console.log('Claude output:', data.content);
        // 实时显示 Claude 的思考过程
        appendToUI(data.content);
      },
      onTool: (data) => {
        console.log('Tool called:', data.name, data.arguments);
        showToolCall(data.name, data.arguments);
      },
      onToolResult: (data) => {
        console.log('Tool result:', data.name, data.result);
        showToolResult(data.name, data.result);
      },
      onHeartbeat: (data) => {
        console.log('Heartbeat:', data.timestamp);
        updateConnectionStatus('connected');
      },
      onError: (data) => {
        console.error('Error:', data.error);
        showError(data.error);
      },
      onDone: (data) => {
        console.log('Email sent successfully:', data.messageId);
        showSuccess(`邮件发送成功！Message ID: ${data.messageId}`);
      }
    }
  );
  
  console.log('Final message ID:', messageId);
} catch (error) {
  console.error('Failed to send email:', error);
  showError(error.message);
}
```

### 9.2 React Hook 实现

```typescript
import { useState, useCallback, useRef } from 'react';

interface UseAgentSSEOptions {
  onInit?: (data: SSEEventData['init']) => void;
  onToken?: (data: SSEEventData['token']) => void;
  onTool?: (data: SSEEventData['tool']) => void;
  onToolResult?: (data: SSEEventData['tool_result']) => void;
  onHeartbeat?: (data: SSEEventData['heartbeat']) => void;
  onError?: (data: SSEEventData['error']) => void;
  onDone?: (data: SSEEventData['done']) => void;
}

export const useAgentSSE = (options: UseAgentSSEOptions = {}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{
    type: string;
    data: any;
    timestamp: string;
  }>>([]);
  
  const clientRef = useRef<AgentSSEClient | null>(null);

  const sendEmail = useCallback(async (requestData: {
    to: string;
    recipient: string;
    intent: string;
    language?: string;
    site?: string;
  }) => {
    setIsLoading(true);
    setError(null);
    setMessageId(null);
    setLogs([]);

    try {
      clientRef.current = new AgentSSEClient();
      
      const result = await clientRef.current.sendEmail(requestData, {
        onInit: (data) => {
          setLogs(prev => [...prev, { type: 'init', data, timestamp: data.timestamp }]);
          options.onInit?.(data);
        },
        onToken: (data) => {
          setLogs(prev => [...prev, { type: 'token', data, timestamp: data.timestamp }]);
          options.onToken?.(data);
        },
        onTool: (data) => {
          setLogs(prev => [...prev, { type: 'tool', data, timestamp: data.timestamp }]);
          options.onTool?.(data);
        },
        onToolResult: (data) => {
          setLogs(prev => [...prev, { type: 'tool_result', data, timestamp: data.timestamp }]);
          options.onToolResult?.(data);
        },
        onHeartbeat: (data) => {
          options.onHeartbeat?.(data);
        },
        onError: (data) => {
          setLogs(prev => [...prev, { type: 'error', data, timestamp: data.timestamp }]);
          setError(data.error);
          options.onError?.(data);
        },
        onDone: (data) => {
          setLogs(prev => [...prev, { type: 'done', data, timestamp: data.timestamp }]);
          setMessageId(data.messageId);
          options.onDone?.(data);
        }
      });

      setMessageId(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  const cancel = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.cancel();
    }
    setIsLoading(false);
  }, []);

  return {
    sendEmail,
    cancel,
    isLoading,
    error,
    messageId,
    logs
  };
};
```

#### React 组件使用示例

```tsx
import React, { useState } from 'react';
import { useAgentSSE } from './useAgentSSE';

const EmailSender: React.FC = () => {
  const [formData, setFormData] = useState({
    to: 'yang.fourier@gmail.com',
    recipient: '百度',
    intent: '在邮件中推广宣传AI招聘应用 lovtalent.com',
    language: 'zh-CN',
    site: 'lovtalent.com'
  });

  const { sendEmail, cancel, isLoading, error, messageId, logs } = useAgentSSE({
    onToken: (data) => {
      console.log('Real-time output:', data.content);
    },
    onDone: (data) => {
      console.log('Email sent successfully!');
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendEmail(formData);
  };

  return (
    <div className="email-sender">
      <form onSubmit={handleSubmit}>
        <div>
          <label>收件人邮箱:</label>
          <input
            type="email"
            value={formData.to}
            onChange={(e) => setFormData(prev => ({ ...prev, to: e.target.value }))}
            required
          />
        </div>
        <div>
          <label>收件人名称:</label>
          <input
            type="text"
            value={formData.recipient}
            onChange={(e) => setFormData(prev => ({ ...prev, recipient: e.target.value }))}
            required
          />
        </div>
        <div>
          <label>邮件意图:</label>
          <textarea
            value={formData.intent}
            onChange={(e) => setFormData(prev => ({ ...prev, intent: e.target.value }))}
            required
          />
        </div>
        
        <div className="actions">
          <button type="submit" disabled={isLoading}>
            {isLoading ? '发送中...' : '发送邮件'}
          </button>
          {isLoading && (
            <button type="button" onClick={cancel}>
              取消
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="error">
          错误: {error}
        </div>
      )}

      {messageId && (
        <div className="success">
          邮件发送成功！Message ID: {messageId}
        </div>
      )}

      <div className="logs">
        <h3>实时日志</h3>
        {logs.map((log, index) => (
          <div key={index} className={`log-entry log-${log.type}`}>
            <span className="timestamp">{log.timestamp}</span>
            <span className="type">{log.type}</span>
            <pre>{JSON.stringify(log.data, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EmailSender;
```

### 9.3 错误处理最佳实践

#### 9.3.1 网络错误处理

```typescript
class RobustAgentSSEClient extends AgentSSEClient {
  private maxRetries = 3;
  private retryDelay = 1000;

  async sendEmailWithRetry(requestData: any, callbacks: any): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.sendEmail(requestData, {
          ...callbacks,
          onError: (data) => {
            console.warn(`Attempt ${attempt} failed:`, data.error);
            callbacks.onError?.(data);
          }
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.maxRetries) {
          console.log(`Retrying in ${this.retryDelay}ms... (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          this.retryDelay *= 2; // 指数退避
        }
      }
    }
    
    throw lastError;
  }
}
```

#### 9.3.2 连接状态监控

```typescript
class ConnectionMonitor {
  private isConnected = false;
  private lastHeartbeat: Date | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  
  onHeartbeat() {
    this.isConnected = true;
    this.lastHeartbeat = new Date();
    
    // 重置心跳超时检测
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }
    
    // 如果30秒内没有收到心跳，认为连接断开
    this.heartbeatTimeout = setTimeout(() => {
      this.isConnected = false;
      this.onConnectionLost();
    }, 30000);
  }
  
  onConnectionLost() {
    console.warn('Connection lost - no heartbeat received');
    // 触发重连逻辑
  }
  
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      lastHeartbeat: this.lastHeartbeat
    };
  }
}
```

### 9.4 性能优化建议

1. **事件处理优化**：
   ```typescript
   // 使用防抖处理高频 token 事件
   const debouncedTokenHandler = debounce((content: string) => {
     updateUI(content);
   }, 100);
   ```

2. **内存管理**：
   ```typescript
   // 限制日志条目数量
   const MAX_LOG_ENTRIES = 1000;
   setLogs(prev => {
     const newLogs = [...prev, newEntry];
     return newLogs.length > MAX_LOG_ENTRIES 
       ? newLogs.slice(-MAX_LOG_ENTRIES) 
       : newLogs;
   });
   ```

3. **取消机制**：
   ```typescript
   // 组件卸载时取消请求
   useEffect(() => {
     return () => {
       client.cancel();
     };
   }, []);
   ```
