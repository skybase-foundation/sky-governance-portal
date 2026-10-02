/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const allMainnetVoters = (chainId: number, pollId: string, cursor: string) => /* GraphQL */ `
query allMainnetVoters {
  pollVotes: PollVote(
    limit: ${INDEXER_PAGE_SIZE}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { poll: { id: { _eq: "${chainId}-${pollId}" } } },
      { id: { _gt: "${cursor}" } }
    ] }
  ) {
    id
    voter {
      id
      address
    }
    blockTime
    choice
    txnHash
  }
}
`;
