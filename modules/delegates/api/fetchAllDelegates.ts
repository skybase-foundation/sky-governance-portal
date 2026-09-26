/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { gqlRequest } from 'modules/gql/gqlRequest';
import { allDelegates } from 'modules/gql/queries/subgraph/allDelegates';
import { fetchAllPages } from 'modules/gql/fetchAllPages';

export async function fetchAllDelegates<T extends { id: string } = any>(chainId: number): Promise<T[]> {
  return fetchAllPages(async cursor => {
    const response = await gqlRequest<{ delegates?: T[] }>({
      chainId,
      query: allDelegates(chainId, cursor)
    });
    return response.delegates || [];
  });
}
