import { describe, it, expect } from 'vitest';
import { getEnv } from '../src/config/env';

function withEnv<T>(vals: Record<string, string>, fn: () => T): T {
  const backup = { ...process.env };
  Object.assign(process.env, vals);
  try {
    return fn();
  } finally {
    process.env = backup;
  }
}

describe('env config', () => {
  it('parses valid env and transforms types', () => {
    const env = withEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
      CLAUDE_MODEL: 'sonnet',
    }, getEnv);
    expect(env.SMTP_HOST).toBe('smtp.example.com');
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('fails when missing required SMTP_HOST', () => {
    expect(() => withEnv({
      SMTP_HOST: '',
      SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p', CLAUDE_MODEL: 'haiku'
    }, getEnv)).toThrow(/Environment validation failed/i);
  });

  it('fails with invalid SMTP_PORT', () => {
    expect(() => withEnv({
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'abc', SMTP_USER: 'u', SMTP_PASS: 'p', CLAUDE_MODEL: 'opus'
    }, getEnv)).toThrow(/SMTP_PORT/i);
  });

  it('accepts optional CLAUDE_API_BASE_URL when provided', () => {
    const env = withEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
      CLAUDE_MODEL: 'sonnet',
      CLAUDE_API_BASE_URL: 'https://api.anthropic.com',
    }, getEnv);
    expect(env.CLAUDE_API_BASE_URL).toBe('https://api.anthropic.com');
  });
});