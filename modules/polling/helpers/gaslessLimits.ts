/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { config } from 'lib/config';
import logger from 'lib/logger';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { ONE_DAY_IN_MS } from 'modules/app/constants/time';
import {
  incrementGaslessCounter,
  decrementGaslessCounter,
  readGaslessCounter,
  GaslessStoreUnavailableError
} from './gaslessStore';

const DEFAULT_DAILY_CAP = 75;
const DEFAULT_DAILY_ALERT_THRESHOLD = 30;

export type GaslessUnavailableReason = 'disabled' | 'store-unavailable' | 'daily-cap';

export const isGaslessDisabled = (): boolean => config.GASLESS_DISABLED.toLowerCase() === 'true';

function readLimit(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const getGaslessDailyCap = (): number => readLimit(config.GASLESS_DAILY_CAP, DEFAULT_DAILY_CAP);

export const getGaslessDailyAlertThreshold = (): number =>
  readLimit(config.GASLESS_DAILY_ALERT_THRESHOLD, DEFAULT_DAILY_ALERT_THRESHOLD);

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
 * Counts one relayed vote against today's (UTC) cap. Returns false once the cap is used up.
 * Alerts once when daily volume reaches the alert threshold and once when the cap is first hit.
 */
export async function claimDailyRelayedVote(network: SupportedNetworks): Promise<boolean> {
  const count = await incrementGaslessCounter(network, dailyVotesKey(), 2 * ONE_DAY_IN_MS);
  const cap = getGaslessDailyCap();
  const alertThreshold = getGaslessDailyAlertThreshold();

  if (count === alertThreshold) {
    await alertGasless(
      `Gasless voting on ${network} has relayed ${count} votes today (UTC), above the normal daily volume.`
    );
  }
  if (count === cap + 1) {
    await alertGasless(
      `Gasless voting on ${network} hit its daily cap of ${cap} relayed votes. Gasless votes are blocked until 00:00 UTC.`
    );
  }
  return count <= cap;
}

/** Returns a claimed vote to today's cap when the relayer never sent it. */
export const releaseDailyRelayedVote = (network: SupportedNetworks): Promise<void> =>
  decrementGaslessCounter(network, dailyVotesKey());

/** Whether a gasless vote would be accepted right now, for precheck and the review UI. */
export async function getGaslessUnavailableReason(
  network: SupportedNetworks
): Promise<GaslessUnavailableReason | null> {
  if (isGaslessDisabled()) return 'disabled';
  try {
    const count = await readGaslessCounter(network, dailyVotesKey());
    return count >= getGaslessDailyCap() ? 'daily-cap' : null;
  } catch (err) {
    if (err instanceof GaslessStoreUnavailableError) {
      logger.error(`[gasless] ${err.message}`);
      return 'store-unavailable';
    }
    throw err;
  }
}
