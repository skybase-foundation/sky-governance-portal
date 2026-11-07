/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { getRecentlyUsedGaslessVotingKey } from 'modules/cache/constants/cache-keys';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { GASLESS_RATE_LIMIT_IN_MS } from 'modules/polling/polling.constants';
import { claimGaslessSlot, readGaslessSlot, releaseGaslessSlot } from './gaslessStore';

/**
 * Atomically checks and claims the rate limit slot for gasless voting.
 * Returns true if user is rate limited (key already existed),
 * false if slot was claimed successfully.
 * Throws GaslessStoreUnavailableError when the limit can't be checked.
 */
export async function checkAndClaimGaslessVotingRateLimit(
  voter: string,
  network: SupportedNetworks
): Promise<boolean> {
  const claimed = await claimGaslessSlot(
    network,
    getRecentlyUsedGaslessVotingKey(voter),
    JSON.stringify(Date.now()),
    GASLESS_RATE_LIMIT_IN_MS
  );
  return !claimed;
}

/** Timestamp (ms, as a string) of the voter's last gasless vote inside the cooldown, or null. */
export const getRecentGaslessVote = (voter: string, network: SupportedNetworks): Promise<string | null> =>
  readGaslessSlot(network, getRecentlyUsedGaslessVotingKey(voter));

export const releaseGaslessVotingRateLimit = (voter: string, network: SupportedNetworks): Promise<void> =>
  releaseGaslessSlot(network, getRecentlyUsedGaslessVotingKey(voter));
