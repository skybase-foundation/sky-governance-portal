/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

export const delegateWithPaginatedDelegations = (
  chainId: number,
  id: string,
  first: number,
  skip: number,
  orderBy: string,
  orderDirection: string,
  excludeAddresses: string[]
) => {
  const formattedExclude = excludeAddresses.map(a => `{ delegator: { _nilike: "${a}" } }`).join(', ');
  return /* GraphQL */ `
{
  delegate: Delegate(where: { id: { _ilike: "${chainId}-${id}" } }, limit: 1) {
    id
    address
    blockTimestamp
    blockNumber
    ownerAddress
    delegators
    voter {
      lastVotedTimestamp
    }
    delegations(
      limit: ${first}
      offset: ${skip}
      order_by: { ${orderBy}: ${orderDirection} }
      where: { _and: [${formattedExclude}] }
    ) {
      delegator
      amount
    }
  }
}
`;
};
