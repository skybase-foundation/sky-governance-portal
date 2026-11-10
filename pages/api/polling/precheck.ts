/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { NextApiRequest, NextApiResponse } from 'next';
import withApiHandler from 'modules/app/api/withApiHandler';
import { DEFAULT_NETWORK, SupportedNetworks } from 'modules/web3/constants/networks';
import { hasSkyRequiredVotingWeight } from 'modules/polling/helpers/hasSkyRequiredVotingWeight';
import { MIN_SKY_REQUIRED_FOR_GASLESS_VOTING } from 'modules/polling/polling.constants';
import { ballotIncludesAlreadyVoted } from 'modules/polling/helpers/ballotIncludesAlreadyVoted';
import { getRelayerBalance } from 'modules/polling/api/getRelayerBalance';
import { ApiError } from 'modules/app/api/ApiError';
import { getGaslessStatus } from 'modules/polling/helpers/gaslessLimits';
import validateQueryParam from 'modules/app/api/validateQueryParam';
import { validateAddress } from 'modules/web3/api/validateAddress';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  // validate network
  const network = validateQueryParam(
    (req.query.network as SupportedNetworks) || DEFAULT_NETWORK.network,
    'string',
    {
      defaultValue: null,
      validValues: [SupportedNetworks.TENDERLY, SupportedNetworks.MAINNET]
    },
    n => !!n,
    new ApiError('Invalid network', 400, 'Invalid network')
  ) as SupportedNetworks;

  // validate these below
  const pollIds = req.query.pollIds as string;

  const pollIdsArray = pollIds.split(',');

  if (!pollIds || pollIdsArray.length === 0) {
    throw new ApiError('Gasless precheck: Missing parameters', 400, 'No poll ids provided');
  }

  const voter = await validateAddress(
    req.query.voter as string,
    new ApiError('Gasless precheck: Invalid address', 400, 'Invalid address')
  );

  const [{ unavailableReason, recentlyUsedGaslessVoting }, hasSkyRequired, alreadyVoted, relayBalance] =
    await Promise.all([
      getGaslessStatus(voter, network),
      hasSkyRequiredVotingWeight(voter, network, MIN_SKY_REQUIRED_FOR_GASLESS_VOTING, true),
      ballotIncludesAlreadyVoted(voter, network, pollIdsArray),
      getRelayerBalance(network)
    ]);

  return res.status(200).json({
    recentlyUsedGaslessVoting,
    hasSkyRequired,
    alreadyVoted,
    relayBalance,
    // The review UI shows its relayer-unavailable state when this is true.
    gaslessDisabled: unavailableReason !== null,
    gaslessUnavailableReason: unavailableReason
  });
});
