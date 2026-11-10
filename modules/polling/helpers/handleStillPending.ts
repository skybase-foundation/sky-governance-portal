/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { parseGwei, numberToHex, toFunctionSelector } from 'viem';
import { config } from 'lib/config';
import { privySendTransaction } from 'lib/privyRest';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { getGaslessPublicClient } from 'modules/web3/helpers/getPublicClient';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { pollingArbitrumAddress } from 'modules/contracts/generated';
import { getPrivyWalletConfig } from './relayerCredentials';
import { alertGasless as alert, isGaslessDisabled } from './gaslessLimits';
import { claimGaslessSlot, GaslessStoreUnavailableError } from './gaslessStore';
import logger from 'lib/logger';

const BUMP_MULTIPLIER_NUM = 14n; // 1.4x as 14/10 to keep arithmetic in BigInt
const BUMP_MULTIPLIER_DEN = 10n;
const MAX_BUMP_ATTEMPTS = 2;
// Arbitrum's sequencer is FIFO and doesn't auction on priority fee, so legitimate priority
// fees are typically <0.01 gwei. 1 gwei is ~100× normal — a guardrail against malformed
// webhook payloads, not a target. Effective tip per gas = min(max_priority_fee, max_fee -
// base_fee), so capping priority alone bounds our overpayment; max_fee stays uncapped to
// stretch over any base-fee spike.
const ABSOLUTE_PRIORITY_FEE_CEILING = parseGwei('1');
// Additive floor for priority bumps: a multiplicative 1.4× bump on a 0 priority fee
// (Arbitrum's normal case) yields 0, which fails strict EIP-1559 replacement rules
// ("both max_fee and max_priority must be ≥ ~12.5% higher"). 0.01 gwei is well above
// Arbitrum's typical sub-0.01 gwei priority and costs a negligible fraction of a cent
// per gas — guarantees the priority field actually changes across attempts.
const MIN_PRIORITY_BUMP = parseGwei('0.01');
const BUMP_ATTEMPT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// vote.ts always builds calldata with this exact ABI signature (the EIP-712 signing variant
// of `vote`). Cross-checking the bump payload's data against this selector ensures the
// webhook can't be forged to redirect the relayer wallet's funds to an arbitrary contract
// call, even if PRIVY_WEBHOOK_SIGNING_SECRET leaks in isolation from PRIVY_APP_SECRET.
const EXPECTED_VOTE_SELECTOR = toFunctionSelector(
  'vote(address,uint256,uint256,uint256[],uint256[],uint8,bytes32,bytes32)'
);

// Webhook payload shape from Privy's transaction.still_pending event.
// Flat structure with transaction_request nested, all snake_case.
type StillPendingPayload = {
  type?: string;
  transaction_id: string;
  transaction_hash?: `0x${string}`;
  wallet_id: string;
  caip2: string;
  // Privy sends Quantity fields as 0x-prefixed hex strings on the wire.
  transaction_request: {
    chain_id?: number;
    to: string;
    data?: `0x${string}`;
    value?: `0x${string}`;
    nonce: number;
    gas_limit?: `0x${string}`;
    max_fee_per_gas?: `0x${string}`;
    max_priority_fee_per_gas?: `0x${string}`;
    type?: number | string;
  };
};

function networkForWalletId(walletId: string): SupportedNetworks {
  if (walletId && walletId === config.PRIVY_WALLET_ID_MAINNET) return SupportedNetworks.MAINNET;
  if (walletId && walletId === config.PRIVY_WALLET_ID_TESTNET) return SupportedNetworks.TENDERLY;
  throw new Error(`Unknown Privy wallet id: ${walletId}`);
}

// Keyed by the relayer nonce rather than transaction_id: each replacement gets a new
// transaction_id, so a per-id budget would reset with every bump.
async function claimAttemptSlot(lineage: string, network: SupportedNetworks): Promise<number | null> {
  for (let n = 1; n <= MAX_BUMP_ATTEMPTS; n++) {
    const claimed = await claimGaslessSlot(
      network,
      `bump-attempt-${lineage}-${n}`,
      Date.now().toString(),
      BUMP_ATTEMPT_TTL_MS
    );
    if (claimed) return n;
  }
  return null;
}

function bump(fee: bigint): bigint {
  return (fee * BUMP_MULTIPLIER_NUM) / BUMP_MULTIPLIER_DEN;
}

async function isAlreadyMined(network: SupportedNetworks, hash: string | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    const client = getGaslessPublicClient(networkNameToChainId(network));
    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
    return receipt != null;
  } catch {
    // No receipt yet (or RPC hiccup); treat as not-mined.
    return false;
  }
}

export async function handleStillPending(rawPayload: Record<string, unknown>): Promise<void> {
  const payload = rawPayload as unknown as StillPendingPayload;
  const { transaction_id, transaction_hash, wallet_id, caip2, transaction_request } = payload;

  if (isGaslessDisabled()) {
    logger.warn(`[gasless] gasless voting is disabled; not bumping tx ${transaction_id}`);
    return;
  }

  if (
    !transaction_id ||
    !wallet_id ||
    !caip2 ||
    !transaction_request ||
    !transaction_request.to ||
    transaction_request.nonce === undefined ||
    transaction_request.nonce === null
  ) {
    logger.error('[gasless] still_pending payload missing required fields', payload);
    return;
  }

  const network = networkForWalletId(wallet_id);
  const { caip2: configuredCaip2, chainId: configuredChainId } = getPrivyWalletConfig(network);
  if (caip2 !== configuredCaip2) {
    await alert(
      `Privy bump aborted: payload caip2 ${caip2} does not match configured ${configuredCaip2} for wallet ${wallet_id}.`
    );
    return;
  }

  // The only legitimate origin of a bump-eligible tx is vote.ts, which always sends to the
  // polling contract with vote-selector calldata and zero ETH value. Cross-check each field
  // so a forged webhook cannot redirect the relayer wallet (see EXPECTED_VOTE_SELECTOR).
  const expectedTo = pollingArbitrumAddress[configuredChainId as keyof typeof pollingArbitrumAddress];
  if (!expectedTo || transaction_request.to.toLowerCase() !== expectedTo.toLowerCase()) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: to=${transaction_request.to} does not match polling contract ${expectedTo} on chain ${configuredChainId}.`
    );
    return;
  }
  const data = transaction_request.data;
  if (!data || data.length < 10 || data.slice(0, 10).toLowerCase() !== EXPECTED_VOTE_SELECTOR.toLowerCase()) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: data selector does not match the vote function selector.`
    );
    return;
  }
  if (transaction_request.value !== undefined && BigInt(transaction_request.value) !== 0n) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: value=${transaction_request.value} is nonzero; vote txs never transfer ETH.`
    );
    return;
  }
  if (
    transaction_request.chain_id !== undefined &&
    BigInt(transaction_request.chain_id) !== BigInt(configuredChainId)
  ) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: chain_id=${transaction_request.chain_id} does not match configured ${configuredChainId} for wallet ${wallet_id}.`
    );
    return;
  }

  let attempt: number | null;
  try {
    attempt = await claimAttemptSlot(
      `${wallet_id}-${configuredChainId}-${transaction_request.nonce}`,
      network
    );
  } catch (err) {
    if (!(err instanceof GaslessStoreUnavailableError)) throw err;
    await alert(`Privy bump aborted for tx ${transaction_id}: ${err.message}`);
    return;
  }
  if (attempt === null) {
    await alert(
      `Privy bump cap reached for tx ${transaction_id} after ${MAX_BUMP_ATTEMPTS} attempts; investigate.`
    );
    return;
  }

  // Pre-flight: skip if the original tx has already mined on-chain. This guards against
  // racing the webhook against settlement.
  if (await isAlreadyMined(network, transaction_hash)) {
    logger.debug(`[gasless] tx ${transaction_id} already mined; skipping bump`);
    return;
  }

  // Arbitrum's sequencer is FIFO and most txs (including ours, which don't set fees explicitly)
  // are sent with max_priority_fee_per_gas = 0. Treating priority=0 as "couldn't read fees"
  // would dead-lock the bump path for the realistic stuck-tx case. Only max_fee_per_gas
  // matters for bumping on Arbitrum (it has to stretch over a rising base fee), so that's
  // the only field whose absence or zero value blocks the bump.
  const priorityHex = transaction_request.max_priority_fee_per_gas;
  const maxFeeHex = transaction_request.max_fee_per_gas;
  if (maxFeeHex === undefined || maxFeeHex === null) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: max_fee_per_gas missing from transaction_request.`
    );
    return;
  }
  const currentPriority = priorityHex !== undefined && priorityHex !== null ? BigInt(priorityHex) : 0n;
  const currentMaxFee = BigInt(maxFeeHex);
  if (currentMaxFee === 0n) {
    await alert(`Privy bump aborted for tx ${transaction_id}: max_fee_per_gas is 0, cannot bump.`);
    return;
  }

  const multiplicativeBump = bump(currentPriority);
  const additiveBump = currentPriority + MIN_PRIORITY_BUMP;
  const bumpedPriorityFee = multiplicativeBump > additiveBump ? multiplicativeBump : additiveBump;
  if (bumpedPriorityFee > ABSOLUTE_PRIORITY_FEE_CEILING) {
    await alert(
      `Privy bump aborted for tx ${transaction_id}: priority fee ${bumpedPriorityFee} would exceed ceiling ${ABSOLUTE_PRIORITY_FEE_CEILING}. Something is abnormal.`
    );
    return;
  }
  const bumpedMaxFee = bump(currentMaxFee);

  try {
    await privySendTransaction(wallet_id, {
      caip2,
      transaction: {
        to: transaction_request.to,
        data: transaction_request.data,
        value: transaction_request.value,
        nonce: transaction_request.nonce,
        chain_id:
          transaction_request.chain_id !== undefined ? numberToHex(transaction_request.chain_id) : undefined,
        // Forward the original gas_limit so Privy doesn't re-estimate. In a stuck-tx
        // scenario the original was already gas-validated at submission, and re-estimation
        // can fail under the same network conditions that caused the stall.
        gas_limit: transaction_request.gas_limit,
        max_priority_fee_per_gas: numberToHex(bumpedPriorityFee),
        max_fee_per_gas: numberToHex(bumpedMaxFee)
      },
      idempotencyKey: `bump-${transaction_id}-${attempt}`
    });
    logger.debug(`[gasless] bumped tx ${transaction_id} (attempt ${attempt}/${MAX_BUMP_ATTEMPTS})`);
  } catch (err) {
    await alert(
      `Privy bump send failed for tx ${transaction_id} on attempt ${attempt}: ${(err as Error).message}`
    );
    throw err;
  }
}

export const __testables = {
  bump,
  ABSOLUTE_PRIORITY_FEE_CEILING,
  MAX_BUMP_ATTEMPTS,
  MIN_PRIORITY_BUMP
};
