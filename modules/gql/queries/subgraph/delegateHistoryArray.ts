/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const delegateHistoryArray = (
  chainId: number,
  delegates: string[],
  engines: string[],
  cursor: string
) => {
  const prefixedDelegates = delegates
    .map(d => `{ delegate: { id: { _ilike: "${chainId}-${d}" } } }`)
    .join(', ');
  const formattedEngines = engines.map(e => `{ delegator: { _nilike: "${e}" } }`).join(', ');
  return /* GraphQL */ `
{
  delegationHistory: DelegationHistory(
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { _or: [${prefixedDelegates}] },
      { delegate: { version: { _eq: "3" } } },
      ${formattedEngines},
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
};
