/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

/**
 * Regression test for Immunefi #82775.
 *
 * The polling contract emits a raw optionId that the app decodes byte-by-byte into
 * one ballot entry per byte. Without cardinality validation, a single-choice voter
 * could submit a raw value whose bytes repeat the same option (e.g. 0x0101...01) and
 * have their weight counted once per byte, multiplying their support for an option and
 * flipping the active poll winner.
 *
 * These tests exercise fetchPollTally end-to-end and assert that:
 *  - a duplicated-byte ballot is counted exactly once (no amplification, no winner flip);
 *  - a single-choice ballot that decodes to multiple distinct options is discarded.
 */

import { PollInputFormat, PollResultDisplay, PollVictoryConditions } from 'modules/polling/polling.constants';
import { Poll } from 'modules/polling/types';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { gqlRequest } from '../../../../modules/gql/gqlRequest';
import { mockTallyIndexer } from './__helpers__/mockTallyIndexer';
import { fetchPollTally } from '../fetchPollTally';
import { Mock, vi } from 'vitest';

vi.mock('modules/gql/gqlRequest');

// 0x0101010101010101 -> decodes to [1, 1, 1, 1, 1, 1, 1, 1] before dedup (8x amplification attempt)
const AMPLIFIED_YES_CHOICE = '72340172838076673';
// 0x0201 -> decodes to [1, 2]: two distinct options, invalid for a single-choice poll
const MULTI_OPTION_CHOICE = '513';

// Poll window enclosing every mocked vote; votes outside it are not counted.
const POLL_START = 50;
const POLL_END = 200;

const singleChoicePoll: Poll = {
  pollId: 1,
  options: {
    '0': 'Abstain',
    '1': 'Yes',
    '2': 'No'
  },
  parameters: {
    inputFormat: {
      type: PollInputFormat.singleChoice,
      abstain: [0],
      options: []
    },
    resultDisplay: PollResultDisplay.singleVoteBreakdown,
    victoryConditions: [
      {
        type: PollVictoryConditions.majority,
        percent: 50
      }
    ]
  }
} as any as Poll;

describe('Fetch tally - ballot amplification (Immunefi #82775)', () => {
  it('counts a duplicated-byte single-choice ballot once and does not flip the winner', async () => {
    mockTallyIndexer(gqlRequest as Mock, {
      delegates: {},
      mainnet: { pollVotes: [] },
      arbitrum: {
        arbitrumPoll: {
          startDate: POLL_START,
          endDate: POLL_END,
          votes: [
            // Attacker: small weight (10 SKY) on "Yes", raw choice packs 8 repeated bytes.
            { voter: { id: '0x123' }, choice: AMPLIFIED_YES_CHOICE, blockTime: 100 },
            // Honest voter: 60 SKY on "No".
            { voter: { id: '0x456' }, choice: '2', blockTime: 100 }
          ]
        }
      },
      weights: {
        voters: [
          { id: '0x123', v2VotingPowerChanges: [{ newBalance: '10000000000000000000' }] },
          { id: '0x456', v2VotingPowerChanges: [{ newBalance: '60000000000000000000' }] }
        ]
      }
    });

    const result = await fetchPollTally(singleChoicePoll, SupportedNetworks.MAINNET);

    const yes = result.results.find(r => r.optionId === 1);
    const no = result.results.find(r => r.optionId === 2);

    // "Yes" weight is counted once (10), not amplified to 80.
    expect(yes?.skySupport).toBe('10');
    expect(no?.skySupport).toBe('60');

    // Honest majority stands: "No" wins, the attacker does not flip the poll.
    expect(result.winner).toBe(2);
    expect(result.winningOptionName).toBe('No');
    expect(no?.winner).toBe(true);
    expect(yes?.winner).toBe(false);
    expect(result.numVoters).toBe(2);
  });

  it('discards a single-choice ballot that decodes to multiple distinct options', async () => {
    mockTallyIndexer(gqlRequest as Mock, {
      delegates: {},
      mainnet: { pollVotes: [] },
      arbitrum: {
        arbitrumPoll: {
          startDate: POLL_START,
          endDate: POLL_END,
          votes: [
            // Malformed single-choice ballot voting for options 1 and 2 at once, large weight.
            { voter: { id: '0x123' }, choice: MULTI_OPTION_CHOICE, blockTime: 100 },
            // Honest voter: 60 SKY on "No".
            { voter: { id: '0x456' }, choice: '2', blockTime: 100 }
          ]
        }
      },
      weights: {
        voters: [
          { id: '0x123', v2VotingPowerChanges: [{ newBalance: '100000000000000000000' }] },
          { id: '0x456', v2VotingPowerChanges: [{ newBalance: '60000000000000000000' }] }
        ]
      }
    });

    const result = await fetchPollTally(singleChoicePoll, SupportedNetworks.MAINNET);

    const yes = result.results.find(r => r.optionId === 1);
    const no = result.results.find(r => r.optionId === 2);

    // The malformed ballot is dropped entirely: it contributes to neither option nor participation.
    expect(yes?.skySupport).toBe('0');
    expect(no?.skySupport).toBe('60');
    expect(result.numVoters).toBe(1);
    expect(result.totalSkyParticipation).toBe('60');
    expect(result.winner).toBe(2);
  });
});

// The amplification vector was never single-choice specific: an approval (choose-free)
// poll counts every option in a ballot, so duplicated bytes would inflate an option there
// too. The dedup in parseRawOptionId neutralizes this for every format, while legitimate
// multi-option approval ballots must still count each distinct option once.
const chooseFreePoll: Poll = {
  pollId: 2,
  options: {
    '0': 'Abstain',
    '1': 'Option A',
    '2': 'Option B'
  },
  parameters: {
    inputFormat: {
      type: PollInputFormat.chooseFree,
      abstain: [0],
      options: []
    },
    resultDisplay: PollResultDisplay.approvalBreakdown,
    victoryConditions: [
      {
        type: PollVictoryConditions.majority,
        percent: 50
      }
    ]
  }
} as any as Poll;

describe('Fetch tally - approval poll is not amplifiable (Immunefi #82775)', () => {
  it('counts a duplicated-byte option once while still counting a legitimate multi-option ballot', async () => {
    mockTallyIndexer(gqlRequest as Mock, {
      delegates: {},
      mainnet: { pollVotes: [] },
      arbitrum: {
        arbitrumPoll: {
          startDate: POLL_START,
          endDate: POLL_END,
          votes: [
            // Honest voter legitimately approves both A and B (0x0201 -> [1, 2]), 40 SKY.
            { voter: { id: '0x123' }, choice: MULTI_OPTION_CHOICE, blockTime: 100 },
            // Attacker approves only A with 8 repeated bytes, 10 SKY.
            { voter: { id: '0x456' }, choice: AMPLIFIED_YES_CHOICE, blockTime: 100 }
          ]
        }
      },
      weights: {
        voters: [
          { id: '0x123', v2VotingPowerChanges: [{ newBalance: '40000000000000000000' }] },
          { id: '0x456', v2VotingPowerChanges: [{ newBalance: '10000000000000000000' }] }
        ]
      }
    });

    const result = await fetchPollTally(chooseFreePoll, SupportedNetworks.MAINNET);

    const optionA = result.results.find(r => r.optionId === 1);
    const optionB = result.results.find(r => r.optionId === 2);

    // Option A: 40 (honest) + 10 (attacker counted once) = 50, NOT 40 + 80.
    expect(optionA?.skySupport).toBe('50');
    // Option B: only the honest multi-option ballot counts it = 40.
    expect(optionB?.skySupport).toBe('40');
    expect(result.numVoters).toBe(2);
    expect(result.totalSkyParticipation).toBe('50');
  });
});
