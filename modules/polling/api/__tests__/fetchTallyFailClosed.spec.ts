/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, describe, expect, it, vi } from 'vitest';
import { PollInputFormat, PollResultDisplay, PollVictoryConditions } from 'modules/polling/polling.constants';
import { Poll } from 'modules/polling/types';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchPollTally } from '../fetchPollTally';

vi.mock('modules/gql/gqlRequest');

const poll: Poll = {
  pollId: 1,
  options: { '0': 'Abstain', '1': 'Yes', '2': 'No' },
  parameters: {
    inputFormat: { type: PollInputFormat.singleChoice, abstain: [0], options: [] },
    resultDisplay: PollResultDisplay.singleVoteBreakdown,
    victoryConditions: [{ type: PollVictoryConditions.plurality }]
  }
} as any as Poll;

describe('fetchPollTally', () => {
  it('fails instead of tallying without the delegate mapping when the delegate fetch fails', async () => {
    (gqlRequest as Mock).mockRejectedValueOnce(new Error('indexer unavailable'));

    await expect(fetchPollTally(poll, SupportedNetworks.MAINNET)).rejects.toThrow('indexer unavailable');
  });
});
