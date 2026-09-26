/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const userDelegationToDelegate = (
  chainId: number,
  delegate: string,
  delegator: string,
  cursor: string
) => /* GraphQL */ `
{
  delegationHistory: DelegationHistory(
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
    where: { _and: [
      { delegate: { id: { _ilike: "${chainId}-${delegate}" } } },
      { delegator: { _ilike: "${delegator}" } },
      { id: { _gt: "${cursor}" } }
    ] }
  ) {
    id
    amount
    accumulatedAmount
    delegator
    blockNumber
    timestamp
    txnHash
    delegate {
      id
      address
    }
    isStakingEngine
  }
}
`;
