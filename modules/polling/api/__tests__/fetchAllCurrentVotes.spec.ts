/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchAllCurrentVotes } from '../fetchAllCurrentVotes';
import { SupportedNetworks } from 'modules/web3/constants/networks';

vi.mock('modules/gql/gqlRequest');
vi.mock('modules/address/api/getAddressInfo', () => ({ getAddressInfo: vi.fn().mockResolvedValue(null) }));

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const POLL_COUNT = 150;
const endDateOf = (pollId: number) => 2_000_000_000 + pollId * 1000;

// Balance at time T is T wei-SKY, so each poll's weight identifies which timestamp was looked up.
const mockIndexer = () =>
  (gqlRequest as Mock).mockImplementation(async ({ query }: { query: string }) => {
    if (query.includes('arbitrumPollVotes')) {
      return {
        arbitrumPollVotes: Array.from({ length: POLL_COUNT }, (_, pollId) => ({
          poll: { id: `42161-${pollId}`, pollId: String(pollId) },
          voter: { id: `42161-${ADDRESS}` },
          choice: '1',
          blockTime: String(endDateOf(pollId) - 10),
          txnHash: `0x${pollId}`
        }))
      };
    }
    if (query.includes('pollVotes')) return { pollVotes: [] };
    if (query.includes('arbitrumPolls')) {
      return {
        arbitrumPolls: Array.from({ length: POLL_COUNT }, (_, pollId) => ({
          id: `42161-${pollId}`,
          pollId: String(pollId),
          startDate: String(endDateOf(pollId) - 100),
          endDate: String(endDateOf(pollId))
        }))
      };
    }
    return Object.fromEntries(
      [...query.matchAll(/(at\d+): ExecutiveVotingPowerChangeV2[\s\S]*?_lte: "(\d+)"/g)].map(([, alias, unix]) => [
        alias,
        [{ newBalance: `${unix}000000000000000000` }]
      ])
    );
  });

describe('fetchAllCurrentVotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('weights each vote by the balance at its poll end, looked up per poll in batches', async () => {
    mockIndexer();

    const votes = await fetchAllCurrentVotes(ADDRESS, SupportedNetworks.MAINNET);

    expect(votes).toHaveLength(POLL_COUNT);
    votes.forEach(vote => expect(vote.skySupport).toBe(endDateOf(vote.pollId)));
    const weightRequests = (gqlRequest as Mock).mock.calls.filter(([{ query }]) =>
      query.includes('votingWeightsAtTimes')
    );
    expect(weightRequests).toHaveLength(2);
  });
});
