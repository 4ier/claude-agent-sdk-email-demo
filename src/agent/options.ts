import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { EmailService } from '../services/emailService';
import { createSmtpTool } from '../mcp/smtpTool';
import { SearchService } from '../services/searchService';
import { createSearchTool } from '../mcp/searchTool';
import { getEnv } from '../config/env';

type Model = string;
type OptionsWithEnv = Options & { envDict?: Record<string, string> };

export function createAgentOptions(params: {
  cwd: string;
  model: Model;
  sessionId?: string;
}): Options {
  const env = getEnv();
  const envDict: Record<string, string> = { ...process.env } as Record<string, string>;
  const baseUrl = env.ANTHROPIC_BASE_URL || env.CLAUDE_API_BASE_URL;
  if (baseUrl) {
    // Map to common SDK/CLI environment keys for base URL override
    envDict['ANTHROPIC_API_URL'] = baseUrl;
    envDict['ANTHROPIC_BASE_URL'] = baseUrl;
  }
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

  const mcpTools = createSdkMcpServer({
    name: 'local-tools',
    version: '1.1.0',
    tools: [
      createSmtpTool(emailService),
      createSearchTool(searchService),
    ],
  });

  const options: OptionsWithEnv = {
    cwd: params.cwd,
    model: params.model,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Persistent agent with SMTP tool' },
    includePartialMessages: false,
    // Auto-approve MCP tool uses to avoid interactive permission prompts in server mode
    permissionMode: 'bypassPermissions',
    // Explicitly allow local MCP tools by name to be safe across modes
    allowedTools: [
      'smtp_send',
      'web_search',
      'mcp__local-tools__smtp_send',
      'mcp__local-tools__web_search',
    ],
    strictMcpConfig: false,
    mcpServers: { 'local-tools': mcpTools },
    resume: params.sessionId ?? env.AGENT_SESSION_ID,
    envDict,
  };
  return options;
}