/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import precheckHandler from '../precheck';
import { getGaslessUnavailableReason } from 'modules/polling/helpers/gaslessLimits';
import { getRecentGaslessVote } from 'modules/polling/helpers/checkAndClaimGaslessVotingRateLimit';
import { hasSkyRequiredVotingWeight } from 'modules/polling/helpers/hasSkyRequiredVotingWeight';
import { ballotIncludesAlreadyVoted } from 'modules/polling/helpers/ballotIncludesAlreadyVoted';
import { getRelayerBalance } from 'modules/polling/api/getRelayerBalance';

vi.mock('modules/polling/helpers/gaslessLimits');
vi.mock('modules/polling/helpers/checkAndClaimGaslessVotingRateLimit');
vi.mock('modules/polling/helpers/hasSkyRequiredVotingWeight');
vi.mock('modules/polling/helpers/ballotIncludesAlreadyVoted');
vi.mock('modules/polling/api/getRelayerBalance');

const voter = '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E';

async function precheck() {
  const { req, res }: { req: NextApiRequest; res: NextApiResponse } = createMocks({
    method: 'GET',
    query: { network: 'mainnet', voter, pollIds: '1,2' }
  });
  await precheckHandler(req, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getGaslessUnavailableReason as Mock).mockResolvedValue(null);
  (getRecentGaslessVote as Mock).mockResolvedValue(null);
  (hasSkyRequiredVotingWeight as Mock).mockResolvedValue(true);
  (ballotIncludesAlreadyVoted as Mock).mockResolvedValue(false);
  (getRelayerBalance as Mock).mockResolvedValue('0.5');
});

describe('/api/polling/precheck', () => {
  it('reports gasless voting as available', async () => {
    const res = await precheck();

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      recentlyUsedGaslessVoting: null,
      hasSkyRequired: true,
      alreadyVoted: false,
      relayBalance: '0.5',
      gaslessDisabled: false,
      gaslessUnavailableReason: null
    });
  });

  it.each(['disabled', 'daily-cap', 'store-unavailable'])(
    'reports gasless voting as disabled when the reason is %s',
    async reason => {
      (getGaslessUnavailableReason as Mock).mockResolvedValue(reason);

      const data = (await precheck())._getJSONData();

      expect(data.gaslessDisabled).toBe(true);
      expect(data.gaslessUnavailableReason).toBe(reason);
    }
  );

  it('returns the last gasless vote time inside the cooldown', async () => {
    (getRecentGaslessVote as Mock).mockResolvedValue('1794000000000');

    expect((await precheck())._getJSONData().recentlyUsedGaslessVoting).toBe('1794000000000');
    expect(getRecentGaslessVote).toHaveBeenCalledWith(voter.toLowerCase(), 'mainnet');
  });

  it('skips the cooldown read when the store is down', async () => {
    (getGaslessUnavailableReason as Mock).mockResolvedValue('store-unavailable');

    expect((await precheck())._getJSONData().recentlyUsedGaslessVoting).toBeNull();
    expect(getRecentGaslessVote).not.toHaveBeenCalled();
  });
});
