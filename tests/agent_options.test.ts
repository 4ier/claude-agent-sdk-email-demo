import { describe, it, expect } from 'vitest';
import { createAgentOptions } from '../src/agent/options';

function withEnv<T>(vals: Record<string, string>, fn: () => T): T {
  const backup = { ...process.env };
  Object.assign(process.env, vals);
  try {
    return fn();
  } finally {
    process.env = backup;
  }
}

describe('createAgentOptions', () => {
  it('returns options with MCP server and system prompt preset', () => {
    const opts = withEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
      CLAUDE_MODEL: 'sonnet',
      CLAUDE_API_BASE_URL: 'https://api.anthropic.com',
    }, () => createAgentOptions({
      cwd: process.cwd(),
      model: 'sonnet',
      sessionId: 'test-session',
    }));
    expect(opts.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(opts.cwd).toBe(process.cwd());
    expect(opts.mcpServers).toBeDefined();
    expect((opts as any).envDict).toBeDefined();
    expect((opts as any).envDict.ANTHROPIC_API_URL).toBe('https://api.anthropic.com');
  });
});