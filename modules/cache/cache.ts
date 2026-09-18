/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import fs from 'fs';
import os from 'os';
import { DEFAULT_NETWORK, SupportedNetworks } from 'modules/web3/constants/networks';
import { config } from 'lib/config';
import { Redis } from '@upstash/redis';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import packageJSON from '../../package.json';
import logger from 'lib/logger';
import { ONE_DAY_IN_MS, ONE_HOUR_IN_MS } from 'modules/app/constants/time';
import { executiveProposalsCacheKey } from './constants/cache-keys';

let redisClient: Redis | null | undefined;

/**
 * Upstash over HTTP: no socket to go idle and reset, no reconnect loop, and
 * every command is an independent request that either succeeds or rejects.
 * Static generation never touches it; a build must not depend on a network
 * cache, and the file cache is enough to dedupe fetches within one build.
 */
const getRedis = (): Redis | null => {
  if (redisClient !== undefined) return redisClient;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, REDIS_URL } = config;
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD || !url || !token) {
    if (REDIS_URL && !(url && token)) {
      logger.warn(
        'REDIS_URL is set but the cache needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN; using the file cache'
      );
    }
    redisClient = null;
    return redisClient;
  }
  redisClient = new Redis({
    url,
    token,
    automaticDeserialization: false,
    enableTelemetry: false,
    retry: { retries: 2, backoff: retryCount => retryCount * 200 }
  });
  return redisClient;
};

/** Cache writes are fire-and-forget; a failed write must never reject unhandled. */
const logRedisFailure = (operation: string, path: string) => (error: unknown) => {
  logger.error(`Redis ${operation} failed for ${path}: ${(error as Error).message}`);
};

// Mem cache does not work on local instances of nextjs because nextjs creates clean memory states each time.
const memoryCache = {};

function getFilePath(name: string, network: string, expiryMs?: number): string {
  const date = new Date().toISOString().substring(0, 10);

  return `${os.tmpdir()}/sky-gov-portal-version-${packageJSON.version}-${network}-${name}${
    expiryMs && expiryMs > ONE_DAY_IN_MS ? '' : '-' + date
  }`;
}

export const cacheDel = (name: string, network: SupportedNetworks, expiryMs?: number): void => {
  const path = getFilePath(name, network, expiryMs);

  const redis = getRedis();
  if (redis) {
    // if clearing proposals, we need to find all of them first
    if (name === 'proposals') {
      const deleteProposalKeys = async () => {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, { match: '*proposals*', count: 100 });

          if (keys.length > 0) {
            logger.debug('cacheDel pattern: *proposals* ', cursor, keys.length);
            await redis.del(...keys);
          }

          cursor = nextCursor;
        } while (cursor !== '0');
      };

      deleteProposalKeys().catch(logRedisFailure('del pattern', '*proposals*'));
    } else {
      // otherwise just delete the file based on path
      logger.debug('cacheDel redis: ', path);
      redis.del(path).catch(logRedisFailure('del', path));
    }
  } else {
    try {
      logger.debug('cacheDel: ', path);
      memoryCache[path] = null;
      fs.unlinkSync(path);
    } catch (e) {
      logger.error(`cacheDel: ${e.message}`);
    }
  }
};

export const getCacheInfo = async (
  name: string,
  network: SupportedNetworks,
  expiryMs?: number
): Promise<any> => {
  if (!config.USE_CACHE || config.USE_CACHE === 'false') {
    return Promise.resolve(null);
  }

  try {
    const currentNetwork = network || DEFAULT_NETWORK.network;
    const path = getFilePath(name, currentNetwork, expiryMs);

    const redis = getRedis();
    if (redis) {
      // if fetching proposals cache info, there are likely multiple keys cached due to different query params
      // we'll return the ttl for first proposals key we find
      if (name === executiveProposalsCacheKey) {
        const [, keys] = await redis.scan('0', { match: '*proposals*', count: 1 });
        if (keys.length > 0) {
          return await redis.ttl(keys[0]);
        }
      } else {
        return await redis.ttl(path);
      }
    }
  } catch (e) {
    logger.error(e);
  }
};

export const cacheGet = async (
  name: string,
  network?: SupportedNetworks,
  expiryMs?: number,
  method: 'GET' | 'HGET' = 'GET',
  field = ''
): Promise<any> => {
  if (!config.USE_CACHE || config.USE_CACHE === 'false') {
    return Promise.resolve(null);
  }

  try {
    const currentNetwork = network || DEFAULT_NETWORK.network;
    const path = getFilePath(name, currentNetwork, expiryMs);

    const redis = getRedis();
    if (redis) {
      // Get redis data if it exists
      const cachedData =
        method === 'GET' ? await redis.get<string>(path) : await redis.hget<string>(path, field);
      logger.debug(`Redis cache get for ${path}`);
      return cachedData || null;
    } else {
      // If fs does not exist as a module, return null (TODO: This shouldn't happen, consider removing this check)
      if (Object.keys(fs).length === 0) return null;
      const memCached = method === 'GET' ? memoryCache[path] : memoryCache[path]?.[field];

      if (memCached) {
        logger.debug(`mem cache hit: ${path}`);

        if (memCached.expiry && memCached.expiry < Date.now()) {
          logger.debug('mem cache expired');
          cacheDel(name, currentNetwork);
          return null;
        }

        return memCached.data;
      }

      if (fs.existsSync(path)) {
        // In nextjs serverless instances of API functions sometimes reset their in memory cache (they are different instances)
        // In order to have an expiry date we can also check the last time this file was accessed or it was created. This conditions having to pass the expiryMs on the cacheGet too
        const { birthtime } = fs.statSync(path);

        if (expiryMs && birthtime && birthtime.getTime() + expiryMs < Date.now()) {
          cacheDel(name, currentNetwork);
          return null;
        }

        logger.debug(`fs cache hit: ${path}`);
        return method === 'GET'
          ? fs.readFileSync(path).toString()
          : JSON.parse(fs.readFileSync(path).toString())[field];
      }
    }
  } catch (e) {
    logger.error(`CacheGet: Error getting cached data, ${name} - ${network}`, (e as Error).message);
    return null;
  }
};

/**
 * Atomic set-if-not-exists operation using Redis SETNX.
 * Returns true if the key was set (didn't exist), false if it already existed.
 * This is used to prevent race conditions in rate limiting.
 */
export const cacheSetNX = async (
  name: string,
  data: string,
  network?: SupportedNetworks,
  expiryMs = ONE_HOUR_IN_MS
): Promise<boolean> => {
  if (!config.USE_CACHE || config.USE_CACHE === 'false') {
    return true;
  }

  const currentNetwork = network || DEFAULT_NETWORK.network;
  const path = getFilePath(name, currentNetwork, expiryMs);

  try {
    const redis = getRedis();
    if (redis) {
      const expirySeconds = Math.round(expiryMs / 1000);
      logger.debug(`Redis cache setNX for ${path}, with TTL ${expirySeconds} seconds`);
      // SET with NX (only set if not exists) and EX (expiry in seconds)
      // Returns 'OK' if key was set, null if key already existed
      const result = await redis.set(path, data, { ex: expirySeconds, nx: true });
      return result === 'OK';
    }

    // Fall back to a non-atomic local check/set so rate limiting still works without Redis.
    const existing = await cacheGet(name, currentNetwork, expiryMs);
    if (existing) {
      const parsed = parseInt(existing, 10);
      const expired = !Number.isNaN(parsed) && Date.now() - parsed > expiryMs;
      if (!expired) {
        return false;
      }
    }

    cacheSet(name, data, currentNetwork, expiryMs);
    return true;
  } catch (e) {
    logger.error(`CacheSetNX: Error storing data in cache, ${name} - ${network}`, (e as Error).message);
    return true; // On error, allow the operation to proceed
  }
};

export const cacheSet = (
  name: string,
  data: string | { [key: number]: string },
  network?: SupportedNetworks,
  expiryMs = ONE_HOUR_IN_MS,
  method: 'SET' | 'HSET' = 'SET',
  field = ''
): void => {
  if (!config.USE_CACHE || config.USE_CACHE === 'false') {
    return;
  }

  const currentNetwork = network || DEFAULT_NETWORK.network;

  const path = getFilePath(name, currentNetwork, expiryMs);

  try {
    const redis = getRedis();
    if (redis) {
      // If redis cache is enabled, store in redis, with a TTL in seconds
      const expirySeconds = Math.round(expiryMs / 1000);
      logger.debug(`Redis cache set for ${path}, with TTL ${expirySeconds} seconds`);

      if (method === 'HSET') {
        const fields = typeof data === 'string' ? { [field]: data } : data;
        redis
          .hset(path, fields)
          .then(() => redis.expire(path, expirySeconds))
          .catch(logRedisFailure('hset', path));
      } else {
        const checkedData = typeof data === 'string' ? data : JSON.stringify(data);
        redis.set(path, checkedData, { ex: expirySeconds }).catch(logRedisFailure('set', path));
      }
    } else {
      // File cache
      if (Object.keys(fs).length === 0) return;

      const checkedData = typeof data === 'string' ? data : JSON.stringify(data);
      fs.writeFileSync(path, checkedData);

      memoryCache[path] = {
        expiry: expiryMs ? Date.now() + expiryMs : null,
        data: checkedData
      };
    }
  } catch (e) {
    logger.error(`CacheSet: Error storing data in cache, ${name} - ${network}`, e.message);
  }
};
