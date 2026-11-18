import { describe, expect, it } from 'vitest';
import { trustProxy } from '../src/config.js';

describe('trustProxy (TRUST_PROXY)', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    // Vercel's serverless handler passes true itself; a long-running server behind a replacing proxy may too.
    ['true', true],
    ['uniquelocal', 'uniquelocal'],
    ['10.0.0.5', '10.0.0.5'],
    ['172.16.0.0/12, loopback', '172.16.0.0/12,loopback'],
    ['fd00::/8', 'fd00::/8'],
  ])('reads %j as %j', (value, expected) => {
    expect(trustProxy(value)).toBe(expected);
  });

  // A typo must stop the server, not quietly trust every forwarded header, or none. A hop count looks right but
  // Fastify 5.12 ignores it, so every client behind the proxy would share the proxy's IP (and its login limit).
  it.each(['1', '0', 'yes', 'TRUE', '10.0.0.0/33', '10.0.0', 'uniquelocal,', 'example.com'])('refuses %j', (value) => {
    expect(() => trustProxy(value)).toThrow(/TRUST_PROXY/);
  });
});
