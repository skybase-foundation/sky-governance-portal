/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

// One aliased lookup per timestamp, each returning the last balance change at or before it,
// ordered the same way as voteAddressSkyWeightsAtTime so same-block changes resolve identically.
export const votingWeightsAtTimes = (chainId: number, address: string, timestamps: number[]) => {
  const lookups = timestamps
    .map(
      (unix, i) => `
  at${i}: ExecutiveVotingPowerChangeV2(
    limit: 1
    order_by: [{ blockTimestamp: desc }, { blockNumber: desc }, { logIndex: desc }]
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { voter: { id: { _ilike: "${chainId}-${address}" } } },
      { blockTimestamp: { _lte: "${unix}" } }
    ] }
  ) {
    newBalance
  }`
    )
    .join('');

  return /* GraphQL */ `
query votingWeightsAtTimes {${lookups}
}
`;
};
