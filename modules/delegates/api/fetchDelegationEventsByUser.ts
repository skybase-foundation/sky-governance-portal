/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import logger from 'lib/logger';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { userDelegationToDelegate } from 'modules/gql/queries/subgraph/userDelegationToDelegate';
import { fetchAllPages } from 'modules/gql/fetchAllPages';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { SkyLockedDelegateApiResponse } from '../types';
import { formatEther } from 'viem';

export async function fetchDelegationEventsByUser(
  delegateAddress: string,
  userAddress: string,
  network: SupportedNetworks
): Promise<SkyLockedDelegateApiResponse[]> {
  try {
    const chainId = networkNameToChainId(network);
    const delegationHistory: any = await fetchAllPages(async cursor => {
      const data = await gqlRequest({
        chainId,
        query: userDelegationToDelegate(
          chainId,
          delegateAddress.toLowerCase(),
          userAddress.toLowerCase(),
          cursor
        )
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
  } catch (e) {
    logger.error('fetchDelegationEventsByUser: Error fetching delegation events', e.message);
    return [];
  }
}
