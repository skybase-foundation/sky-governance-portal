/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import {
  countRelayedVote,
  getGaslessDailyAlertThreshold,
  getGaslessStatus,
  isGaslessDisabled
} from '../gaslessLimits';
import { incrementGaslessCounter, GaslessStoreUnavailableError } from '../gaslessStore';
import { getRecentGaslessVote } from '../checkAndClaimGaslessVotingRateLimit';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { config } from 'lib/config';
import { SupportedNetworks } from 'modules/web3/constants/networks';

vi.mock('../gaslessStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../gaslessStore')>()),
  incrementGaslessCounter: vi.fn()
}));
vi.mock('../checkAndClaimGaslessVotingRateLimit');
vi.mock('modules/app/api/postRequestToDiscord');

const network = SupportedNetworks.MAINNET;
const voter = '0xabc';

beforeEach(() => {
  vi.clearAllMocks();
  config.GASLESS_DISABLED = '';
  config.GASLESS_DAILY_ALERT_THRESHOLD = '';
  config.GASLESS_WEBHOOK_URL = 'https://discord.example/hook';
});

describe('isGaslessDisabled', () => {
  it('reads GASLESS_DISABLED case-insensitively', () => {
    expect(isGaslessDisabled()).toBe(false);
    config.GASLESS_DISABLED = 'TRUE';
    expect(isGaslessDisabled()).toBe(true);
    config.GASLESS_DISABLED = 'false';
    expect(isGaslessDisabled()).toBe(false);
  });
});

describe('countRelayedVote', () => {
  it('defaults the alert threshold to 30 and accepts an override', () => {
    expect(getGaslessDailyAlertThreshold()).toBe(30);
    config.GASLESS_DAILY_ALERT_THRESHOLD = '10';
    expect(getGaslessDailyAlertThreshold()).toBe(10);
    config.GASLESS_DAILY_ALERT_THRESHOLD = 'not-a-number';
    expect(getGaslessDailyAlertThreshold()).toBe(30);
  });

  it('counts against a per-UTC-day key', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValue(1);

    await countRelayedVote(network);

    const today = new Date().toISOString().substring(0, 10);
    expect(incrementGaslessCounter).toHaveBeenCalledWith(
      network,
      `relayed-votes-${today}`,
      expect.any(Number)
    );
  });

  it('alerts once when volume reaches the alert threshold', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValueOnce(30).mockResolvedValueOnce(31);

    await countRelayedVote(network);
    await countRelayedVote(network);

    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    expect((postRequestToDiscord as Mock).mock.calls[0][0]).toMatchObject({ notify: true });
    expect((postRequestToDiscord as Mock).mock.calls[0][0].content).toMatch(/relayed 30 votes today/);
  });

  it('does not throw when the store is down', async () => {
    (incrementGaslessCounter as Mock).mockRejectedValue(new GaslessStoreUnavailableError('timeout'));

    await expect(countRelayedVote(network)).resolves.toBeUndefined();
    expect(postRequestToDiscord).not.toHaveBeenCalled();
  });
});

describe('getGaslessStatus', () => {
  it('is available and returns the last gasless vote inside the cooldown', async () => {
    (getRecentGaslessVote as Mock).mockResolvedValue('1794000000000');

    expect(await getGaslessStatus(voter, network)).toEqual({
      unavailableReason: null,
      recentlyUsedGaslessVoting: '1794000000000'
    });
    expect(getRecentGaslessVote).toHaveBeenCalledWith(voter, network);
  });

  it('reports the kill switch without reading the store', async () => {
    config.GASLESS_DISABLED = 'true';

    expect(await getGaslessStatus(voter, network)).toEqual({
      unavailableReason: 'disabled',
      recentlyUsedGaslessVoting: null
    });
    expect(getRecentGaslessVote).not.toHaveBeenCalled();
  });

  it('reports a store outage', async () => {
    (getRecentGaslessVote as Mock).mockRejectedValue(new GaslessStoreUnavailableError('timeout'));

    expect(await getGaslessStatus(voter, network)).toEqual({
      unavailableReason: 'store-unavailable',
      recentlyUsedGaslessVoting: null
    });
  });
});
