import { getEnv } from '../config/env';
import { EmailService } from '../services/emailService';

async function main() {
  const env = getEnv();
  const to = process.argv[2] || process.env.SEND_TO || '771040330@qq.com';

  const service = new EmailService({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  const subject = '程序员笑话测试';
  const text = '程序员冷笑话：为什么开发者总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。';

  const res = await service.send({ to, subject, text });
  console.log('Sent ok:', res.messageId);
}

main().catch((err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('send-via-service failed:', e.message);
  process.exit(1);
});