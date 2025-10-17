import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer with placeholder fns (hoisted-safe)
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn() },
  createTransport: vi.fn(),
}));

import nodemailer from 'nodemailer';
import type { EmailConfig } from '../src/services/emailService';
import { EmailService } from '../src/services/emailService';

describe('EmailService', () => {
  const config: EmailConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user@example.com', pass: 'secret' },
  };

  let sendMailMock: ReturnType<typeof vi.fn>;
  let createTransportMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendMailMock = vi.fn();
    createTransportMock = (nodemailer as any).createTransport as any;
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  });

  it('sends a text email with valid inputs', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc-123' });
    const service = new EmailService(config);
    const result = await service.send({ to: 'to@example.com', subject: 'Hello', text: 'Hi there' });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'user@example.com',
      to: 'to@example.com',
      subject: 'Hello',
      text: 'Hi there',
      html: undefined,
    });
    expect(result.messageId).toBe('abc-123');
  });

  it('requires at least text or html content', async () => {
    const service = new EmailService(config);
    await expect(service.send({ to: 'to@example.com', subject: 'Subj' } as any)).rejects.toThrow(/content/i);
  });

  it('validates recipient email', async () => {
    const service = new EmailService(config);
    await expect(service.send({ to: '', subject: 'Subj', text: 'Body' } as any)).rejects.toThrow(/recipient/i);
  });

  it('sends an email with only HTML content', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'html-1' });
    const service = new EmailService(config);
    const result = await service.send({ to: 'to@example.com', subject: 'Hello', html: '<b>Hi</b>' });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'user@example.com',
      to: 'to@example.com',
      subject: 'Hello',
      text: undefined,
      html: '<b>Hi</b>',
    });
    expect(result.messageId).toBe('html-1');
  });

  it('passes secure=true to transporter for SSL port 465', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'ssl-465' });
    const service = new EmailService({ ...config, secure: true, port: 465 });
    await expect(service.send({ to: 'to@example.com', subject: 'S', text: 'T' })).resolves.toMatchObject({ messageId: 'ssl-465' });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
  });

  it('bubbles up nodemailer errors', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP send failure'));
    const service = new EmailService(config);
    await expect(service.send({ to: 'to@example.com', subject: 'S', text: 'T' })).rejects.toThrow(/SMTP send failure/);
  });
});