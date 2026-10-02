/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const delegatorDelegateHistory = (
  chainId: number,
  delegator: string,
  delegate: string,
  cursor: string
) => /* GraphQL */ `
{
  delegationHistories: DelegationHistory(
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { delegator: { _ilike: "${delegator}" } },
      { delegate: { id: { _ilike: "${chainId}-${delegate}" } } },
      { id: { _gt: "${cursor}" } }
    ] }
  ) {
    id
    amount
    accumulatedAmount
    delegate {
      id
      address
    }
    timestamp
    txnHash
    blockNumber
    isStakingEngine
  }
}
`;
