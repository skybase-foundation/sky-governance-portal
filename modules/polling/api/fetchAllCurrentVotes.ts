/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import chunk from 'lodash/chunk';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchAllPages, INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';
import { allMainnetVotes } from 'modules/gql/queries/subgraph/allMainnetVotes';
import { allArbitrumVotes } from 'modules/gql/queries/subgraph/allArbitrumVotes';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId, getGaslessNetwork } from 'modules/web3/helpers/chain';
import { parseRawOptionId } from '../helpers/parseRawOptionId';
import { PollTallyVote } from '../types';
import { getAddressInfo } from 'modules/address/api/getAddressInfo';
import { votingWeightsAtTimes } from 'modules/gql/queries/subgraph/votingWeightsAtTimes';
import { formatEther } from 'viem';
import { getSkyPortalStartDate } from 'modules/polling/polling.constants';
import { pollTimes } from 'modules/gql/queries/subgraph/pollTimes';

interface PollVoteResponse {
  id: string;
  poll: {
    id: string;
    pollId: string;
  };
  choice: string;
  blockTime: string;
  txnHash: string;
}

interface MainnetVotesResponse {
  pollVotes: PollVoteResponse[];
}

interface ArbitrumPollVoteResponse extends PollVoteResponse {
  voter: {
    id: string;
  };
}

interface ArbitrumVotesResponse {
  arbitrumPollVotes: ArbitrumPollVoteResponse[];
}

type VotingWeightsAtTimesResponse = Record<string, { newBalance: string }[]>;

interface PollTimesResponse {
  arbitrumPolls: {
    startDate?: string;
    endDate?: string;
    id: string;
    pollId: string;
  }[];
}

const WEIGHT_LOOKUPS_PER_REQUEST = 100;

// Looks up the balance at each timestamp directly rather than fetching the whole balance history,
// which for large delegates runs to thousands of rows and is silently capped by the indexer.
async function fetchSkyWeightsAtTimes(
  chainId: number,
  address: string,
  timestamps: number[]
): Promise<Map<number, string>> {
  const weights = new Map<number, string>();
  await Promise.all(
    chunk([...new Set(timestamps)], WEIGHT_LOOKUPS_PER_REQUEST).map(async timestampChunk => {
      const response = await gqlRequest<VotingWeightsAtTimesResponse>({
        chainId,
        query: votingWeightsAtTimes(chainId, address, timestampChunk)
      });
      timestampChunk.forEach((unix, i) => weights.set(unix, response[`at${i}`]?.[0]?.newBalance || '0'));
    })
  );
  return weights;
}

function isValidVote(vote: PollVoteResponse, pollTimesData: PollTimesResponse): boolean {
  const pollId = vote.poll.pollId;
  const poll = pollTimesData.arbitrumPolls.find(p => p.pollId === pollId);
  const voteTime = Number(vote.blockTime);
  const pollStart = Number(poll?.startDate);
  const pollEnd = Number(poll?.endDate);
  return voteTime >= pollStart && voteTime <= pollEnd;
}

async function fetchAllCurrentVotesWithSubgraph(
  address: string,
  network: SupportedNetworks,
  startUnix: number
): Promise<PollTallyVote[]> {
  const addressInfo = await getAddressInfo(address, network);
  const delegateOwnerAddress = addressInfo?.delegateInfo?.address;
  const mainnetChainId = networkNameToChainId(network);
  const arbitrumChainId = networkNameToChainId(getGaslessNetwork(network));
  const [mainnetVotes, arbitrumVotes] = await Promise.all([
    fetchAllPages(async cursor => {
      const response = await gqlRequest<MainnetVotesResponse>({
        chainId: mainnetChainId,
        query: allMainnetVotes(mainnetChainId, address.toLowerCase(), startUnix, cursor)
      });
      return response.pollVotes || [];
    }),
    fetchAllPages(async cursor => {
      const response = await gqlRequest<ArbitrumVotesResponse>({
        chainId: arbitrumChainId,
        query: allArbitrumVotes(
          arbitrumChainId,
          delegateOwnerAddress ? delegateOwnerAddress.toLowerCase() : address.toLowerCase(),
          startUnix,
          cursor
        )
      });
      return response.arbitrumPollVotes || [];
    })
  ]);
  const mainnetVotesWithChainId = mainnetVotes.map(vote => ({
    ...vote,
    chainId: mainnetChainId
  }));
  const arbitrumVotesWithChainId = arbitrumVotes.map(vote => ({
    ...vote,
    chainId: arbitrumChainId
  }));
  const combinedVotes = [...mainnetVotesWithChainId, ...arbitrumVotesWithChainId];

  const dedupedVotes = Object.values(
    combinedVotes.reduce((acc, vote) => {
      const pollId = vote.poll.pollId;
      if (!acc[pollId] || Number(vote.blockTime) > Number(acc[pollId].blockTime)) {
        acc[pollId] = vote;
      }
      return acc;
    }, {} as Record<string, (typeof combinedVotes)[0]>)
  );

  //get the poll times for all polls voted in
  //This is a separate request because we needed to know the arbitrum poll ids first to pass in to the query
  const allPollIds = dedupedVotes.map(p => p.poll.pollId);
  const pollTimesResponses = await Promise.all(
    chunk(allPollIds, INDEXER_PAGE_SIZE).map(pollIdChunk =>
      gqlRequest<PollTimesResponse>({
        chainId: arbitrumChainId,
        query: pollTimes(arbitrumChainId, pollIdChunk)
      })
    )
  );
  const pollTimesRes: PollTimesResponse = {
    arbitrumPolls: pollTimesResponses.flatMap(response => response.arbitrumPolls)
  };

  const validVotes = dedupedVotes.filter(vote => isValidVote(vote, pollTimesRes));

  const getWeightTimestamp = (vote: (typeof validVotes)[0]) => {
    const poll = pollTimesRes.arbitrumPolls.find(p => p.pollId === vote.poll.pollId);
    return Number(poll?.endDate || vote.blockTime);
  };
  const weights = await fetchSkyWeightsAtTimes(
    mainnetChainId,
    address.toLowerCase(),
    validVotes.map(getWeightTimestamp)
  );

  const res: PollTallyVote[] = validVotes.map(o => {
    const ballot = parseRawOptionId(o.choice);
    const pollId = o.poll.pollId;
    const skySupport = weights.get(getWeightTimestamp(o)) || '0';

    return {
      pollId: Number(pollId),
      ballot,
      voter: address,
      hash: o.txnHash,
      blockTimestamp: Number(o.blockTime) * 1000,
      skySupport: Number(formatEther(BigInt(skySupport))),
      chainId: o.chainId
    };
  });
  return res;
}

export async function fetchAllCurrentVotes(
  address: string,
  network: SupportedNetworks
): Promise<PollTallyVote[]> {
  const cutoffUnix = Math.floor(getSkyPortalStartDate(network).getTime() / 1000);
  const subgraphVotes = await fetchAllCurrentVotesWithSubgraph(address, network, cutoffUnix);
  return subgraphVotes;
}
