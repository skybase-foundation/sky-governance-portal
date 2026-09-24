/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { ONE_MINUTE_IN_MS, ONE_WEEK_IN_MS } from 'modules/app/constants/time';
import { Poll } from 'modules/polling/types';
import { cacheSet } from 'modules/cache/cache';
import { fetchPollTally } from 'modules/polling/api/fetchPollTally';
import { getIndexerSyncedThrough } from 'modules/gql/getIndexerSyncedThrough';
import { getPollTally } from '../getPollTally';

vi.mock('modules/cache/cache', () => ({ cacheSet: vi.fn() }));
vi.mock('modules/polling/api/fetchPollTally', () => ({ fetchPollTally: vi.fn() }));
vi.mock('modules/gql/getIndexerSyncedThrough', () => ({ getIndexerSyncedThrough: vi.fn() }));

const NOW_UNIX = Math.floor(Date.now() / 1000);
const endedPoll = {
  pollId: 1,
  startDate: new Date((NOW_UNIX - 7200) * 1000),
  endDate: new Date((NOW_UNIX - 3600) * 1000)
} as Poll;
const activePoll = {
  pollId: 2,
  startDate: new Date((NOW_UNIX - 3600) * 1000),
  endDate: new Date((NOW_UNIX + 3600) * 1000)
} as Poll;
const endUnixOf = (poll: Poll) => poll.endDate.getTime() / 1000;

const cachedTtl = () => (cacheSet as Mock).mock.calls[0][3];

describe('getPollTally', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchPollTally as Mock).mockResolvedValue({ numVoters: 1 });
  });

  it('caches an ended poll for a week once the indexer has processed past its end', async () => {
    (getIndexerSyncedThrough as Mock).mockResolvedValue(endUnixOf(endedPoll) + 1);

    await getPollTally(endedPoll, SupportedNetworks.MAINNET);

    expect(cachedTtl()).toBe(ONE_WEEK_IN_MS);
  });

  it('keeps the short cache for an ended poll while the indexer is behind its end', async () => {
    (getIndexerSyncedThrough as Mock).mockResolvedValue(endUnixOf(endedPoll) - 60);

    await getPollTally(endedPoll, SupportedNetworks.MAINNET);

    expect(cachedTtl()).toBe(ONE_MINUTE_IN_MS);
  });

  it('keeps the short cache when the indexer has only reached a block at the end timestamp', async () => {
    (getIndexerSyncedThrough as Mock).mockResolvedValue(endUnixOf(endedPoll));

    await getPollTally(endedPoll, SupportedNetworks.MAINNET);

    expect(cachedTtl()).toBe(ONE_MINUTE_IN_MS);
  });

  it('keeps the short cache when indexer progress is unknown', async () => {
    (getIndexerSyncedThrough as Mock).mockResolvedValue(0);

    await getPollTally(endedPoll, SupportedNetworks.MAINNET);

    expect(cachedTtl()).toBe(ONE_MINUTE_IN_MS);
  });

  it('checks indexer progress before reading the tally data', async () => {
    const order: string[] = [];
    (getIndexerSyncedThrough as Mock).mockImplementation(async () => {
      order.push('progress');
      return endUnixOf(endedPoll) + 1;
    });
    (fetchPollTally as Mock).mockImplementation(async () => {
      order.push('tally');
      return { numVoters: 1 };
    });

    await getPollTally(endedPoll, SupportedNetworks.MAINNET);

    expect(order).toEqual(['progress', 'tally']);
  });

  it('caches an active poll for a minute without checking indexer progress', async () => {
    await getPollTally(activePoll, SupportedNetworks.MAINNET);

    expect(cachedTtl()).toBe(ONE_MINUTE_IN_MS);
    expect(getIndexerSyncedThrough).not.toHaveBeenCalled();
  });
});
