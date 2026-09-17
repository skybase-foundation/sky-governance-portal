/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { resolveUpstashCredentials } from '../upstashCredentials';

describe('resolveUpstashCredentials', () => {
  it('prefers explicit REST credentials', () => {
    expect(
      resolveUpstashCredentials({
        restUrl: 'https://db.upstash.io',
        restToken: 'rest-token',
        redisUrl: 'rediss://default:tcp-token@db.upstash.io:6379'
      })
    ).toEqual({ url: 'https://db.upstash.io', token: 'rest-token' });
  });

  it('derives the REST endpoint from an Upstash TCP URL', () => {
    expect(
      resolveUpstashCredentials({ redisUrl: 'rediss://default:tcp-token@db-1234.upstash.io:6379' })
    ).toEqual({
      url: 'https://db-1234.upstash.io',
      token: 'tcp-token'
    });
    expect(resolveUpstashCredentials({ redisUrl: 'redis://:t%2Fx@db.upstash.io:6379' })).toEqual({
      url: 'https://db.upstash.io',
      token: 't/x'
    });
  });

  it('returns null when nothing usable is configured', () => {
    expect(resolveUpstashCredentials({})).toBeNull();
    expect(resolveUpstashCredentials({ restUrl: 'https://db.upstash.io' })).toBeNull();
    expect(
      resolveUpstashCredentials({ redisUrl: 'rediss://default:token@redis.example.com:6379' })
    ).toBeNull();
    expect(resolveUpstashCredentials({ redisUrl: 'rediss://db.upstash.io:6379' })).toBeNull();
    expect(resolveUpstashCredentials({ redisUrl: 'not a url' })).toBeNull();
  });
});
