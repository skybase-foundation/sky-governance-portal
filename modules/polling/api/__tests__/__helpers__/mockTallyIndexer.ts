/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock } from 'vitest';

type TallyIndexerResponses = {
  delegates?: unknown;
  mainnet?: unknown;
  arbitrum?: unknown;
  weights?: unknown;
};

const isNextPage = (query: string) => /id: \{ _gt: "[^"]+" \}/.test(query);

// Answers the tally's indexer queries by name. Follow-up page requests get an empty page,
// since each mocked response is the complete result for its query.
export function mockTallyIndexer(gqlRequest: Mock, responses: TallyIndexerResponses): void {
  gqlRequest.mockImplementation(async ({ query }: { query: string }) => {
    if (query.includes('allMainnetVoters')) {
      return isNextPage(query) ? { pollVotes: [] } : responses.mainnet ?? { pollVotes: [] };
    }
    if (query.includes('allArbitrumVoters')) {
      return isNextPage(query) ? { arbitrumPoll: null } : responses.arbitrum ?? { arbitrumPoll: null };
    }
    if (query.includes('voteAddressSkyWeightsAtTime')) {
      return responses.weights ?? { voters: [] };
    }
    if (query.includes('delegates: Delegate(')) {
      return isNextPage(query) ? { delegates: [] } : responses.delegates ?? { delegates: [] };
    }
    throw new Error(`Unexpected indexer query: ${query.slice(0, 80)}`);
  });
}
