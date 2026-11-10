/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { NextApiRequest, NextApiResponse } from 'next';
import withApiHandler from 'modules/app/api/withApiHandler';
import { getTypedBallotData } from 'modules/web3/helpers/signTypedBallotData';
import { config } from 'lib/config';
import { privySendTransaction, privyGetWalletAddress } from 'lib/privyRest';
import { getPrivyWalletConfig } from 'modules/polling/helpers/relayerCredentials';
import { pollingArbitrumAddress } from 'modules/contracts/generated';
import logger from 'lib/logger';
import { getActivePollIds } from 'modules/polling/api/fetchPolls';
import {
  checkAndClaimGaslessVotingRateLimit,
  releaseGaslessVotingRateLimit
} from 'modules/polling/helpers/checkAndClaimGaslessVotingRateLimit';
import {
  claimDailyRelayedVote,
  releaseDailyRelayedVote,
  isGaslessDisabled
} from 'modules/polling/helpers/gaslessLimits';
import { GaslessStoreUnavailableError } from 'modules/polling/helpers/gaslessStore';
import { hasSkyRequiredVotingWeight } from 'modules/polling/helpers/hasSkyRequiredVotingWeight';
import { MIN_SKY_REQUIRED_FOR_GASLESS_VOTING } from 'modules/polling/polling.constants';
import { postRequestToDiscord } from 'modules/app/api/postRequestToDiscord';
import { sanitizeGaslessVoteBody } from 'modules/polling/helpers/sanitizeGaslessVoteBody';
import { isSupportedNetwork } from 'modules/web3/helpers/networks';
import { ballotIncludesAlreadyVoted } from 'modules/polling/helpers/ballotIncludesAlreadyVoted';
import { ApiError } from 'modules/app/api/ApiError';
import { verifyTypedSignature } from 'modules/web3/helpers/verifyTypedSignature';
import { getGaslessPublicClient } from 'modules/web3/helpers/getPublicClient';
import { networkNameToChainId, getGaslessNetwork } from 'modules/web3/helpers/chain';
import { pollingArbitrumAbi } from 'modules/contracts/generated';
import { encodeFunctionData, getAddress, parseSignature, numberToHex } from 'viem';

export const API_VOTE_ERRORS = {
  VOTER_MUST_BE_STRING: 'Voter must be a string.',
  POLLIDS_MUST_BE_ARRAY_NUMBERS: 'PollIds must be an array of numbers.',
  POLLIDS_CANNOT_BE_EMPTY: 'PollIds array cannot be empty.',
  OPTIONIDS_MUST_BE_ARRAY_NUMBERS: 'OptionIds must be an array of numbers.',
  OPTIONIDS_CANNOT_BE_EMPTY: 'OptionIds array cannot be empty.',
  POLLIDS_OPTIONIDS_LENGTH_MISMATCH: 'PollIds and optionIds must have the same length.',
  DUPLICATE_POLLIDS: 'PollIds cannot contain duplicates.',
  BACKDOOR_SINGLE_POLL_ONLY: 'Backdoor votes can only include one poll.',
  NONCE_MUST_BE_NUMBER: 'Nonce must be a number.',
  EXPIRY_MUST_BE_NUMBER: 'Expiry must be a number.',
  SIGNATURE_MUST_BE_STRING: 'Signature must be a string.',
  INVALID_NETWORK: 'Invalid network.',
  WRONG_SECRET: 'Wrong secret.',
  INVALID_NONCE_FOR_ADDRESS: 'Invalid nonce for address.',
  EXPIRED_VOTES: 'Expiration date already passed.',
  EXPIRED_POLLS: 'Can only vote in active polls.',
  RATE_LIMITED: 'Address cannot use gasless service more than once per 10 minutes.',
  VOTER_AND_SIGNER_DIFFER: 'Voter address could not be recovered from signature.',
  LESS_THAN_MINIMUM_SKY_REQUIRED: `Address must have a poll voting weight of at least ${MIN_SKY_REQUIRED_FOR_GASLESS_VOTING.toString()}.`,
  ALREADY_VOTED_IN_POLL: 'Address has already voted in this poll.',
  RELAYER_ERROR: 'Relayer transaction creation failed.',
  GASLESS_DISABLED: 'Gasless voting is currently disabled.',
  GASLESS_UNAVAILABLE: 'Gasless voting is temporarily unavailable.',
  DAILY_CAP_REACHED: 'Gasless voting has reached its daily limit. Try again after 00:00 UTC.'
};

async function postErrorInDiscord(error: string, body: unknown, type = 'error') {
  // Post on discord
  try {
    if (config.GASLESS_WEBHOOK_URL) {
      await postRequestToDiscord({
        url: config.GASLESS_WEBHOOK_URL,
        content: JSON.stringify({
          [type]: error,
          ...sanitizeGaslessVoteBody(body)
        }),
        // TODO turn this to true when ready to deploy
        notify: false
      });
    }
  } catch (err) {
    logger.error('API Vote: Unable to post error to discord', err.message);
  }
}

type ErrorArgs = { error: string; body: unknown; code?: number; skipDiscord?: boolean };

async function throwError({ error, body, code = 400, skipDiscord = false }: ErrorArgs): Promise<never> {
  // Post on discord
  if (!skipDiscord) postErrorInDiscord(error, body);

  // Return api error
  throw new ApiError(`Poll Gasless Vote: ${error}`, code, error);
}

// Runs a rate-limit or cap operation, turning a store outage into a 503 so no vote is relayed unchecked.
async function withGaslessStore<T>(operation: () => Promise<T>, body: unknown): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!(err instanceof GaslessStoreUnavailableError)) throw err;
    logger.error(`API Vote: ${err.message}`);
    return throwError({ error: API_VOTE_ERRORS.GASLESS_UNAVAILABLE, body, code: 503, skipDiscord: true });
  }
}

//TODO: add swagger documentation
export default withApiHandler(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (isGaslessDisabled()) {
      await throwError({
        error: API_VOTE_ERRORS.GASLESS_DISABLED,
        body: req.body,
        code: 503,
        skipDiscord: true
      });
    }

    const { voter, pollIds, optionIds, nonce, expiry, signature, network, secret, skipDiscord } = req.body;
    if (typeof voter !== 'string' || !voter) {
      await throwError({ error: API_VOTE_ERRORS.VOTER_MUST_BE_STRING, body: req.body, skipDiscord });
    }
    if (!Array.isArray(pollIds) || !pollIds.every(e => !isNaN(parseInt(e)))) {
      await throwError({
        error: API_VOTE_ERRORS.POLLIDS_MUST_BE_ARRAY_NUMBERS,
        body: req.body,
        skipDiscord
      });
    }
    if (pollIds.length === 0) {
      await throwError({
        error: API_VOTE_ERRORS.POLLIDS_CANNOT_BE_EMPTY,
        body: req.body,
        skipDiscord
      });
    }
    if (!Array.isArray(optionIds) || !optionIds.every(e => !isNaN(parseInt(e)))) {
      await throwError({
        error: API_VOTE_ERRORS.OPTIONIDS_MUST_BE_ARRAY_NUMBERS,
        body: req.body,
        skipDiscord
      });
    }
    if (optionIds.length === 0) {
      await throwError({
        error: API_VOTE_ERRORS.OPTIONIDS_CANNOT_BE_EMPTY,
        body: req.body,
        skipDiscord
      });
    }
    if (pollIds.length !== optionIds.length) {
      await throwError({
        error: API_VOTE_ERRORS.POLLIDS_OPTIONIDS_LENGTH_MISMATCH,
        body: req.body,
        skipDiscord
      });
    }
    if (new Set(pollIds.map(pollId => parseInt(pollId))).size !== pollIds.length) {
      await throwError({ error: API_VOTE_ERRORS.DUPLICATE_POLLIDS, body: req.body, skipDiscord });
    }
    if (typeof nonce !== 'number') {
      await throwError({ error: API_VOTE_ERRORS.NONCE_MUST_BE_NUMBER, body: req.body, skipDiscord });
    }
    if (typeof expiry !== 'number') {
      await throwError({ error: API_VOTE_ERRORS.EXPIRY_MUST_BE_NUMBER, body: req.body, skipDiscord });
    }

    if (expiry <= Date.now() / 1000) {
      await throwError({ error: API_VOTE_ERRORS.EXPIRED_VOTES, body: req.body, skipDiscord });
    }

    if (typeof signature !== 'string' || !signature) {
      await throwError({ error: API_VOTE_ERRORS.SIGNATURE_MUST_BE_STRING, body: req.body, skipDiscord });
    }

    if (!isSupportedNetwork(network)) {
      await throwError({ error: API_VOTE_ERRORS.INVALID_NETWORK, body: req.body, skipDiscord });
    }

    if (secret && secret !== config.GASLESS_BACKDOOR_SECRET) {
      await throwError({ error: API_VOTE_ERRORS.WRONG_SECRET, body: req.body, skipDiscord });
    }

    if (secret && pollIds.length > 1) {
      await throwError({ error: API_VOTE_ERRORS.BACKDOOR_SINGLE_POLL_ONLY, body: req.body, skipDiscord });
    }

    const publicClient = getGaslessPublicClient(networkNameToChainId(network));
    // pollingArbitrumAddress is keyed on the Arbitrum chain ids, so map the L1/Tenderly
    // network to its corresponding Arbitrum chain (One for mainnet, Sepolia for testnet/tenderly).
    const gaslessChainId = networkNameToChainId(getGaslessNetwork(network));
    const pollingAddress = pollingArbitrumAddress[gaslessChainId] as `0x${string}`;

    //verify valid nonce and expiry date
    const nonceFromContract = await publicClient.readContract({
      address: pollingAddress,
      abi: pollingArbitrumAbi,
      functionName: 'nonces',
      args: [voter]
    });
    if (parseInt(nonceFromContract.toString()) !== nonce) {
      await throwError({ error: API_VOTE_ERRORS.INVALID_NONCE_FOR_ADDRESS, body: req.body, skipDiscord });
    }

    //verify that signature and address correspond
    const typedData = getTypedBallotData({ voter, pollIds, optionIds, nonce, expiry }, network);
    const isSignatureValid = await verifyTypedSignature(
      getAddress(voter),
      typedData.domain,
      typedData.types,
      typedData.message,
      typedData.primaryType,
      signature
    );

    if (!isSignatureValid) {
      await throwError({ error: API_VOTE_ERRORS.VOTER_AND_SIGNER_DIFFER, body: req.body, skipDiscord });
    }

    // The backdoor path can run inside a cooldown another request claimed; only the owner frees it.
    let claimedRateLimit = true;
    const releaseRateLimit = async () => {
      if (!claimedRateLimit) return;
      await releaseGaslessVotingRateLimit(voter, network).catch(err =>
        logger.error('API Vote: unable to release the gasless rate limit', err.message)
      );
    };

    //run eligibility checks unless backdoor secret provided
    if (!secret || secret !== config.GASLESS_BACKDOOR_SECRET) {
      const recentlyUsedGaslessVoting = await withGaslessStore(
        () => checkAndClaimGaslessVotingRateLimit(voter, network),
        req.body
      );

      //check that address hasn't used gasless service recently before doing any other checks
      if (recentlyUsedGaslessVoting) {
        await throwError({ error: API_VOTE_ERRORS.RATE_LIMITED, body: req.body, skipDiscord });
      }

      const [hasSkyRequired, activePollIds, ballotHasVotedPolls] = await Promise.all([
        hasSkyRequiredVotingWeight(voter, network, MIN_SKY_REQUIRED_FOR_GASLESS_VOTING, true),
        getActivePollIds(network),
        ballotIncludesAlreadyVoted(voter, network, pollIds)
      ]);

      //verify address has a poll weight > 0.1 SKY
      if (!hasSkyRequired) {
        await releaseRateLimit();
        await throwError({
          error: API_VOTE_ERRORS.LESS_THAN_MINIMUM_SKY_REQUIRED,
          body: req.body,
          skipDiscord
        });
      }

      // Verify that all the polls are active
      const areAllPollsActive = pollIds.every(pollId => activePollIds.some(pId => pId === parseInt(pollId)));
      if (!areAllPollsActive) {
        await releaseRateLimit();
        await throwError({ error: API_VOTE_ERRORS.EXPIRED_POLLS, body: req.body, skipDiscord });
      }

      //can't use gasless service to vote in a poll you've already voted on
      if (ballotHasVotedPolls) {
        await releaseRateLimit();
        await throwError({ error: API_VOTE_ERRORS.ALREADY_VOTED_IN_POLL, body: req.body, skipDiscord });
      }
    } else {
      const alreadyClaimed = await withGaslessStore(
        () => checkAndClaimGaslessVotingRateLimit(voter, network),
        req.body
      );
      claimedRateLimit = !alreadyClaimed;
      await postErrorInDiscord('bypassing eligibilty requirements', req.body, 'notice');
    }

    const withinDailyCap = await withGaslessStore(() => claimDailyRelayedVote(network), req.body);
    if (!withinDailyCap) {
      await releaseRateLimit();
      await throwError({
        error: API_VOTE_ERRORS.DAILY_CAP_REACHED,
        body: req.body,
        code: 503,
        skipDiscord: true
      });
    }

    const { r, s, v } = parseSignature(signature);
    let tx;
    try {
      const parsedPollIds = pollIds.map(pollId => BigInt(pollId));
      const parsedOptionIds = optionIds.map(optionId => BigInt(optionId));

      const data = encodeFunctionData({
        abi: pollingArbitrumAbi,
        functionName: 'vote',
        args: [voter, nonce, BigInt(expiry), parsedPollIds, parsedOptionIds, +(v as bigint).toString(), r, s]
      });

      const { walletId, caip2 } = getPrivyWalletConfig(network);
      const relayerAddress = await privyGetWalletAddress(walletId);
      const estimatedGas = await publicClient.estimateGas({
        to: pollingAddress,
        data,
        account: relayerAddress
      });
      // 20% buffer to account for sub-block variability between estimate and broadcast.
      const gasWithBuffer = (estimatedGas * 120n) / 100n;

      const result = await privySendTransaction(walletId, {
        caip2,
        transaction: {
          to: pollingAddress,
          data,
          chain_id: numberToHex(gaslessChainId),
          gas_limit: numberToHex(gasWithBuffer)
        }
      });

      if (!result.transaction_id) {
        // BallotContext polls /api/polling/relayer-tx?txId={transactionId}; without an id we can't track.
        throw new Error('Privy sendTransaction did not return a transaction_id');
      }
      tx = {
        hash: result.hash,
        transactionId: result.transaction_id,
        sentAt: new Date().toISOString(),
        status: 'broadcasted'
      };
    } catch (err) {
      //don't rate limit or count against the daily cap if tx didn't succeed
      await releaseRateLimit();
      await releaseDailyRelayedVote(network).catch(e =>
        logger.error('API Vote: unable to release the daily cap claim', e.message)
      );
      logger.error('API Vote: relayer send failed', err?.message || err);
      await throwError({ error: API_VOTE_ERRORS.RELAYER_ERROR, body: req.body, skipDiscord });
    }

    return res.status(200).json(tx);
  },
  { allowPost: true }
);
