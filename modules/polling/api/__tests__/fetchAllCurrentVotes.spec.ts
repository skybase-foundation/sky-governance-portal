/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchAllCurrentVotes } from '../fetchAllCurrentVotes';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

vi.mock('modules/gql/gqlRequest');
vi.mock('modules/address/api/getAddressInfo', () => ({ getAddressInfo: vi.fn().mockResolvedValue(null) }));

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const POLL_COUNT = 150;
const endDateOf = (pollId: number) => 2_000_000_000 + pollId * 1000;

// Balance at time T is T wei-SKY, so each poll's weight identifies which timestamp was looked up.
const mockIndexer = () =>
  (gqlRequest as Mock).mockImplementation(async ({ query }: { query: string }) => {
    if (/id: \{ _gt: "[^"]+" \}/.test(query)) return {};
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
      [...query.matchAll(/(at\d+): ExecutiveVotingPowerChangeV2[\s\S]*?_lte: "(\d+)"/g)].map(
        ([, alias, unix]) => [alias, [{ newBalance: `${unix}000000000000000000` }]]
      )
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

  it('keeps a real vote that sorts after more than a page of votes on unlisted polls', async () => {
    const REAL_POLL = 99999;
    const junkVotes = Array.from({ length: 1200 }, (_, i) => ({
      id: `42161-${String(i).padStart(5, '0')}-${ADDRESS}`,
      poll: { id: `42161-${i}`, pollId: String(i) },
      choice: '1',
      blockTime: String(endDateOf(REAL_POLL) - 20),
      txnHash: `0x${i}`
    }));
    const realVote = {
      id: `42161-${REAL_POLL}-${ADDRESS}`,
      poll: { id: `42161-${REAL_POLL}`, pollId: String(REAL_POLL) },
      choice: '1',
      blockTime: String(endDateOf(REAL_POLL) - 10),
      txnHash: '0xreal'
    };
    const arbitrumVotes = [...junkVotes, realVote];

    (gqlRequest as Mock).mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('arbitrumPollVotes')) {
        const cursor = query.match(/id: \{ _gt: "([^"]*)" \}/)?.[1] ?? '';
        return {
          arbitrumPollVotes: arbitrumVotes
            .filter(vote => vote.id > cursor)
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .slice(0, INDEXER_PAGE_SIZE)
        };
      }
      if (query.includes('pollVotes')) return { pollVotes: [] };
      if (query.includes('arbitrumPolls')) {
        const requestedIds = [...query.matchAll(/"42161-(\d+)"/g)].map(match => match[1]);
        return {
          arbitrumPolls: requestedIds
            .filter(pollId => pollId === String(REAL_POLL))
            .map(pollId => ({
              id: `42161-${pollId}`,
              pollId,
              startDate: String(endDateOf(REAL_POLL) - 100),
              endDate: String(endDateOf(REAL_POLL))
            }))
        };
      }
      return { at0: [{ newBalance: '1000000000000000000' }] };
    });

    const votes = await fetchAllCurrentVotes(ADDRESS, SupportedNetworks.MAINNET);

    expect(votes.map(vote => vote.pollId)).toEqual([REAL_POLL]);
  });
});
