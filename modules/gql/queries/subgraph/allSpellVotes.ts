/*
SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>
SPDX-License-Identifier: AGPL-3.0-or-later
*/

// Nested weight lookup uses the same blockTimestamp/blockNumber/logIndex ordering
// as voteAddressSkyWeightsAtTime (see the note there).
export const allSpellVotes = (chainId: number, skip: number, first: number) => /* GraphQL */ `
{
  executiveVoteV2S: ExecutiveVoteV2(
    limit: ${first}
    offset: ${skip}
    order_by: { id: desc }
    where: { chainId: { _eq: ${chainId} } }
  ) {
    blockTime
    spell {
      id
      address
    }
    voter {
      id
      address
      v2VotingPowerChanges(
        limit: 1
        order_by: [{ blockTimestamp: desc }, { blockNumber: desc }, { logIndex: desc }]
      ) {
        newBalance
      }
    }
  }
}
`;
