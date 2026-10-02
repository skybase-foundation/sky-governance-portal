/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

export const allArbitrumVoters = (chainId: number, pollId: string, cursor: string) => /* GraphQL */ `
query allArbitrumVoters {
  arbitrumPoll: ArbitrumPoll_by_pk(id: "${chainId}-${pollId}") {
    startDate
    endDate
    votes(
      limit: ${INDEXER_PAGE_SIZE}
      order_by: { id: asc }
      where: { id: { _gt: "${cursor}" } }
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
}
`;
