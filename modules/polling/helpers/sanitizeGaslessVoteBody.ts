/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

/**
 * The fields of a gasless vote request that are safe to post to the ops
 * Discord webhook. The signature and the backdoor secret never leave the
 * server, and the ballot itself is reduced to its size.
 */
export function sanitizeGaslessVoteBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return {};
  const { voter, network, nonce, expiry, pollIds, optionIds, secret } = body as Record<string, unknown>;
  return {
    voter,
    network,
    nonce,
    expiry,
    pollCount: Array.isArray(pollIds) ? pollIds.length : undefined,
    optionCount: Array.isArray(optionIds) ? optionIds.length : undefined,
    usedSecret: typeof secret === 'string' && secret.length > 0
  };
}
