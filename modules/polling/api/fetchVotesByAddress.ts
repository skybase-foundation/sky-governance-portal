/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { SupportedNetworks } from 'modules/web3/constants/networks';
import { PollTallyVote } from '../types';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { voteAddressSkyWeightsAtTime } from 'modules/gql/queries/subgraph/voteAddressSkyWeightsAtTime';
import { allMainnetVoters } from 'modules/gql/queries/subgraph/allMainnetVoters';
import { allArbitrumVoters } from 'modules/gql/queries/subgraph/allArbitrumVoters';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { parseRawOptionId } from '../helpers/parseRawOptionId';
import { formatEther } from 'viem';
import { SupportedChainId } from 'modules/web3/constants/chainID';
import { stripChainIdPrefix } from 'modules/gql/gqlUtils';
import { fetchAllPages, INDEXER_PAGE_SIZE } from 'modules/gql/fetchAllPages';

interface VoterData {
  id: string;
  address?: string;
}

interface VoteData {
  id: string;
  voter: VoterData;
  choice: string;
  blockTime: number;
  txnHash: string;
}

interface MainnetVoteData {
  id: string;
  voter: VoterData;
  choice: string;
  blockTime: number;
  txnHash: string;
}

interface MainnetVotersResponse {
  pollVotes: MainnetVoteData[];
}

interface ArbitrumPollData {
  startDate: number;
  endDate: number;
  votes: VoteData[];
}

interface ArbitrumVotersResponse {
  arbitrumPoll: ArbitrumPollData;
}

interface VotingPowerChange {
  newBalance: string;
}

interface VoterWithWeight {
  id: string;
  address?: string;
  v2VotingPowerChanges: VotingPowerChange[];
}

interface SkyWeightsResponse {
  voters: VoterWithWeight[];
}

export async function fetchVotesByAddressForPoll(
  pollId: number,
  delegateOwnerToAddress: Record<string, string>,
  network: SupportedNetworks
): Promise<PollTallyVote[]> {
  const mainnetChainId = networkNameToChainId(network);
  const arbitrumChainId =
    network === SupportedNetworks.MAINNET ? SupportedChainId.ARBITRUM : SupportedChainId.ARBITRUMTESTNET;

  let arbitrumPoll = null as ArbitrumPollData | null;

  const [mainnetVotes, arbitrumVotes] = await Promise.all([
    fetchAllPages(async cursor => {
      const response = await gqlRequest<MainnetVotersResponse>({
        chainId: mainnetChainId,
        query: allMainnetVoters(mainnetChainId, pollId.toString(), cursor)
      });
      return response.pollVotes || [];
    }),
    fetchAllPages(async cursor => {
      const response = await gqlRequest<ArbitrumVotersResponse>({
        chainId: arbitrumChainId,
        query: allArbitrumVoters(arbitrumChainId, pollId.toString(), cursor)
      });
      arbitrumPoll = response.arbitrumPoll;
      return response.arbitrumPoll?.votes || [];
    })
  ]);

  // Envio returns numeric fields as strings; coerce so the window comparisons stay numeric.
  const startUnix =
    arbitrumPoll?.startDate != null ? Number(arbitrumPoll.startDate) : Number.NEGATIVE_INFINITY;
  const endUnix = arbitrumPoll?.endDate != null ? Number(arbitrumPoll.endDate) : Number.POSITIVE_INFINITY;

  const isVoteWithinPollTimeframe = vote => {
    const blockTime = Number(vote.blockTime);
    return blockTime >= startUnix && blockTime <= endUnix;
  };
  const getVoterAddress = (voter: VoterData | VoterWithWeight) =>
    voter.address || stripChainIdPrefix(voter.id);
  const mapToDelegateAddress = (voterAddress: string) => delegateOwnerToAddress[voterAddress] || voterAddress;

  // Neither polling contract enforces the poll window on-chain, so the indexer returns votes cast
  // outside it. Drop them before the dedupe below, which keeps the latest blockTime per voter and
  // would otherwise let a post-close ballot replace a legitimate one.
  const mainnetVotesInPollTimeframe = mainnetVotes.filter(isVoteWithinPollTimeframe);
  const arbitrumVotesInPollTimeframe = arbitrumVotes.filter(isVoteWithinPollTimeframe);

  // Normalize voters to the delegate contract address used for dedupe and weight lookup.
  const mainnetVoterAddresses = mainnetVotesInPollTimeframe.map(vote => getVoterAddress(vote.voter));
  const arbitrumVoterAddresses = arbitrumVotesInPollTimeframe.map(vote =>
    mapToDelegateAddress(getVoterAddress(vote.voter))
  );

  const allVoterAddresses = [...mainnetVoterAddresses, ...arbitrumVoterAddresses];

  const normalizeVoteVoterAddress = (vote, chainId, voterAddress = getVoterAddress(vote.voter)) => ({
    ...vote,
    chainId,
    voter: { ...vote.voter, id: voterAddress, address: voterAddress }
  });

  const mainnetVotesWithChainId = mainnetVotesInPollTimeframe.map(vote =>
    normalizeVoteVoterAddress(vote, mainnetChainId)
  );

  const arbitrumVotesTaggedWithChainId = arbitrumVotesInPollTimeframe.map(vote => {
    const mappedAddress = mapToDelegateAddress(getVoterAddress(vote.voter));
    return normalizeVoteVoterAddress(vote, arbitrumChainId, mappedAddress);
  });

  const allVotes = [...mainnetVotesWithChainId, ...arbitrumVotesTaggedWithChainId];
  const dedupedVotes = Object.values(
    allVotes.reduce((acc, vote) => {
      const voterAddr = vote.voter.address;
      if (!acc[voterAddr] || Number(vote.blockTime) > Number(acc[voterAddr].blockTime)) {
        acc[voterAddr] = vote;
      }
      return acc;
    }, {} as Record<string, (typeof allVotes)[0]>)
  );

  // One Voter row per address, so chunks no larger than a page cannot hit the indexer's row cap.
  const uniqueVoterAddresses = [...new Set(allVoterAddresses)];
  const voterAddressChunks: string[][] = [];
  for (let i = 0; i < uniqueVoterAddresses.length; i += INDEXER_PAGE_SIZE) {
    voterAddressChunks.push(uniqueVoterAddresses.slice(i, i + INDEXER_PAGE_SIZE));
  }

  const skyWeightsResponses = await Promise.all(
    voterAddressChunks.map(chunk =>
      gqlRequest<SkyWeightsResponse>({
        chainId: mainnetChainId,
        query: voteAddressSkyWeightsAtTime(mainnetChainId, chunk, endUnix)
      })
    )
  );

  const votersWithWeights = skyWeightsResponses.flatMap(response => response.voters || []);

  const votesWithWeights = dedupedVotes.map((vote: (typeof allVotes)[0]) => {
    const voterId = vote.voter.address;
    const voterData = votersWithWeights.find(voter => getVoterAddress(voter) === voterId);
    const votingPowerChanges = voterData?.v2VotingPowerChanges || [];
    const skySupport = votingPowerChanges.length > 0 ? votingPowerChanges[0].newBalance : '0';

    const ballot = parseRawOptionId(vote.choice.toString());
    return {
      skySupport,
      ballot,
      pollId,
      voter: voterId,
      chainId: vote.chainId,
      blockTimestamp: vote.blockTime,
      hash: vote.txnHash
    };
  });
  return votesWithWeights
    .sort((a, b) => (BigInt(a.skySupport) < BigInt(b.skySupport) ? 1 : -1))
    .map(vote => ({
      ...vote,
      skySupport: formatEther(BigInt(vote.skySupport))
    }));
}
