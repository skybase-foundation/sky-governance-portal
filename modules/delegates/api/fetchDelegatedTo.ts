/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { formatEther, parseEther } from 'viem';
import logger from 'lib/logger';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchAllPages } from 'modules/gql/fetchAllPages';
import { fetchAllDelegates } from './fetchAllDelegates';
import { delegatorHistory } from 'modules/gql/queries/subgraph/delegatorHistory';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { DelegationHistory, SKYDelegatedToResponse } from '../types';

export async function fetchDelegatedTo(
  address: string,
  network: SupportedNetworks
): Promise<DelegationHistory[]> {
  try {
    // TODO: This information could be aggregated in the "mkrDelegatedTo" query in gov-polling-db, and returned there, as an improvement.
    const chainId = networkNameToChainId(network);
    const delegates = await fetchAllDelegates(chainId);

    // Returns the records with the aggregated delegated data
    const delegationHistories: any = await fetchAllPages(async cursor => {
      const data = await gqlRequest({
        chainId,
        query: delegatorHistory(chainId, address.toLowerCase(), cursor)
      });
      return data.delegationHistories || [];
    });
    const res: SKYDelegatedToResponse[] = delegationHistories.map(x => {
      return {
        delegateContractAddress: x.delegate.address,
        lockAmount: x.amount,
        blockTimestamp: new Date(parseInt(x.timestamp) * 1000).toISOString(),
        hash: x.txnHash,
        blockNumber: x.blockNumber,
        immediateCaller: address,
        isStakingEngine: x.isStakingEngine
      };
    });

    const delegatedTo = res.reduce(
      (acc, { delegateContractAddress, lockAmount, blockTimestamp, hash, isStakingEngine }) => {
        const existing = acc.find(({ address }) => address === delegateContractAddress) as
          | DelegationHistory
          | undefined;

        // We sum the total of lockAmounts in different events to calculate the current delegated amount
        if (existing) {
          existing.lockAmount = formatEther(parseEther(existing.lockAmount) + parseEther(lockAmount));
          existing.events.push({
            lockAmount: formatEther(parseEther(lockAmount)),
            blockTimestamp,
            hash,
            isStakingEngine
          });
        } else {
          const delegatingTo = delegates.find(
            i => i?.address?.toLowerCase() === delegateContractAddress.toLowerCase()
          );

          if (!delegatingTo) {
            return acc;
          }

          acc.push({
            address: delegateContractAddress,
            lockAmount: formatEther(parseEther(lockAmount)),
            events: [
              { lockAmount: formatEther(parseEther(lockAmount)), blockTimestamp, hash, isStakingEngine }
            ]
          } as DelegationHistory);
        }

        return acc;
      },
      [] as DelegationHistory[]
    );

    // Sort by lockAmount, lockAmount is the total amount delegated currently
    return delegatedTo.sort((prev, next) =>
      parseEther(prev.lockAmount) > parseEther(next.lockAmount) ? -1 : 1
    );
  } catch (e) {
    logger.error('fetchDelegatedTo: Error fetching SKY delegated to address', e.message);
    return [];
  }
}
