/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { vi } from 'vitest';

const RedisCtor = vi.fn();
const warn = vi.fn();

vi.mock('@upstash/redis', () => ({ Redis: RedisCtor }));
vi.mock('lib/config', () => ({
  config: {
    USE_CACHE: 'true',
    REDIS_URL: 'rediss://default:tcp-token@db-1234.upstash.io:6379',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: ''
  }
}));
vi.mock('lib/logger', () => ({ default: { debug: vi.fn(), warn, error: vi.fn() } }));

describe('cache with only REDIS_URL configured', () => {
  it('falls back to the file cache and warns once', async () => {
    vi.resetModules();
    const cache = await import('../cache');
    await cache.cacheGet('poll-list');
    await cache.cacheGet('poll-list');
    expect(RedisCtor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('UPSTASH_REDIS_REST_URL');
  });
});
