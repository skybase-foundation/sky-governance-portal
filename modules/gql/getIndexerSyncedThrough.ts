/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import logger from 'lib/logger';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { indexerProgress } from 'modules/gql/queries/subgraph/indexerProgress';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { getGaslessNetwork, networkNameToChainId } from 'modules/web3/helpers/chain';
import { getPublicClient } from 'modules/web3/helpers/getPublicClient';

const MEMO_TTL_MS = 30 * 1000;
const memo = new Map<SupportedNetworks, { expiresAt: number; syncedThrough: Promise<number> }>();

async function fetchChainSyncedThrough(chainId: number): Promise<number> {
  const { _meta } = await gqlRequest<{ _meta: { progressBlock: number; isReady: boolean }[] }>({
    chainId,
    query: indexerProgress(chainId)
  });
  const meta = _meta[0];
  if (!meta?.isReady) return 0;

  const block = await getPublicClient(chainId).getBlock({ blockNumber: BigInt(meta.progressBlock) });
  return Number(block.timestamp);
}

// Unix time up to which the indexer has processed every block on both chains that poll tallies read
// (mainnet and its gasless Arbitrum chain). Returns 0 when either chain is not ready or the check fails.
export function getIndexerSyncedThrough(network: SupportedNetworks): Promise<number> {
  const cached = memo.get(network);
  if (cached && cached.expiresAt > Date.now()) return cached.syncedThrough;

  const chainIds = [networkNameToChainId(network), networkNameToChainId(getGaslessNetwork(network))];
  const syncedThrough = Promise.all(chainIds.map(fetchChainSyncedThrough))
    .then(timestamps => Math.min(...timestamps))
    .catch(e => {
      logger.warn('getIndexerSyncedThrough: Could not read indexer progress', e.message, 'Network', network);
      return 0;
    });

  memo.set(network, { expiresAt: Date.now() + MEMO_TTL_MS, syncedThrough });
  return syncedThrough;
}
