/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { gqlRequest } from 'modules/gql/gqlRequest';
import { delegateWithPaginatedDelegations } from 'modules/gql/queries/subgraph/delegateWithPaginatedDelegations';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { formatCurrentDelegations } from '../helpers/formatCurrentDelegations';
import { DelegationHistory } from '../types';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { stakingEngineAddressMainnet, stakingEngineAddressTestnet } from 'modules/gql/gql.constants';

export type PaginatedDelegationsResponse = {
  delegations: DelegationHistory[];
  total: number;
};

export async function fetchDelegatePaginatedDelegations(
  delegateAddress: string,
  network: SupportedNetworks,
  offset: number,
  limit: number
): Promise<PaginatedDelegationsResponse> {
  const delegateId = delegateAddress.toLowerCase();
  const chainId = networkNameToChainId(network);
  const stakingEngineAddresses = [stakingEngineAddressMainnet, stakingEngineAddressTestnet];

  const response = await gqlRequest({
    chainId,
    query: delegateWithPaginatedDelegations(
      chainId,
      delegateId,
      limit,
      offset,
      'amount',
      'desc',
      stakingEngineAddresses
    )
  });

  const delegate = response.delegate?.[0];

  if (!delegate || !delegate.delegations) {
    return {
      delegations: [],
      total: 0
    };
  }

  return {
    delegations: formatCurrentDelegations(delegate.delegations),
    total: delegate.delegators || 0
  };
}
