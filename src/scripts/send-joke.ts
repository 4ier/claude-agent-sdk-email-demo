import { query } from '@anthropic-ai/claude-agent-sdk';
import { getEnv } from '../config/env';
import { createAgentOptions } from '../agent/options';

async function main() {
  const env = getEnv();
  const to = process.argv[2] || process.env.SEND_TO || '771040330@qq.com';
  const subject = 'Agent Joke Test';
  const text = '程序员冷笑话：为什么开发者总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。';

  const prompt = [
    'Use the tool `smtp_send` to send exactly one email.',
    `to: ${to}`,
    `subject: ${subject}`,
    `text: ${text}`,
    'Do not ask for confirmation. After sending, reply with "done".',
  ].join('\n');

  const options = createAgentOptions({
    cwd: process.cwd(),
    model: env.CLAUDE_MODEL,
    sessionId: env.AGENT_SESSION_ID,
  });

  const q = query({ prompt, options });
  for await (const msg of q) {
    if ((msg as any).type === 'message') {
      const content = (msg as any).content ?? [];
      console.log('Agent message:', JSON.stringify(content));
    }
  }
}

main().catch((err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('send-joke failed:', e.message);
  process.exit(1);
});