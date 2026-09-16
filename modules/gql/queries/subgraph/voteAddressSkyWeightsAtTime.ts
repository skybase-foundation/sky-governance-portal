/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

// The weight lookup orders by blockTimestamp, then blockNumber, then logIndex.
// Same-block changes share a timestamp, so timestamp-only ordering can return a
// non-final balance. Keep comments out of the GraphQL string: the indexer
// endpoint rejects queries containing '#' comments.
export const voteAddressSkyWeightsAtTime = (chainId: number, voters: string[], unix: number) => {
  const prefixedVoters = voters.map(v => `{ id: { _ilike: "${chainId}-${v}" } }`).join(', ');
  return /* GraphQL */ `
query voteAddressSkyWeightsAtTime {
  voters: Voter(
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { _or: [${prefixedVoters}] }
    ] }
  ) {
    id
    address
    v2VotingPowerChanges(
      limit: 1
      order_by: [{ blockTimestamp: desc }, { blockNumber: desc }, { logIndex: desc }]
      where: { blockTimestamp: { _lte: "${unix}" } }
    ) {
      newBalance
    }
  }
}
`;
};
