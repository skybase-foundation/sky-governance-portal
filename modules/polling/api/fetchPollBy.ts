/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { cacheGet, cacheSet } from 'modules/cache/cache';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { Poll, PollListItem } from '../types';
import { pollDetailsCacheKey, pollListCacheKey } from 'modules/cache/constants/cache-keys';
import { refetchPolls } from './fetchPolls';
import { ONE_WEEK_IN_MS } from 'modules/app/constants/time';
import { matterWrapper } from 'lib/matter';
import { markdownToHtml } from 'lib/markdown';
import { getPollTags } from './getPollTags';

// The previous/next polls are looked up by pollId, the poll list is not guaranteed to be in poll order
function getPollCtx(pollList: PollListItem[], pollId: number): Poll['ctx'] {
  let prev: PollListItem | undefined;
  let next: PollListItem | undefined;

  for (const entry of pollList) {
    if (entry.pollId < pollId && (!prev || entry.pollId > prev.pollId)) prev = entry;
    if (entry.pollId > pollId && (!next || entry.pollId < next.pollId)) next = entry;
  }

  return {
    prev: prev ? { slug: prev.slug } : null,
    next: next ? { slug: next.slug } : null
  };
}

export async function fetchSinglePoll(
  network: SupportedNetworks,
  pollIdOrSlug: number | string
): Promise<Poll | null> {
  if (!pollIdOrSlug) {
    return null;
  }

  const pollListString = await cacheGet(pollListCacheKey, network, ONE_WEEK_IN_MS);
  let pollList: PollListItem[] = [];

  if (pollListString) {
    pollList = JSON.parse(pollListString);
  } else {
    const { pollList: refetchedPollList } = await refetchPolls(network);
    pollList = refetchedPollList;
  }

  const parsedPollIdentifier = typeof pollIdOrSlug === 'number' ? pollIdOrSlug : parseInt(pollIdOrSlug);
  // If it's a number, the parameter passed is a pollId. If not, it's a pollSlug
  const pollId: number | null = !Number.isNaN(parsedPollIdentifier)
    ? parsedPollIdentifier
    : pollList.find(p => p.slug === pollIdOrSlug)?.pollId || null;

  if (!pollId) {
    return null;
  }

  const cachedPoll = await cacheGet(pollDetailsCacheKey, network, ONE_WEEK_IN_MS, 'HGET', String(pollId));
  if (cachedPoll) {
    // The cached ctx goes stale when the poll list changes (e.g. a new poll is added), so it's derived on every read
    return { ...JSON.parse(cachedPoll), ctx: getPollCtx(pollList, pollId) };
  }

  // If poll is not cached, fetch individual poll
  const pollInList = pollList.find(entry => entry.pollId === pollId);
  if (!pollInList) {
    return null;
  }

  const pollMdDoc = await (await fetch(pollInList.url)).text();

  const { content } = matterWrapper(pollMdDoc);
  const html = await markdownToHtml(content);

  const pollTags = await getPollTags();

  const poll = {
    ...pollInList,
    startDate: new Date(pollInList.startDate),
    endDate: new Date(pollInList.endDate),
    content: html,
    tags: pollInList.tags.map(tag => pollTags.find(pollTag => pollTag.id === tag)).filter(tag => !!tag),
    ctx: getPollCtx(pollList, pollId)
  };

  // Individual polls contain more metadata than the poll-list array and are used to render the poll detail page.
  // They are stored as multiple hashes for a same cache key for improved performance when setting and getting them.
  cacheSet(
    pollDetailsCacheKey,
    JSON.stringify(poll),
    network,
    ONE_WEEK_IN_MS,
    'HSET',
    poll.pollId.toString()
  );

  return poll;
}
