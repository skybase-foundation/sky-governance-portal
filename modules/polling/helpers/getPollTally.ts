/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { SupportedNetworks } from 'modules/web3/constants/networks';
import { cacheSet } from 'modules/cache/cache';
import { fetchPollTally } from 'modules/polling/api/fetchPollTally';
import { Poll, PollTally } from 'modules/polling/types';
import { getPollTallyCacheKey } from 'modules/cache/constants/cache-keys';
import { pollHasEnded } from './utils';
import { ONE_WEEK_IN_MS, ONE_MINUTE_IN_MS } from 'modules/app/constants/time';
import { getIndexerSyncedThrough } from 'modules/gql/getIndexerSyncedThrough';

export async function getPollTally(poll: Poll, network: SupportedNetworks): Promise<PollTally> {
  // Read indexer progress before the tally data, so the data is at least as fresh as the progress we check.
  // An ended poll's tally is only cached as final once the indexer has processed every block up to the end.
  const pollEndUnix = new Date(poll.endDate).getTime() / 1000;
  const isFinal = pollHasEnded(poll) && (await getIndexerSyncedThrough(network)) > pollEndUnix;

  const tally: PollTally = await fetchPollTally(poll, network);

  const cacheKey = getPollTallyCacheKey(poll.pollId);
  cacheSet(cacheKey, JSON.stringify(tally), network, isFinal ? ONE_WEEK_IN_MS : ONE_MINUTE_IN_MS);

  return tally;
}
