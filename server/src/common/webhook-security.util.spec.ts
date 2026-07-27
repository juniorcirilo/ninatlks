import { createHmac } from 'node:crypto';
import {
  validateMetaSignature,
  validateTwilioSignature,
} from './webhook-security.util';

describe('validateTwilioSignature', () => {
  const authToken = 'test-auth-token';
  const url = 'https://example.com/webhooks/twilio/incoming';
  const form = { CallSid: 'CA123', From: '+15551234567', To: '+15557654321' };

  function sign(u: string, f: Record<string, string>, token: string): string {
    const entries = Object.entries(f).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    let payload = u;
    for (const [k, v] of entries) payload += k + v;
    return createHmac('sha1', token).update(payload).digest('base64');
  }

  it('accepts a correctly signed request', () => {
    const signature = sign(url, form, authToken);
    expect(validateTwilioSignature({ url, form, signature, authToken })).toBe(
      true,
    );
  });

  it('rejects a tampered form field', () => {
    const signature = sign(url, form, authToken);
    const tampered = { ...form, From: '+10000000000' };
    expect(
      validateTwilioSignature({ url, form: tampered, signature, authToken }),
    ).toBe(false);
  });

  it('rejects a wrong auth token', () => {
    const signature = sign(url, form, authToken);
    expect(
      validateTwilioSignature({
        url,
        form,
        signature,
        authToken: 'wrong-token',
      }),
    ).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(
      validateTwilioSignature({ url, form, signature: null, authToken }),
    ).toBe(false);
  });
});

describe('validateMetaSignature', () => {
  const appSecret = 'meta-app-secret';
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: '123' }] }));

  function sign(body: Buffer, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  it('accepts a correctly signed request', () => {
    const header = sign(rawBody, appSecret);
    expect(validateMetaSignature({ rawBody, header, appSecret })).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = sign(rawBody, appSecret);
    const tampered = Buffer.from(JSON.stringify({ entry: [{ id: '456' }] }));
    expect(
      validateMetaSignature({ rawBody: tampered, header, appSecret }),
    ).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(
      validateMetaSignature({ rawBody, header: 'not-a-signature', appSecret }),
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(validateMetaSignature({ rawBody, header: null, appSecret })).toBe(
      false,
    );
  });
});
