/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { PollInputFormat, PollResultDisplay, PollVictoryConditions } from 'modules/polling/polling.constants';
import { Poll } from 'modules/polling/types';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { gqlRequest } from '../../../../modules/gql/gqlRequest';
import { mockTallyIndexer } from './__helpers__/mockTallyIndexer';
import { fetchPollTally } from '../fetchPollTally';
import { Mock, vi } from 'vitest';

vi.mock('modules/gql/gqlRequest');

const mockVotes = (votes: { voter: string; choice: string; sky: string }[]) => {
  mockTallyIndexer(gqlRequest as Mock, {
    delegates: {},
    mainnet: { pollVotes: [] },
    arbitrum: {
      arbitrumPoll: {
        startDate: 50,
        endDate: 200,
        votes: votes.map(v => ({ voter: { id: v.voter }, choice: v.choice, blockTime: 100 }))
      }
    },
    weights: {
      voters: votes.map(v => ({
        id: v.voter,
        v2VotingPowerChanges: [{ newBalance: `${v.sky}000000000000000000` }]
      }))
    }
  });
};

describe('Fetch tally with option 0 as the winner', () => {
  it('reports option 0 when it wins a plurality outright', async () => {
    const poll = {
      pollId: 1,
      options: { '0': 'Yes', '1': 'No' },
      parameters: {
        inputFormat: { type: PollInputFormat.singleChoice, abstain: [], options: [] },
        resultDisplay: PollResultDisplay.singleVoteBreakdown,
        victoryConditions: [{ type: PollVictoryConditions.plurality }]
      }
    } as any as Poll;

    mockVotes([
      { voter: '0x123', choice: '0', sky: '60' },
      { voter: '0x456', choice: '1', sky: '40' }
    ]);

    const result = await fetchPollTally(poll, SupportedNetworks.MAINNET);

    expect(result).toEqual(
      expect.objectContaining({ winner: 0, winningOptionName: 'Yes', victoryConditionMatched: 0 })
    );
    expect(result.results[0]).toEqual(expect.objectContaining({ optionId: 0, winner: true }));
  });

  it('reports option 0 when it is the default fallback', async () => {
    const poll = {
      pollId: 2,
      options: { '0': 'Abstain', '1': 'First', '2': 'Second', '3': 'Third' },
      parameters: {
        inputFormat: { type: PollInputFormat.singleChoice, abstain: [0], options: [] },
        resultDisplay: PollResultDisplay.singleVoteBreakdown,
        victoryConditions: [
          { type: PollVictoryConditions.majority, percent: 50 },
          { type: PollVictoryConditions.default, value: 0 }
        ]
      }
    } as any as Poll;

    mockVotes([
      { voter: '0x123', choice: '1', sky: '40' },
      { voter: '0x456', choice: '2', sky: '35' },
      { voter: '0x789', choice: '3', sky: '25' }
    ]);

    const result = await fetchPollTally(poll, SupportedNetworks.MAINNET);

    expect(result).toEqual(
      expect.objectContaining({ winner: 0, winningOptionName: 'Abstain', victoryConditionMatched: 1 })
    );
  });
});
