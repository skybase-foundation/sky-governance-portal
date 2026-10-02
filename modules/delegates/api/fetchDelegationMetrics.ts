/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { fetchAllDelegates } from './fetchAllDelegates';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { formatEther } from 'viem';

interface DelegationMetrics {
  totalSkyDelegated: string;
  delegatorCount: number;
}

interface Delegate {
  id: string;
  totalDelegated: string;
  delegators: number;
}

export async function fetchDelegationMetrics(network: SupportedNetworks): Promise<DelegationMetrics> {
  const chainId = networkNameToChainId(network);

  const delegates = await fetchAllDelegates<Delegate>(chainId);

  // Sum totalDelegated and delegators across all delegates
  const totalSkyDelegated = formatEther(
    delegates.reduce((acc, cur) => acc + BigInt(cur.totalDelegated || '0'), 0n)
  );
  const delegatorCount = delegates.reduce((acc, cur) => acc + (cur.delegators || 0), 0);

  return {
    totalSkyDelegated,
    delegatorCount
  };
}
