/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/
import { createMocks, RequestMethod } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import voteAPIHandler, { API_VOTE_ERRORS } from '../vote';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { getSKYVotingWeight } from 'modules/sky/helpers/getSKYVotingWeight';
import { getActivePollIds } from 'modules/polling/api/fetchPolls';
import { parseEther } from 'viem';
import {
  checkAndClaimGaslessVotingRateLimit,
  releaseGaslessVotingRateLimit
} from 'modules/polling/helpers/checkAndClaimGaslessVotingRateLimit';
import { countRelayedVote, isGaslessDisabled } from 'modules/polling/helpers/gaslessLimits';
import { privyGetWalletAddress, privySendTransaction } from 'lib/privyRest';
import { GaslessStoreUnavailableError } from 'modules/polling/helpers/gaslessStore';
import { fetchAddressPollVoteHistory } from 'modules/polling/api/fetchAddressPollVoteHistory';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { config } from 'lib/config';
import { getDelegateContractAddress } from 'modules/delegates/helpers/getDelegateContractAddress';
import { verifyTypedSignature } from 'modules/web3/helpers/verifyTypedSignature';
import { Mock, vi } from 'vitest';
import { getGaslessPublicClient } from 'modules/web3/helpers/getPublicClient';
import { getPrivyWalletConfig } from 'modules/polling/helpers/relayerCredentials';

vi.mock('modules/web3/helpers/getPublicClient');
vi.mock('modules/sky/helpers/getSKYVotingWeight');
vi.mock('modules/cache/cache');
vi.mock('modules/polling/api/fetchPolls');
vi.mock('modules/web3/helpers/verifyTypedSignature');
vi.mock('modules/polling/helpers/checkAndClaimGaslessVotingRateLimit');
vi.mock('modules/polling/helpers/gaslessLimits');
vi.mock('lib/privyRest');
vi.mock('modules/polling/helpers/relayerCredentials');
vi.mock('modules/polling/api/fetchAddressPollVoteHistory');
vi.mock('modules/app/api/postRequestToDiscord');
vi.mock('modules/delegates/helpers/getDelegateContractAddress');

describe('/api/polling/vote API Endpoint', () => {
  const publicClientMockResponses = vi.fn().mockImplementation(({ functionName }) => {
    if (functionName === 'nonces') return Promise.resolve(3n);
  });

  beforeAll(() => {
    (getGaslessPublicClient as Mock).mockReturnValue({
      readContract: publicClientMockResponses
    });
    (releaseGaslessVotingRateLimit as Mock).mockResolvedValue(undefined);
    (isGaslessDisabled as Mock).mockReturnValue(false);
    (countRelayedVote as Mock).mockResolvedValue(undefined);
    (fetchAddressPollVoteHistory as Mock).mockImplementation(() => Promise.resolve([]));
    (postRequestToDiscord as Mock).mockImplementation(() => Promise.resolve());
    (getDelegateContractAddress as Mock).mockImplementation(() => Promise.resolve(undefined));
  });
  function mockRequestResponse(method: RequestMethod = 'POST', body) {
    const { req, res }: { req: NextApiRequest; res: NextApiResponse } = createMocks({ method });
    req.headers = {
      'Content-Type': 'application/json'
    };
    req.body = body;
    return { req, res };
  }

  it('return 400 if voter is missing', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: ''
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.VOTER_MUST_BE_STRING }
    });
    // expect(res.getHeaders()).toEqual({ 'content-type': 'application/json' });
    expect(res.statusMessage).toEqual('OK');
  });

  it('return 400 if pollIds is not an array of integers', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: '123'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.POLLIDS_MUST_BE_ARRAY_NUMBERS }
    });
  });

  it('return 400 if optionIds is not an array of integers', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: '123'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.OPTIONIDS_MUST_BE_ARRAY_NUMBERS }
    });
  });

  it('return 400 if pollIds and optionIds differ in length', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2, 3]
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.POLLIDS_OPTIONIDS_LENGTH_MISMATCH }
    });
  });

  it('return 400 if pollIds contains duplicates', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, '1', 2],
      optionIds: [1, 1, 2]
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.DUPLICATE_POLLIDS }
    });
  });

  it('return 400 if a backdoor vote includes more than one poll', async () => {
    const backdoorSecret = config.GASLESS_BACKDOOR_SECRET;
    config.GASLESS_BACKDOOR_SECRET = 'backdoor-secret';
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 3,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      signature: '2',
      network: SupportedNetworks.MAINNET,
      secret: 'backdoor-secret'
    });
    await voteAPIHandler(req, res);
    config.GASLESS_BACKDOOR_SECRET = backdoorSecret;

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.BACKDOOR_SINGLE_POLL_ONLY }
    });
  });

  it('return 400 if nonce is not a number', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 'ab'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.NONCE_MUST_BE_NUMBER }
    });
  });

  it('return 400 if expiry is not a number', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 1,
      expiry: 'asd'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.EXPIRY_MUST_BE_NUMBER }
    });
  });

  it('return 400 if expired', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 1,
      expiry: (Date.now() - 200) / 1000
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.EXPIRED_VOTES }
    });
  });

  it('return 400 if signature is not a string', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 1,
      expiry: (Date.now() + 200) / 1000,
      signature: 2
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.SIGNATURE_MUST_BE_STRING }
    });
  });

  it('return 400 if network is not valid', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 1,
      expiry: (Date.now() + 200) / 1000,
      signature: '2'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.INVALID_NETWORK }
    });
  });

  it('return 400 if nonce is not valid', async () => {
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 1,
      expiry: (Date.now() + 200) / 1000,
      signature: '2',
      network: SupportedNetworks.MAINNET
    });

    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.INVALID_NONCE_FOR_ADDRESS }
    });
  });

  it('return 400 if SKY amount is not valid', async () => {
    (checkAndClaimGaslessVotingRateLimit as Mock).mockReturnValue(Promise.resolve(false));
    (getSKYVotingWeight as Mock).mockReturnValue(
      Promise.resolve({
        total: 0n
      })
    );
    const { req, res } = mockRequestResponse('POST', {
      voter: '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 3,
      expiry: (Date.now() + 200) / 1000,
      signature: '2',
      network: SupportedNetworks.MAINNET
    });

    (verifyTypedSignature as Mock).mockReturnValue(true);
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.LESS_THAN_MINIMUM_SKY_REQUIRED }
    });
  });

  it('return 400 if any poll is expired', async () => {
    (checkAndClaimGaslessVotingRateLimit as Mock).mockReturnValue(Promise.resolve(false));
    (getSKYVotingWeight as Mock).mockReturnValue(Promise.resolve(parseEther('2500')));
    (getActivePollIds as Mock).mockReturnValue(Promise.resolve([]));
    const { req, res } = mockRequestResponse('POST', {
      voter: '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E',
      pollIds: [1],
      optionIds: [1],
      nonce: 3,
      expiry: (Date.now() + 200) / 1000,
      signature: '2',
      network: SupportedNetworks.MAINNET
    });

    (verifyTypedSignature as Mock).mockReturnValue(true);
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.EXPIRED_POLLS }
    });
  });

  it('return 400 if it used gasless voting recently', async () => {
    (checkAndClaimGaslessVotingRateLimit as Mock).mockReturnValue(Promise.resolve(true));

    const { req, res } = mockRequestResponse('POST', {
      voter: '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E',
      pollIds: [1],
      optionIds: [1],
      nonce: 3,
      expiry: (Date.now() + 200) / 1000,
      signature: '2',
      network: SupportedNetworks.MAINNET
    });

    (verifyTypedSignature as Mock).mockReturnValue(true);

    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.RATE_LIMITED }
    });
  });

  it('return 400 if voter and signer do not match', async () => {
    (verifyTypedSignature as Mock).mockReturnValue(false);

    const { req, res } = mockRequestResponse('POST', {
      voter: '0xc0ffee254729296a45a3885639AC7E10F9d54979',
      pollIds: [1],
      optionIds: [1],
      nonce: 3,
      expiry: (Date.now() + 200) / 1000,
      signature: '2',
      network: SupportedNetworks.MAINNET
    });

    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.VOTER_AND_SIGNER_DIFFER }
    });
  });

  it('never posts the secret or the signature to Discord', async () => {
    (postRequestToDiscord as Mock).mockClear();
    const webhookUrl = config.GASLESS_WEBHOOK_URL;
    config.GASLESS_WEBHOOK_URL = 'https://discord.test/webhook';
    const { req, res } = mockRequestResponse('POST', {
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      pollIds: [1, 2],
      optionIds: [1, 2],
      nonce: 3,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      signature: '0xsignature-that-must-stay-private',
      network: 'mainnet',
      secret: 'wrong-secret-that-must-stay-private'
    });
    await voteAPIHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: { code: 'invalid_request', message: API_VOTE_ERRORS.WRONG_SECRET }
    });
    expect(postRequestToDiscord).toHaveBeenCalledTimes(1);
    const { content } = (postRequestToDiscord as Mock).mock.calls[0][0];
    expect(content).not.toContain('must-stay-private');
    expect(JSON.parse(content)).toEqual({
      error: API_VOTE_ERRORS.WRONG_SECRET,
      voter: '0xf6c28eC4f4f8E6C712d9242a1Ff7F9e82BeC964F',
      network: 'mainnet',
      nonce: 3,
      expiry: expect.any(Number),
      pollCount: 2,
      optionCount: 2,
      usedSecret: true
    });
    config.GASLESS_WEBHOOK_URL = webhookUrl;
  });

  describe('relayer spending controls', () => {
    const eligibleBallot = {
      voter: '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E',
      pollIds: [1],
      optionIds: [1],
      nonce: 3,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      signature: '2',
      network: SupportedNetworks.MAINNET
    };

    beforeEach(() => {
      (verifyTypedSignature as Mock).mockReturnValue(true);
      (checkAndClaimGaslessVotingRateLimit as Mock).mockResolvedValue(false);
      (getSKYVotingWeight as Mock).mockResolvedValue(parseEther('2500'));
      (getActivePollIds as Mock).mockResolvedValue([1]);
    });

    const validSignature = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;

    afterEach(() => {
      (isGaslessDisabled as Mock).mockReturnValue(false);
    });

    it('returns 503 for any request while the kill switch is on', async () => {
      (isGaslessDisabled as Mock).mockReturnValue(true);
      (checkAndClaimGaslessVotingRateLimit as Mock).mockClear();
      const { req, res } = mockRequestResponse('POST', eligibleBallot);

      await voteAPIHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res._getJSONData().error.message).toBe(API_VOTE_ERRORS.GASLESS_DISABLED);
      expect(checkAndClaimGaslessVotingRateLimit).not.toHaveBeenCalled();
    });

    it('returns 503 instead of skipping the rate limit when its store is down', async () => {
      (checkAndClaimGaslessVotingRateLimit as Mock).mockRejectedValue(
        new GaslessStoreUnavailableError('timeout')
      );
      const { req, res } = mockRequestResponse('POST', eligibleBallot);

      await voteAPIHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res._getJSONData().error.message).toBe(API_VOTE_ERRORS.GASLESS_UNAVAILABLE);
    });

    it('counts the vote once the relayer accepts it', async () => {
      (getPrivyWalletConfig as Mock).mockReturnValueOnce({
        walletId: 'wallet-mainnet',
        caip2: 'eip155:42161'
      });
      (getGaslessPublicClient as Mock).mockReturnValueOnce({
        readContract: publicClientMockResponses,
        estimateGas: vi.fn().mockResolvedValue(100_000n)
      });
      (privyGetWalletAddress as Mock).mockResolvedValue('0x0000000000000000000000000000000000000001');
      (privySendTransaction as Mock).mockResolvedValue({ transaction_id: 'tx-1', hash: '0xabc' });
      (countRelayedVote as Mock).mockClear();
      const { req, res } = mockRequestResponse('POST', { ...eligibleBallot, signature: validSignature });

      await voteAPIHandler(req, res);

      expect(res._getJSONData()).toMatchObject({ transactionId: 'tx-1' });
      expect(res.statusCode).toBe(200);
      expect(countRelayedVote).toHaveBeenCalledWith(SupportedNetworks.MAINNET);
    });

    it('frees the cooldown and does not count the vote when the relayer send fails', async () => {
      (privyGetWalletAddress as Mock).mockRejectedValue(new Error('privy down'));
      (releaseGaslessVotingRateLimit as Mock).mockClear();
      (countRelayedVote as Mock).mockClear();
      const { req, res } = mockRequestResponse('POST', { ...eligibleBallot, signature: validSignature });

      await voteAPIHandler(req, res);

      expect(res._getJSONData().error.message).toBe(API_VOTE_ERRORS.RELAYER_ERROR);
      expect(releaseGaslessVotingRateLimit).toHaveBeenCalledTimes(1);
      expect(countRelayedVote).not.toHaveBeenCalled();
    });

    it('keeps a cooldown the backdoor request did not claim', async () => {
      const originalSecret = config.GASLESS_BACKDOOR_SECRET;
      config.GASLESS_BACKDOOR_SECRET = 'backdoor';
      (checkAndClaimGaslessVotingRateLimit as Mock).mockResolvedValue(true);
      (privyGetWalletAddress as Mock).mockRejectedValue(new Error('privy down'));
      (releaseGaslessVotingRateLimit as Mock).mockClear();
      const { req, res } = mockRequestResponse('POST', {
        ...eligibleBallot,
        signature: validSignature,
        secret: 'backdoor'
      });

      await voteAPIHandler(req, res);
      config.GASLESS_BACKDOOR_SECRET = originalSecret;

      expect(res._getJSONData().error.message).toBe(API_VOTE_ERRORS.RELAYER_ERROR);
      expect(releaseGaslessVotingRateLimit).not.toHaveBeenCalled();
    });
  });
});
