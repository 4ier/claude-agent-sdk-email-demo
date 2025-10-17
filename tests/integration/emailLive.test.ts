import { describe, it, expect } from 'vitest';
import { EmailService } from '../../src/services/emailService';

const LIVE = process.env.LIVE_EMAIL_TEST === 'true';

(LIVE ? describe : describe.skip)('EmailService Live SMTP', () => {
  it('sends a real text email via configured SMTP', async () => {
    const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
    const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
    const service = new EmailService({
      host: String(process.env.SMTP_HOST),
      port,
      secure,
      auth: {
        user: String(process.env.SMTP_USER),
        pass: String(process.env.SMTP_PASS),
      },
    });

    const to = String(process.env.LIVE_EMAIL_TO || process.env.SMTP_USER);
    const res = await service.send({
      to,
      subject: 'Live Test: Jokes (Text)',
      text: '程序员笑话：\n1) 我不是懒，我只是避免不必要的计算。\n2) 世界上有10种人：懂二进制的，和不懂的。',
    });
    expect(res.messageId).toBeDefined();
  }, 30000);

  it('sends a real HTML email via configured SMTP', async () => {
    const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
    const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
    const service = new EmailService({
      host: String(process.env.SMTP_HOST),
      port,
      secure,
      auth: {
        user: String(process.env.SMTP_USER),
        pass: String(process.env.SMTP_PASS),
      },
    });

    const to = String(process.env.LIVE_EMAIL_TO || process.env.SMTP_USER);
    const res = await service.send({
      to,
      subject: 'Live Test: Jokes (HTML)',
      html: '<div style="font-family: system-ui; line-height:1.6"><h3>程序员冷笑话</h3><ol><li>为什么开发者总是分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。</li><li>我不迷信，我只相信测试。</li></ol><p>祝你今天也写出优雅的代码！</p></div>',
    });
    expect(res.messageId).toBeDefined();
  }, 30000);
});