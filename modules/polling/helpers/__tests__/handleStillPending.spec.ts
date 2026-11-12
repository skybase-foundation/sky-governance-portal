/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { parseGwei, toFunctionSelector } from 'viem';
import { handleStillPending, __testables } from '../handleStillPending';
import { claimGaslessSlot, GaslessStoreUnavailableError } from '../gaslessStore';
import { privySendTransaction } from 'lib/privyRest';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { config } from 'lib/config';
import { getGaslessPublicClient } from 'modules/web3/helpers/getPublicClient';

vi.mock('../gaslessStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../gaslessStore')>()),
  claimGaslessSlot: vi.fn()
}));
vi.mock('lib/privyRest');
vi.mock('modules/app/api/postRequestToDiscord');
vi.mock('modules/web3/helpers/getPublicClient');
vi.mock('modules/web3/helpers/chain', () => ({ networkNameToChainId: () => 42161 }));
vi.mock('lib/config', () => ({
  config: {
    PRIVY_WALLET_ID_MAINNET: 'wallet-mainnet',
    PRIVY_WALLET_ID_TESTNET: 'wallet-testnet',
    GASLESS_WEBHOOK_URL: 'https://discord.example/hook',
    GASLESS_DISABLED: ''
  }
}));

const getTransactionReceipt = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (privySendTransaction as Mock).mockResolvedValue({
    hash: '0xnew',
    transaction_id: 'tx-bumped',
    caip2: 'eip155:42161'
  });
  (getGaslessPublicClient as Mock).mockReturnValue({ getTransactionReceipt });
  config.GASLESS_DISABLED = '';
  // Default: not yet mined
  getTransactionReceipt.mockRejectedValue(new Error('not found'));
});

const POLLING_ARBITRUM_ONE = '0x4f4e551b4920a5417F8d4e7f8f099660dAdadcEC';
const POLLING_ARBITRUM_SEPOLIA = '0xE63329692fA90B3efd5eB675c601abeDB2DF715a';
const VOTE_SELECTOR = toFunctionSelector(
  'vote(address,uint256,uint256,uint256[],uint256[],uint8,bytes32,bytes32)'
);
// Selector + 32 bytes of zero-padded args. Just enough to pass the selector check; the
// handler doesn't decode the args.
const VOTE_CALLDATA = `${VOTE_SELECTOR}${'00'.repeat(32)}` as `0x${string}`;

const validPayload = {
  type: 'transaction.still_pending',
  transaction_id: 'tx-123',
  transaction_hash: '0xdeadbeef',
  wallet_id: 'wallet-mainnet',
  caip2: 'eip155:42161',
  transaction_request: {
    chain_id: 42161,
    to: POLLING_ARBITRUM_ONE,
    data: VOTE_CALLDATA,
    value: '0x0',
    nonce: 7,
    max_priority_fee_per_gas: parseGwei('0.1').toString(),
    max_fee_per_gas: parseGwei('0.5').toString()
  }
};

describe('handleStillPending', () => {
  it('claims slot 1 on first attempt and bumps fees by 1.4x', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      transaction_request: { ...validPayload.transaction_request, gas_limit: '0x30d40' }
    });

    expect(claimGaslessSlot).toHaveBeenCalledTimes(1);
    expect(privySendTransaction).toHaveBeenCalledTimes(1);
    const [walletId, opts] = (privySendTransaction as Mock).mock.calls[0];
    expect(walletId).toBe('wallet-mainnet');
    expect(opts.caip2).toBe('eip155:42161');
    expect(opts.transaction.nonce).toBe(7);
    expect(opts.transaction.to).toBe(POLLING_ARBITRUM_ONE);
    // gas_limit forwarded so Privy skips re-estimation under the same conditions that
    // caused the original stall.
    expect(opts.transaction.gas_limit).toBe('0x30d40');
    // 0.1 gwei * 1.4 = 0.14 gwei
    expect(BigInt(opts.transaction.max_priority_fee_per_gas)).toBe(
      (BigInt(validPayload.transaction_request.max_priority_fee_per_gas) * 14n) / 10n
    );
    expect(opts.idempotencyKey).toBe('bump-tx-123-1');
  });

  it('alerts and bails when both attempt slots are taken (cap reached)', async () => {
    (claimGaslessSlot as Mock).mockResolvedValue(false);

    await handleStillPending(validPayload);

    expect(privySendTransaction).not.toHaveBeenCalled();
    expect(postRequestToDiscord).toHaveBeenCalledWith(
      expect.objectContaining({
        url: config.GASLESS_WEBHOOK_URL,
        notify: true
      })
    );
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/cap reached/i);
  });

  it('skips bump when the original tx has already mined on-chain', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);
    getTransactionReceipt.mockResolvedValueOnce({ status: 'success', blockNumber: 123n });

    await handleStillPending(validPayload);

    expect(privySendTransaction).not.toHaveBeenCalled();
  });

  it('aborts when bumped priority fee would exceed the absolute ceiling', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        // 0.8 gwei * 1.4 = 1.12 gwei — exceeds the 1 gwei ceiling
        max_priority_fee_per_gas: parseGwei('0.8').toString(),
        max_fee_per_gas: parseGwei('1').toString()
      }
    });

    expect(privySendTransaction).not.toHaveBeenCalled();
    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/exceed ceiling/i);
  });

  it('rejects unknown wallet ids', async () => {
    await expect(
      handleStillPending({ ...validPayload, wallet_id: 'wallet-unknown' })
    ).rejects.toThrow(/Unknown Privy wallet id/);
    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
  });

  it('aborts when payload caip2 does not match wallet network', async () => {
    await handleStillPending({
      ...validPayload,
      // mainnet wallet but testnet caip2 — refuse
      caip2: 'eip155:421614'
    });

    expect(privySendTransaction).not.toHaveBeenCalled();
    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/does not match/i);
  });

  it('routes testnet wallet using the testnet CAIP-2', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      wallet_id: 'wallet-testnet',
      caip2: 'eip155:421614',
      transaction_request: {
        ...validPayload.transaction_request,
        chain_id: 421614,
        to: POLLING_ARBITRUM_SEPOLIA
      }
    });

    expect((privySendTransaction as Mock).mock.calls[0][1].caip2).toBe('eip155:421614');
  });

  // Arbitrum's sequencer is FIFO and most txs are broadcast with max_priority_fee_per_gas=0
  // (including ours — vote.ts doesn't set fees explicitly). Bumping is still useful: max_fee
  // gets stretched 1.4x to cover any base-fee spike. Priority gets the additive floor so the
  // replacement satisfies any EIP-1559 "both fees must bump" replacement rule.
  it('bumps a tx with max_priority_fee_per_gas=0 (the normal Arbitrum case)', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        max_priority_fee_per_gas: '0x0',
        max_fee_per_gas: parseGwei('0.5').toString()
      }
    });

    expect(privySendTransaction).toHaveBeenCalledTimes(1);
    expect(postRequestToDiscord).not.toHaveBeenCalled();
    const opts = (privySendTransaction as Mock).mock.calls[0][1];
    // priority gets the additive floor (0 + 0.01 gwei) since multiplicative bump of 0 is 0
    expect(BigInt(opts.transaction.max_priority_fee_per_gas)).toBe(__testables.MIN_PRIORITY_BUMP);
    // max_fee bumps 1.4x
    expect(BigInt(opts.transaction.max_fee_per_gas)).toBe(
      (parseGwei('0.5') * 14n) / 10n
    );
  });

  // When current priority is non-trivial, the multiplicative bump (1.4x) wins over the
  // additive floor (current + 0.01 gwei). E.g., 0.1 gwei * 1.4 = 0.14 > 0.1 + 0.01 = 0.11.
  it('uses multiplicative bump when it exceeds the additive floor', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending(validPayload); // priority = 0.1 gwei

    const opts = (privySendTransaction as Mock).mock.calls[0][1];
    const original = BigInt(validPayload.transaction_request.max_priority_fee_per_gas);
    // 0.1 gwei * 1.4 = 0.14 gwei (multiplicative wins)
    expect(BigInt(opts.transaction.max_priority_fee_per_gas)).toBe((original * 14n) / 10n);
  });

  it('aborts when max_fee_per_gas is missing from the payload', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    const { max_fee_per_gas: _omit, ...rest } = validPayload.transaction_request;
    await handleStillPending({
      ...validPayload,
      transaction_request: rest
    });

    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/max_fee_per_gas missing/i);
  });

  it('aborts when max_fee_per_gas is 0', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        max_priority_fee_per_gas: parseGwei('0.1').toString(),
        max_fee_per_gas: '0x0'
      }
    });

    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/max_fee_per_gas is 0/i);
  });

  // Defense-in-depth checks against a forged webhook payload (e.g., if
  // PRIVY_WEBHOOK_SIGNING_SECRET leaked in isolation from PRIVY_APP_SECRET): the bump path
  // must not be usable to redirect the relayer wallet's funds.
  it('aborts and does not claim a slot when `to` is not the polling contract', async () => {
    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        to: '0x000000000000000000000000000000000000dEaD'
      }
    });

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/does not match polling contract/i);
  });

  it('accepts `to` regardless of address checksum case', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        to: POLLING_ARBITRUM_ONE.toLowerCase()
      }
    });

    expect(privySendTransaction).toHaveBeenCalledTimes(1);
  });

  it('aborts when `data` is missing', async () => {
    const { data: _omit, ...rest } = validPayload.transaction_request;
    await handleStillPending({
      ...validPayload,
      transaction_request: rest
    });

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/selector does not match/i);
  });

  it('aborts when `data` selector is not the vote selector', async () => {
    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        // ERC20 transfer(address,uint256) selector — definitely not vote()
        data: `0xa9059cbb${'00'.repeat(32)}` as `0x${string}`
      }
    });

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/selector does not match/i);
  });

  it('aborts when `value` is nonzero', async () => {
    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        value: '0x1'
      }
    });

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/is nonzero/i);
  });

  it('aborts when `chain_id` does not match the wallet network', async () => {
    await handleStillPending({
      ...validPayload,
      transaction_request: {
        ...validPayload.transaction_request,
        // mainnet wallet expects 42161; lie about the chain
        chain_id: 1
      }
    });

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/chain_id=1 does not match/i);
  });
});

describe('__testables.bump', () => {
  it('multiplies by 1.4 using integer arithmetic', () => {
    expect(__testables.bump(100n)).toBe(140n);
    expect(__testables.bump(7n)).toBe(9n); // 7 * 14 / 10 = 98/10 = 9 (truncated)
  });

  it('does not bump while gasless voting is disabled', async () => {
    config.GASLESS_DISABLED = 'true';

    await handleStillPending(validPayload);

    expect(claimGaslessSlot).not.toHaveBeenCalled();
    expect(privySendTransaction).not.toHaveBeenCalled();
  });

  it('keys attempt slots by relayer wallet, chain and nonce instead of transaction_id', async () => {
    (claimGaslessSlot as Mock).mockResolvedValueOnce(true);

    await handleStillPending(validPayload);
    await handleStillPending({ ...validPayload, transaction_id: 'tx-replacement' });

    const keys = (claimGaslessSlot as Mock).mock.calls.map(([, key]) => key);
    expect(keys[0]).toBe('bump-attempt-wallet-mainnet-42161-7-1');
    // The replacement shares the lineage, so it continues from the same budget.
    expect(keys[1]).toBe('bump-attempt-wallet-mainnet-42161-7-1');
  });

  it('alerts and does not bump when the attempt store is unavailable', async () => {
    (claimGaslessSlot as Mock).mockRejectedValueOnce(new GaslessStoreUnavailableError('timeout'));

    await handleStillPending(validPayload);

    expect(privySendTransaction).not.toHaveBeenCalled();
    const content = (postRequestToDiscord as Mock).mock.calls[0][0].content as string;
    expect(content).toMatch(/Gasless store unavailable/);
  });
});
