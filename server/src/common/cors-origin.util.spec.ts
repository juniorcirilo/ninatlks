import { webOrigin } from './cors-origin.util';
import { isWebhookVerificationDisabled } from './webhook-security.util';

describe('hardening de produção', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('CORS: sem WEB_ORIGIN fica fechado em produção e aberto em dev', () => {
    delete process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(webOrigin()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(webOrigin()).toBe(true);
  });

  it('CORS: WEB_ORIGIN explícita vale em qualquer ambiente', () => {
    process.env.WEB_ORIGIN = 'https://app.exemplo.com';
    process.env.NODE_ENV = 'production';
    expect(webOrigin()).toBe('https://app.exemplo.com');
  });

  it('WEBHOOK_VERIFY_DISABLED é ignorada em produção', () => {
    process.env.WEBHOOK_VERIFY_DISABLED = '1';
    process.env.NODE_ENV = 'production';
    expect(isWebhookVerificationDisabled()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(isWebhookVerificationDisabled()).toBe(true);
  });
});
