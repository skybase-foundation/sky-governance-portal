/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { gqlRequest } from 'modules/gql/gqlRequest';
import { delegateHistoryArray } from 'modules/gql/queries/subgraph/delegateHistoryArray';
import { fetchAllPages } from 'modules/gql/fetchAllPages';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { SkyLockedDelegateApiResponse } from '../types';
import { formatEther } from 'viem';
import { stakingEngineAddressMainnet, stakingEngineAddressTestnet } from 'modules/gql/gql.constants';

export async function fetchDelegationEventsByAddresses(
  addresses: string[],
  network: SupportedNetworks
): Promise<SkyLockedDelegateApiResponse[]> {
  const engine =
    network === SupportedNetworks.TENDERLY ? stakingEngineAddressTestnet : stakingEngineAddressMainnet;
  const chainId = networkNameToChainId(network);
  const delegationHistory: any = await fetchAllPages(async cursor => {
    const data = await gqlRequest({
      chainId,
      query: delegateHistoryArray(chainId, addresses, [engine.toLowerCase()], cursor)
    });
    return data.delegationHistory || [];
  });

  const addressData: SkyLockedDelegateApiResponse[] = delegationHistory.map(x => {
    return {
      delegateContractAddress: x.delegate.address,
      immediateCaller: x.delegator,
      lockAmount: formatEther(x.amount),
      blockNumber: x.blockNumber,
      blockTimestamp: new Date(parseInt(x.timestamp) * 1000).toISOString(),
      hash: x.txnHash,
      callerLockTotal: formatEther(x.accumulatedAmount),
      isStakingEngine: x.isStakingEngine
    };
  });
  return addressData;
}
