/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { vi, Mock } from 'vitest';
import logger from 'lib/logger';

const client = {
  get: vi.fn(),
  hget: vi.fn(),
  set: vi.fn(),
  hset: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  del: vi.fn(),
  scan: vi.fn()
};
const RedisCtor = vi.fn(() => client);

vi.mock('@upstash/redis', () => ({ Redis: RedisCtor }));
vi.mock('lib/config', () => ({
  config: {
    USE_CACHE: 'true',
    NODE_ENV: 'test',
    REDIS_URL: '',
    UPSTASH_REDIS_REST_URL: 'https://db-1234.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'rest-token'
  }
}));
vi.mock('lib/logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('cache over Upstash HTTP', () => {
  let cache: typeof import('../cache');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.NEXT_PHASE;
    cache = await import('../cache');
  });

  it('builds a fail-fast client from the REST credentials with raw string values', async () => {
    client.get.mockResolvedValue('cached');
    await cache.cacheGet('poll-list');
    expect(RedisCtor).toHaveBeenCalledTimes(1);
    const options = (RedisCtor as Mock).mock.calls[0][0];
    expect(options).toMatchObject({
      url: 'https://db-1234.upstash.io',
      token: 'rest-token',
      automaticDeserialization: false,
      retry: false
    });
    expect(options.signal()).toBeInstanceOf(AbortSignal);
  });

  it('reads with GET and HGET', async () => {
    client.get.mockResolvedValue('value');
    client.hget.mockResolvedValue('field-value');
    expect(await cache.cacheGet('poll-list')).toBe('value');
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('-mainnet-poll-list'));
    expect(await cache.cacheGet('poll-list', undefined, undefined, 'HGET', 'f')).toBe('field-value');
    expect(client.hget).toHaveBeenCalledWith(expect.stringContaining('-mainnet-poll-list'), 'f');
  });

  it('returns null when a read fails', async () => {
    client.get.mockRejectedValue(new Error('fetch failed'));
    expect(await cache.cacheGet('poll-list')).toBeNull();
  });

  it('writes with a TTL and expires hashes', async () => {
    client.set.mockResolvedValue('OK');
    client.hset.mockResolvedValue(1);
    client.expire.mockResolvedValue(1);
    cache.cacheSet('poll-list', 'value', undefined, 60_000);
    expect(client.set).toHaveBeenCalledWith(expect.stringContaining('-mainnet-poll-list'), 'value', {
      ex: 60
    });
    cache.cacheSet('poll-list', 'value', undefined, 60_000, 'HSET', 'f');
    await flush();
    expect(client.hset).toHaveBeenCalledWith(expect.stringContaining('-mainnet-poll-list'), { f: 'value' });
    expect(client.expire).toHaveBeenCalledWith(expect.stringContaining('-mainnet-poll-list'), 60);
  });

  it('logs a failed write instead of letting it reject unhandled', async () => {
    client.set.mockRejectedValueOnce(new Error('request timed out'));
    client.hset.mockRejectedValueOnce(new Error('request timed out'));
    client.del.mockRejectedValueOnce(new Error('request timed out'));
    cache.cacheSet('poll-list', 'value');
    cache.cacheSet('poll-list', 'value', undefined, 60_000, 'HSET', 'f');
    cache.cacheDel('poll-list', 'mainnet' as any);
    await flush();
    const logged = (logger.error as Mock).mock.calls.map(call => String(call[0]));
    expect(logged).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Redis set failed for'),
        expect.stringContaining('Redis hset failed for'),
        expect.stringContaining('Redis del failed for')
      ])
    );
    expect(logged.every(line => line.includes('request timed out'))).toBe(true);
  });

  it('claims the rate-limit slot atomically with SET NX EX', async () => {
    client.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    expect(await cache.cacheSetNX('rate', '1', undefined, 600_000)).toBe(true);
    expect(client.set).toHaveBeenCalledWith(expect.stringContaining('-mainnet-rate'), '1', {
      ex: 600,
      nx: true
    });
    expect(await cache.cacheSetNX('rate', '1', undefined, 600_000)).toBe(false);
  });

  it('deletes every proposals key by scanning', async () => {
    client.scan.mockResolvedValueOnce(['7', ['a', 'b']]).mockResolvedValueOnce(['0', ['c']]);
    client.del.mockResolvedValue(1);
    cache.cacheDel('proposals', 'mainnet' as any);
    await flush();
    const pattern = expect.stringMatching(/sky-gov-portal-version-[^/]+-test-mainnet-proposals\*$/);
    expect(client.scan).toHaveBeenCalledWith('0', { match: pattern, count: 100 });
    expect(client.scan).toHaveBeenCalledWith('7', { match: pattern, count: 100 });
    expect(client.del).toHaveBeenCalledWith('a', 'b');
    expect(client.del).toHaveBeenCalledWith('c');
  });

  it('namespaces keys by environment', async () => {
    client.get.mockResolvedValue(null);
    await cache.cacheGet('poll-list');
    expect(client.get).toHaveBeenCalledWith(
      expect.stringMatching(/sky-gov-portal-version-[^/]+-test-mainnet-poll-list/)
    );
  });

  it('never creates a client during next build', async () => {
    vi.resetModules();
    process.env.NEXT_PHASE = 'phase-production-build';
    cache = await import('../cache');
    await cache.cacheGet('poll-list');
    expect(RedisCtor).not.toHaveBeenCalled();
  });
});
