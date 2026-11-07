/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import {
  claimDailyRelayedVote,
  getGaslessUnavailableReason,
  getGaslessDailyCap,
  isGaslessDisabled
} from '../gaslessLimits';
import { incrementGaslessCounter, readGaslessCounter, GaslessStoreUnavailableError } from '../gaslessStore';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { config } from 'lib/config';
import { SupportedNetworks } from 'modules/web3/constants/networks';

vi.mock('../gaslessStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../gaslessStore')>()),
  incrementGaslessCounter: vi.fn(),
  readGaslessCounter: vi.fn()
}));
vi.mock('modules/app/api/postRequestToDiscord');

const network = SupportedNetworks.MAINNET;

beforeEach(() => {
  vi.clearAllMocks();
  config.GASLESS_DISABLED = '';
  config.GASLESS_DAILY_CAP = '';
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

describe('claimDailyRelayedVote', () => {
  it('defaults to a cap of 75 and accepts an override', () => {
    expect(getGaslessDailyCap()).toBe(75);
    config.GASLESS_DAILY_CAP = '10';
    expect(getGaslessDailyCap()).toBe(10);
    config.GASLESS_DAILY_CAP = 'not-a-number';
    expect(getGaslessDailyCap()).toBe(75);
  });

  it('counts against a per-UTC-day key', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValue(1);

    await claimDailyRelayedVote(network);

    const today = new Date().toISOString().substring(0, 10);
    expect(incrementGaslessCounter).toHaveBeenCalledWith(
      network,
      `relayed-votes-${today}`,
      expect.any(Number)
    );
  });

  it('allows votes up to the cap and blocks the one after', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValueOnce(75).mockResolvedValueOnce(76);

    expect(await claimDailyRelayedVote(network)).toBe(true);
    expect(await claimDailyRelayedVote(network)).toBe(false);
  });

  it('alerts once when volume reaches the alert threshold', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValueOnce(30).mockResolvedValueOnce(31);

    await claimDailyRelayedVote(network);
    await claimDailyRelayedVote(network);

    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    expect((postRequestToDiscord as Mock).mock.calls[0][0]).toMatchObject({ notify: true });
    expect((postRequestToDiscord as Mock).mock.calls[0][0].content).toMatch(/relayed 30 votes today/);
  });

  it('alerts once when the cap is first hit', async () => {
    (incrementGaslessCounter as Mock).mockResolvedValueOnce(76).mockResolvedValueOnce(77);

    await claimDailyRelayedVote(network);
    await claimDailyRelayedVote(network);

    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    expect((postRequestToDiscord as Mock).mock.calls[0][0].content).toMatch(/daily cap of 75/);
  });
});

describe('getGaslessUnavailableReason', () => {
  it('is null when gasless voting can be used', async () => {
    (readGaslessCounter as Mock).mockResolvedValue(10);
    expect(await getGaslessUnavailableReason(network)).toBeNull();
  });

  it('reports the kill switch first', async () => {
    config.GASLESS_DISABLED = 'true';
    expect(await getGaslessUnavailableReason(network)).toBe('disabled');
    expect(readGaslessCounter).not.toHaveBeenCalled();
  });

  it('reports the daily cap once it is used up', async () => {
    (readGaslessCounter as Mock).mockResolvedValue(75);
    expect(await getGaslessUnavailableReason(network)).toBe('daily-cap');
  });

  it('reports a store outage', async () => {
    (readGaslessCounter as Mock).mockRejectedValue(new GaslessStoreUnavailableError('timeout'));
    expect(await getGaslessUnavailableReason(network)).toBe('store-unavailable');
  });
});
