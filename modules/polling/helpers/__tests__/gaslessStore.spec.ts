/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import {
  claimGaslessSlot,
  readGaslessSlot,
  releaseGaslessSlot,
  incrementGaslessCounter,
  readGaslessCounter,
  GaslessStoreUnavailableError,
  __testables
} from '../gaslessStore';
import { getRedis } from 'modules/cache/cache';
import { config } from 'lib/config';
import { SupportedNetworks } from 'modules/web3/constants/networks';

vi.mock('modules/cache/cache', () => ({ getRedis: vi.fn() }));

const network = SupportedNetworks.MAINNET;
const originalNodeEnv = config.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  __testables.memoryStore.clear();
  (getRedis as Mock).mockReturnValue(null);
});

afterEach(() => {
  config.NODE_ENV = originalNodeEnv;
  vi.useRealTimers();
});

describe('gaslessStore without Redis outside production', () => {
  it('claims a slot once until it expires', async () => {
    vi.useFakeTimers();
    expect(await claimGaslessSlot(network, 'slot', 'v', 1000)).toBe(true);
    expect(await claimGaslessSlot(network, 'slot', 'v', 1000)).toBe(false);
    expect(await readGaslessSlot(network, 'slot')).toBe('v');

    vi.advanceTimersByTime(1001);
    expect(await readGaslessSlot(network, 'slot')).toBeNull();
    expect(await claimGaslessSlot(network, 'slot', 'v', 1000)).toBe(true);
  });

  it('frees a released slot', async () => {
    await claimGaslessSlot(network, 'slot', 'v', 1000);
    await releaseGaslessSlot(network, 'slot');

    expect(await claimGaslessSlot(network, 'slot', 'v', 1000)).toBe(true);
  });

  it('counts up and reads the counter back', async () => {
    expect(await readGaslessCounter(network, 'count')).toBe(0);
    expect(await incrementGaslessCounter(network, 'count', 1000)).toBe(1);
    expect(await incrementGaslessCounter(network, 'count', 1000)).toBe(2);
    expect(await readGaslessCounter(network, 'count')).toBe(2);
  });

  it('keeps keys free of date and version suffixes', () => {
    expect(__testables.storeKey(network, 'recently-used-gasless-voting-0xabc')).toBe(
      'gasless:mainnet:recently-used-gasless-voting-0xabc'
    );
  });
});

describe('gaslessStore fails closed', () => {
  it('throws in production when Redis is not configured', async () => {
    config.NODE_ENV = 'production';

    await expect(claimGaslessSlot(network, 'slot', 'v', 1000)).rejects.toBeInstanceOf(
      GaslessStoreUnavailableError
    );
    await expect(incrementGaslessCounter(network, 'count', 1000)).rejects.toBeInstanceOf(
      GaslessStoreUnavailableError
    );
  });

  it('throws when a Redis call fails', async () => {
    (getRedis as Mock).mockReturnValue({
      set: vi.fn().mockRejectedValue(new Error('timeout')),
      get: vi.fn().mockRejectedValue(new Error('timeout'))
    });

    await expect(claimGaslessSlot(network, 'slot', 'v', 1000)).rejects.toBeInstanceOf(
      GaslessStoreUnavailableError
    );
    await expect(readGaslessSlot(network, 'slot')).rejects.toBeInstanceOf(GaslessStoreUnavailableError);
  });
});

describe('gaslessStore with Redis', () => {
  it('claims with SET NX and a millisecond TTL', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    (getRedis as Mock).mockReturnValue({ set });

    expect(await claimGaslessSlot(network, 'slot', 'v', 600_000)).toBe(true);
    expect(await claimGaslessSlot(network, 'slot', 'v', 600_000)).toBe(false);
    expect(set).toHaveBeenCalledWith('gasless:mainnet:slot', 'v', { px: 600_000, nx: true });
  });

  it('increments and sets the TTL in one transaction', async () => {
    const exec = vi.fn().mockResolvedValue([5, 1]);
    const pexpire = vi.fn().mockReturnValue({ exec });
    const incr = vi.fn().mockReturnValue({ pexpire });
    (getRedis as Mock).mockReturnValue({ multi: () => ({ incr }) });

    expect(await incrementGaslessCounter(network, 'count', 1000)).toBe(5);
    expect(incr).toHaveBeenCalledWith('gasless:mainnet:count');
    expect(pexpire).toHaveBeenCalledWith('gasless:mainnet:count', 1000);
  });
});
