import { createHmac, randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { parseSigningSecret, signWebhook, verifyWebhook } from '../src/signature.js';
import { webhookFromEnv } from '../src/webhook.js';

const secretBytes = randomBytes(32);
const secret = `whsec_${secretBytes.toString('base64')}`;
const id = '0b6a6c3e-4f7e-4a8c-9a51-2f5c1d0e9b11';
const timestamp = 1_763_467_200;
const body = JSON.stringify({ id, type: 'request.approved', createdAt: '2026-11-18T12:00:00.000Z', payload: { decision: 'approved' } });

describe('signWebhook', () => {
  it('matches the Standard Webhooks test vector', () => {
    // From the specification's reference implementations (standardwebhooks.com).
    expect(signWebhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}')).toBe(
      'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    );
  });

  it('is v1, then the base64 HMAC-SHA256 of "id.timestamp.body" keyed with the decoded secret', () => {
    const expected = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64');
    expect(signWebhook(secret, id, timestamp, body)).toBe(`v1,${expected}`);
  });
});

describe('verifyWebhook', () => {
  const now = timestamp * 1_000;
  const headers = (signature = signWebhook(secret, id, timestamp, body), ts = String(timestamp)) => ({
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': signature,
  });

  it('accepts a delivery signed with the secret', () => {
    expect(verifyWebhook(secret, headers(), body, { now })).toBe(true);
  });

  it('accepts any one matching signature of several (a secret being rotated)', () => {
    const other = signWebhook(`whsec_${randomBytes(32).toString('base64')}`, id, timestamp, body);
    expect(verifyWebhook(secret, headers(`${other} ${signWebhook(secret, id, timestamp, body)}`), body, { now })).toBe(true);
  });

  it('rejects a changed body, id or timestamp, another secret and missing headers', () => {
    expect(verifyWebhook(secret, headers(), body.replace('approved', 'rejected'), { now })).toBe(false);
    expect(verifyWebhook(secret, { ...headers(), 'webhook-id': 'another-id' }, body, { now })).toBe(false);
    expect(verifyWebhook(secret, headers(undefined, String(timestamp + 1)), body, { now })).toBe(false);
    expect(verifyWebhook(`whsec_${randomBytes(32).toString('base64')}`, headers(), body, { now })).toBe(false);
    expect(verifyWebhook(secret, { 'webhook-id': id, 'webhook-timestamp': String(timestamp) }, body, { now })).toBe(false);
    expect(verifyWebhook(secret, headers('v1,not-a-signature'), body, { now })).toBe(false);
  });

  // Number() reads "1763467200.0", " 1763467200" or "0x..." as the same instant, so a signature over the number
  // passed for a header the sender never sent. Only plain digits are a timestamp.
  it.each([`${timestamp}.0`, ` ${timestamp}`, `${timestamp} `, `0x${timestamp.toString(16)}`, `+${timestamp}`, `${timestamp}e0`, ''])(
    'rejects the timestamp header %j, even with a signature over its numeric value',
    (ts) => {
      expect(verifyWebhook(secret, headers(signWebhook(secret, id, timestamp, body), ts), body, { now })).toBe(false);
    },
  );

  it('checks the signature over the timestamp header exactly as sent', () => {
    const padded = `0${timestamp}`;
    const overRaw = `v1,${createHmac('sha256', secretBytes).update(`${id}.${padded}.${body}`).digest('base64')}`;
    expect(verifyWebhook(secret, headers(overRaw, padded), body, { now })).toBe(true);
    expect(verifyWebhook(secret, headers(signWebhook(secret, id, timestamp, body), padded), body, { now })).toBe(false);
  });

  it('rejects a timestamp more than five minutes away, so a captured delivery cannot be replayed later', () => {
    expect(verifyWebhook(secret, headers(), body, { now: now + 301_000 })).toBe(false);
    expect(verifyWebhook(secret, headers(), body, { now: now - 301_000 })).toBe(false);
    expect(verifyWebhook(secret, headers(), body, { now: now + 299_000 })).toBe(true);
  });
});

describe('parseSigningSecret', () => {
  it('decodes the part after whsec_', () => {
    expect(parseSigningSecret(secret)).toEqual(secretBytes);
  });

  it.each([
    ['no prefix', secretBytes.toString('base64')],
    ['not base64', 'whsec_not base64!'],
    ['too short', `whsec_${randomBytes(16).toString('base64')}`],
    ['empty', 'whsec_'],
  ])('rejects a secret with %s', (_case, value) => {
    expect(() => parseSigningSecret(value)).toThrow(/WEBHOOK_SIGNING_SECRET/);
  });

  it('never puts the secret in the error message', () => {
    const value = `whsec_${randomBytes(8).toString('base64')}`;
    expect(() => parseSigningSecret(value)).toThrow(expect.objectContaining({ message: expect.not.stringContaining(value.slice(6)) }));
  });
});

describe('webhookFromEnv', () => {
  function capture() {
    const lines: Record<string, unknown>[] = [];
    return { lines, logger: pino({}, { write: (line: string) => lines.push(JSON.parse(line)) }) };
  }
  const url = 'https://erp.example.com/webhooks/approvals';

  it('signs with the secret when both are set', () => {
    const { lines, logger } = capture();
    expect(webhookFromEnv({ NOTIFY_WEBHOOK_URL: url, WEBHOOK_SIGNING_SECRET: secret }, logger)).toEqual({ url, secret: secretBytes });
    expect(lines).toEqual([]);
  });

  it('sends unsigned, with a warning, when there is a URL but no secret', () => {
    const { lines, logger } = capture();
    expect(webhookFromEnv({ NOTIFY_WEBHOOK_URL: url }, logger)).toEqual({ url });
    expect(lines).toEqual([expect.objectContaining({ level: 40, msg: expect.stringMatching(/unsigned/) })]);
  });

  it('has no webhook without a URL', () => {
    expect(webhookFromEnv({ WEBHOOK_SIGNING_SECRET: secret }, capture().logger)).toBeUndefined();
  });

  it('refuses a malformed secret, even before a URL is set', () => {
    expect(() => webhookFromEnv({ NOTIFY_WEBHOOK_URL: url, WEBHOOK_SIGNING_SECRET: 'hunter2' }, capture().logger)).toThrow(/WEBHOOK_SIGNING_SECRET/);
    expect(() => webhookFromEnv({ WEBHOOK_SIGNING_SECRET: 'hunter2' }, capture().logger)).toThrow(/WEBHOOK_SIGNING_SECRET/);
  });
});
