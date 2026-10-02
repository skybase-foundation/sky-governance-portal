/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportedNetworks } from 'modules/web3/constants/networks';

vi.mock('modules/gql/gqlRequest', () => ({ gqlRequest: vi.fn() }));
vi.mock('modules/web3/helpers/getPublicClient', () => ({ getPublicClient: vi.fn() }));

const BLOCK_TIMES: Record<number, Record<string, number>> = {
  1: { '100': 1_000 },
  42161: { '200': 2_000 }
};

const mockChains = (meta: Record<number, { progressBlock: number; isReady: boolean } | Error>) => {
  return Promise.all([import('modules/gql/gqlRequest'), import('modules/web3/helpers/getPublicClient')]).then(
    ([{ gqlRequest }, { getPublicClient }]) => {
      (gqlRequest as Mock).mockImplementation(async ({ chainId }: { chainId: number }) => {
        const chainMeta = meta[chainId];
        if (chainMeta instanceof Error) throw chainMeta;
        return { _meta: chainMeta ? [chainMeta] : [] };
      });
      (getPublicClient as Mock).mockImplementation((chainId: number) => ({
        getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
          timestamp: BigInt(BLOCK_TIMES[chainId][blockNumber.toString()])
        })
      }));
      return gqlRequest as Mock;
    }
  );
};

const loadHelper = async () => (await import('../getIndexerSyncedThrough')).getIndexerSyncedThrough;

describe('getIndexerSyncedThrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the earlier of the two chains’ processed block times', async () => {
    await mockChains({
      1: { progressBlock: 100, isReady: true },
      42161: { progressBlock: 200, isReady: true }
    });

    expect(await (await loadHelper())(SupportedNetworks.MAINNET)).toBe(1_000);
  });

  it('returns 0 when a chain is not ready', async () => {
    await mockChains({
      1: { progressBlock: 100, isReady: true },
      42161: { progressBlock: 200, isReady: false }
    });

    expect(await (await loadHelper())(SupportedNetworks.MAINNET)).toBe(0);
  });

  it('returns 0 when a chain has no progress entry', async () => {
    await mockChains({ 1: { progressBlock: 100, isReady: true } });

    expect(await (await loadHelper())(SupportedNetworks.MAINNET)).toBe(0);
  });

  it('returns 0 when the progress check fails', async () => {
    await mockChains({ 1: new Error('indexer unavailable'), 42161: { progressBlock: 200, isReady: true } });

    expect(await (await loadHelper())(SupportedNetworks.MAINNET)).toBe(0);
  });

  it('reuses a recent result instead of querying again', async () => {
    const gqlRequest = await mockChains({
      1: { progressBlock: 100, isReady: true },
      42161: { progressBlock: 200, isReady: true }
    });
    const getIndexerSyncedThrough = await loadHelper();

    await getIndexerSyncedThrough(SupportedNetworks.MAINNET);
    await getIndexerSyncedThrough(SupportedNetworks.MAINNET);

    expect(gqlRequest).toHaveBeenCalledTimes(2);
  });
});
