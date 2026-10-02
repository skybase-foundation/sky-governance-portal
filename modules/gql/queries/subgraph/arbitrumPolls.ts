/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

export const arbitrumPollsQueryWithWhitelist = (chainId: number, skip: number, creatorWhitelist: string[]) => {
  const formattedWhitelist = creatorWhitelist.map(w => `{ creator: { _ilike: "${w}" } }`).join(', ');
  return /* GraphQL */ `
{
  arbitrumPolls: ArbitrumPoll(
    limit: 1000
    offset: ${skip}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { url: { _is_null: false } },
      { blockCreated: { _is_null: false } },
      { blockWithdrawn: { _is_null: true } },
      { _or: [${formattedWhitelist}] }
    ] }
  ) {
    id
    pollId
    url
    multiHash
  }
}
`;
};

export const arbitrumPollsQuery = (chainId: number, skip: number) => /* GraphQL */ `
{
  arbitrumPolls: ArbitrumPoll(
    limit: 1000
    offset: ${skip}
    order_by: { id: asc }
    where: { _and: [
      { chainId: { _eq: ${chainId} } },
      { url: { _is_null: false } },
      { blockCreated: { _is_null: false } },
      { blockWithdrawn: { _is_null: true } }
    ] }
  ) {
    id
    pollId
    url
    multiHash
  }
}
`;
