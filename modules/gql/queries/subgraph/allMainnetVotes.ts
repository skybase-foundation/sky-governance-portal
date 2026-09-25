/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const allMainnetVotes = (
  chainId: number,
  address: string,
  startUnix: number,
  cursor: string
) => /* GraphQL */ `
{
  pollVotes: PollVote(
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { voter: { id: { _ilike: "${chainId}-${address}" } } },
      { blockTime: { _gt: "${startUnix}" } },
      { id: { _gt: "${cursor}" } }
    ] }
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
  ) {
    id
    poll {
      id
      pollId
    }
    choice
    blockTime
    txnHash
  }
}
`;
