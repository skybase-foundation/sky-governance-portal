/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const allDelegatesExecSupport = (chainId: number, cursor: string) => /* GraphQL */ `
{
  delegates: Delegate(
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { version: { _eq: "3" } },
      { id: { _gt: "${cursor}" } }
    ] }
  ) {
    blockTimestamp
    ownerAddress
    id
    address
    totalDelegated
    voter {
      lastVotedTimestamp
      currentSpellsV2
    }
  }
}
`;
