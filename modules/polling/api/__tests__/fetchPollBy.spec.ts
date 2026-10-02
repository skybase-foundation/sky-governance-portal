/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, vi } from 'vitest';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { cacheGet } from 'modules/cache/cache';
import { pollDetailsCacheKey, pollListCacheKey } from 'modules/cache/constants/cache-keys';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { PollInputFormat, PollResultDisplay, PollVictoryConditions } from 'modules/polling/polling.constants';
import { fetchSinglePoll } from '../fetchPollBy';
import { refetchPolls } from '../fetchPolls';

vi.mock('modules/gql/gqlRequest');
vi.mock('modules/cache/cache');
vi.mock('lib/markdown', () => ({ markdownToHtml: async () => '' }));
vi.mock('../getPollTags', () => ({
  getPollTags: async () => [],
  getPollTagsMapping: async () => ({})
}));

// The poll list is not in poll order, here the newest poll (1651) is followed by an older one
const indexerPollIds = [1650, 1606, 1651, 1605];

const pollPath = (pollId: number) => `polls/poll-${pollId}.md`;
const pollSlug = (pollId: number) => `Qm${pollId}aa`;

const subgraphPolls = indexerPollIds.map(pollId => ({
  id: `42161-${pollId}`,
  pollId: pollId.toString(),
  url: `https://raw.githubusercontent.com/sky-ecosystem/polls/main/${pollPath(pollId)}`,
  multiHash: `${pollSlug(pollId)}aaaaaaaa`
}));

const pollsMetadata = indexerPollIds.map(pollId => ({
  path: pollPath(pollId),
  metadata: {
    title: `Poll ${pollId}`,
    summary: '',
    discussion_link: '',
    start_date: '2026-09-21T16:00:00.000Z',
    end_date: '2026-09-24T16:00:00.000Z',
    options: { '0': 'Abstain', '1': 'Yes', '2': 'No' },
    parameters: {
      input_format: { type: PollInputFormat.singleChoice, abstain: [0], options: [] },
      result_display: PollResultDisplay.singleVoteBreakdown,
      victory_conditions: [{ type: PollVictoryConditions.plurality }]
    }
  }
}));

// Serves the given cache entries, poll details are keyed by poll id
const mockCache = (entries: { pollList?: string; pollDetails?: Record<string, string> }) => {
  (cacheGet as Mock).mockImplementation(async (name: string, _network, _expiryMs, _method, field: string) => {
    if (name === pollListCacheKey) return entries.pollList ?? null;
    if (name === pollDetailsCacheKey) return entries.pollDetails?.[field] ?? null;
    return null;
  });
};

describe('Poll navigation', () => {
  beforeEach(() => {
    mockCache({});

    (gqlRequest as Mock).mockImplementation(async ({ query }: { query: string }) => ({
      arbitrumPolls: query.includes('offset: 0') ? subgraphPolls : []
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => pollsMetadata, text: async () => '' }))
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test('Newest poll has no next poll', async () => {
    const poll = await fetchSinglePoll(SupportedNetworks.MAINNET, 1651);

    expect(poll?.ctx).toEqual({ prev: { slug: pollSlug(1650) }, next: null });
  });

  test('Oldest poll has no previous poll', async () => {
    const poll = await fetchSinglePoll(SupportedNetworks.MAINNET, 1605);

    expect(poll?.ctx).toEqual({ prev: null, next: { slug: pollSlug(1606) } });
  });

  test('Poll links to its neighbours by poll id', async () => {
    const poll = await fetchSinglePoll(SupportedNetworks.MAINNET, pollSlug(1650));

    expect(poll?.ctx).toEqual({ prev: { slug: pollSlug(1606) }, next: { slug: pollSlug(1651) } });
  });

  test('Neighbours follow poll id when the cached poll list is out of order', async () => {
    const { pollList } = await refetchPolls(SupportedNetworks.MAINNET);
    expect(pollList.map(poll => poll.pollId)).toEqual(indexerPollIds);
    mockCache({ pollList: JSON.stringify(pollList) });
    (gqlRequest as Mock).mockClear();

    const poll = await fetchSinglePoll(SupportedNetworks.MAINNET, 1651);

    expect(gqlRequest).not.toHaveBeenCalled();
    expect(poll?.ctx).toEqual({ prev: { slug: pollSlug(1650) }, next: null });
  });

  test('Neighbours cached with the poll details are not served', async () => {
    const staleDetails = {
      pollId: 1651,
      slug: pollSlug(1651),
      ctx: { prev: null, next: { slug: pollSlug(1606) } }
    };
    mockCache({ pollDetails: { '1651': JSON.stringify(staleDetails) } });

    const poll = await fetchSinglePoll(SupportedNetworks.MAINNET, 1651);

    expect(poll?.ctx).toEqual({ prev: { slug: pollSlug(1650) }, next: null });
  });
});
