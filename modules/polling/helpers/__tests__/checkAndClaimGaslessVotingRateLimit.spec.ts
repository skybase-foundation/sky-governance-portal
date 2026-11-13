/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { checkAndClaimGaslessVotingRateLimit } from '../checkAndClaimGaslessVotingRateLimit';
import { claimGaslessSlot } from '../gaslessStore';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { GASLESS_RATE_LIMIT_IN_MS } from 'modules/polling/polling.constants';
import { vi, Mock } from 'vitest';

vi.mock('../gaslessStore');

describe('checkAndClaimGaslessVotingRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when the slot is claimed', async () => {
    (claimGaslessSlot as Mock).mockResolvedValue(true);

    expect(await checkAndClaimGaslessVotingRateLimit('0xABC', SupportedNetworks.MAINNET)).toBe(false);
  });

  it('returns true when the voter is inside the cooldown', async () => {
    (claimGaslessSlot as Mock).mockResolvedValue(false);

    expect(await checkAndClaimGaslessVotingRateLimit('0xABC', SupportedNetworks.MAINNET)).toBe(true);
  });

  it('claims a lowercased per-voter key for the cooldown window', async () => {
    (claimGaslessSlot as Mock).mockResolvedValue(true);

    await checkAndClaimGaslessVotingRateLimit('0xABC', SupportedNetworks.MAINNET);

    expect(claimGaslessSlot).toHaveBeenCalledWith(
      SupportedNetworks.MAINNET,
      'recently-used-gasless-voting-0xabc',
      expect.any(String),
      GASLESS_RATE_LIMIT_IN_MS
    );
  });

  it('lets a store outage propagate instead of allowing the vote', async () => {
    (claimGaslessSlot as Mock).mockRejectedValue(new Error('store down'));

    await expect(checkAndClaimGaslessVotingRateLimit('0xABC', SupportedNetworks.MAINNET)).rejects.toThrow(
      'store down'
    );
  });
});
