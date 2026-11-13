/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { config } from 'lib/config';
import logger from 'lib/logger';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { ONE_DAY_IN_MS } from 'modules/app/constants/time';
import { incrementGaslessCounter, GaslessStoreUnavailableError } from './gaslessStore';
import { getRecentGaslessVote } from './checkAndClaimGaslessVotingRateLimit';

const DAILY_ALERT_THRESHOLD = 30;

export type GaslessUnavailableReason = 'disabled' | 'store-unavailable';

export const isGaslessDisabled = (): boolean => config.GASLESS_DISABLED.toLowerCase() === 'true';

const dailyVotesKey = (date = new Date()) => `relayed-votes-${date.toISOString().substring(0, 10)}`;

export async function alertGasless(content: string): Promise<void> {
  if (!config.GASLESS_WEBHOOK_URL) {
    logger.warn(`[gasless] alert (no webhook configured): ${content}`);
    return;
  }
  try {
    await postRequestToDiscord({ url: config.GASLESS_WEBHOOK_URL, content, notify: true });
  } catch (err) {
    logger.error('[gasless] failed to post Discord alert', (err as Error).message);
  }
}

/**
 * Counts a relayed vote toward today's (UTC) total and alerts once when it reaches the alert threshold.
 * The vote has already been sent, so a failure here is only logged.
 */
export async function countRelayedVote(network: SupportedNetworks): Promise<void> {
  try {
    const count = await incrementGaslessCounter(network, dailyVotesKey(), 2 * ONE_DAY_IN_MS);
    if (count === DAILY_ALERT_THRESHOLD) {
      await alertGasless(
        `Gasless voting on ${network} has relayed ${count} votes today (UTC), above the normal daily volume.`
      );
    }
  } catch (err) {
    logger.error('[gasless] unable to count the relayed vote', (err as Error).message);
  }
}

/** Whether a gasless vote would be accepted right now, and the voter's last gasless vote inside the cooldown. */
export async function getGaslessStatus(
  voter: string,
  network: SupportedNetworks
): Promise<{ unavailableReason: GaslessUnavailableReason | null; recentlyUsedGaslessVoting: string | null }> {
  if (isGaslessDisabled()) return { unavailableReason: 'disabled', recentlyUsedGaslessVoting: null };
  try {
    return { unavailableReason: null, recentlyUsedGaslessVoting: await getRecentGaslessVote(voter, network) };
  } catch (err) {
    if (!(err instanceof GaslessStoreUnavailableError)) throw err;
    logger.error(`[gasless] ${err.message}`);
    return { unavailableReason: 'store-unavailable', recentlyUsedGaslessVoting: null };
  }
}
