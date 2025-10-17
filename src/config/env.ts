import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.string().transform((v) => Number(v)).refine((n) => Number.isFinite(n) && n > 0, { message: 'Invalid SMTP_PORT' }),
  SMTP_SECURE: z.string().optional().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  // Accept any non-empty string to allow latest model IDs (e.g., claude-sonnet-4-5-YYYYMMDD)
  CLAUDE_MODEL: z.string().min(1).default('sonnet'),
  // Optional base URL for model API (e.g., Anthropic proxy/base)
  // Prefer ANTHROPIC_BASE_URL; CLAUDE_API_BASE_URL remains for backward compatibility
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  CLAUDE_API_BASE_URL: z.string().url().optional(),
  AGENT_SESSION_ID: z.string().optional(),
  // Optional search configuration
  SEARCH_PROVIDER: z.enum(['bing', 'duckduckgo', 'wikipedia']).optional(),
  BING_SEARCH_API_KEY: z.string().optional(),
  // Optional: enable starting a long-lived Agent session on boot
  ENABLE_PERSISTENT_AGENT: z.string().optional().default('false').transform((v) => v === 'true'),
});

export type AppEnv = z.infer<typeof envSchema> & { SMTP_PORT: number; SMTP_SECURE: boolean };

export function getEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Environment validation failed: ${msg}`);
  }
  return parsed.data as AppEnv;
}