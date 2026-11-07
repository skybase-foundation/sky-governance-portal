/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { config } from 'lib/config';
import { getRedis } from 'modules/cache/cache';
import { SupportedNetworks } from 'modules/web3/constants/networks';

/**
 * Storage for the gasless relayer's spending controls: the per-voter cooldown, the fee-bump
 * attempt slots and the daily vote counter.
 *
 * Unlike the general cache, it fails closed. In production every call needs Redis, and a
 * missing or failing Redis throws GaslessStoreUnavailableError so the caller refuses to spend
 * relayer gas instead of skipping the limit. Keys carry no date or app-version suffix, so a
 * limit can't be reset by crossing UTC midnight or by a deploy.
 */
export class GaslessStoreUnavailableError extends Error {
  constructor(message: string) {
    super(`Gasless store unavailable: ${message}`);
    this.name = 'GaslessStoreUnavailableError';
  }
}

// Outside production (local dev and tests) there is no Redis, so a per-process map stands in.
const memoryStore = new Map<string, { value: string; expiresAt: number }>();

const storeKey = (network: SupportedNetworks, name: string) => `gasless:${network}:${name}`;

function getStore() {
  const redis = getRedis();
  if (!redis && config.NODE_ENV === 'production') {
    throw new GaslessStoreUnavailableError('Redis is not configured');
  }
  return redis;
}

async function withRedis<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    throw new GaslessStoreUnavailableError((err as Error).message);
  }
}

function readMemory(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

/** Sets the key only if it's free. Returns true if this call claimed it. */
export async function claimGaslessSlot(
  network: SupportedNetworks,
  name: string,
  value: string,
  ttlMs: number
): Promise<boolean> {
  const key = storeKey(network, name);
  const redis = getStore();
  if (redis) {
    const result = await withRedis(() => redis.set(key, value, { px: ttlMs, nx: true }));
    return result === 'OK';
  }
  if (readMemory(key) !== null) return false;
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
  return true;
}

export async function readGaslessSlot(network: SupportedNetworks, name: string): Promise<string | null> {
  const key = storeKey(network, name);
  const redis = getStore();
  if (redis) return withRedis(() => redis.get<string>(key));
  return readMemory(key);
}

export async function releaseGaslessSlot(network: SupportedNetworks, name: string): Promise<void> {
  const key = storeKey(network, name);
  const redis = getStore();
  if (redis) {
    await withRedis(() => redis.del(key));
    return;
  }
  memoryStore.delete(key);
}

/** Atomically adds one to the counter and returns the new value. */
export async function incrementGaslessCounter(
  network: SupportedNetworks,
  name: string,
  ttlMs: number
): Promise<number> {
  const key = storeKey(network, name);
  const redis = getStore();
  if (redis) {
    return withRedis(async () => {
      const [count] = await redis.multi().incr(key).pexpire(key, ttlMs).exec<[number, number]>();
      return count;
    });
  }
  const count = Number(readMemory(key) ?? 0) + 1;
  const expiresAt = memoryStore.get(key)?.expiresAt ?? Date.now() + ttlMs;
  memoryStore.set(key, { value: count.toString(), expiresAt });
  return count;
}

export async function readGaslessCounter(network: SupportedNetworks, name: string): Promise<number> {
  const value = await readGaslessSlot(network, name);
  return Number(value ?? 0);
}

export const __testables = { memoryStore, storeKey };
