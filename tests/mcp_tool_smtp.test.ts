import { describe, it, expect, vi } from 'vitest';
import { smtpInputSchema, smtpHandler } from '../src/mcp/smtpTool';

describe('smtpHandler', () => {
  const mockService = { send: vi.fn() } as any;
  const handler = smtpHandler(mockService);

  it('validates input schema', async () => {
    const parsed = smtpInputSchema.safeParse({ to: 'a@b.com', subject: 'S', text: 'T' });
    expect(parsed.success).toBe(true);

    const invalid = smtpInputSchema.safeParse({ to: '', subject: 'S', text: 'T' });
    expect(invalid.success).toBe(false);
  });

  it('calls EmailService and returns success payload', async () => {
    mockService.send.mockResolvedValue({ messageId: 'x-1' });
    const res = await handler({ to: 'a@b.com', subject: 'S', text: 'T' }, {});
    expect(mockService.send).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, messageId: 'x-1' });
  });

  it('propagates failures as error payload', async () => {
    mockService.send.mockRejectedValue(new Error('smtp failure'));
    const res = await handler({ to: 'a@b.com', subject: 'S', text: 'T' }, {});
    expect(res).toMatchObject({ ok: false });
    expect(String(res.error)).toMatch(/smtp failure/);
  });

  it('supports HTML-only sending via tool', async () => {
    mockService.send.mockResolvedValue({ messageId: 'html-2' });
    const res = await handler({ to: 'a@b.com', subject: 'H', html: '<p>Hi</p>' }, {});
    expect(res).toMatchObject({ ok: true, messageId: 'html-2' });
  });

  it('rejects missing subject by schema', async () => {
    const parsed = smtpInputSchema.safeParse({ to: 'a@b.com', text: 'T' });
    expect(parsed.success).toBe(false);
  });
});