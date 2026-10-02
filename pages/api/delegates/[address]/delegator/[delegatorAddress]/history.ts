/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { NextApiRequest, NextApiResponse } from 'next';
import { DEFAULT_NETWORK, SupportedNetworks } from 'modules/web3/constants/networks';
import { ApiError } from 'modules/app/api/ApiError';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { fetchAllPages } from 'modules/gql/fetchAllPages';
import { delegatorDelegateHistory } from 'modules/gql/queries/subgraph/delegatorDelegateHistory';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { isAddress } from 'viem';
import validateQueryParam from 'modules/app/api/validateQueryParam';
import withApiHandler from 'modules/app/api/withApiHandler';

/**
 * @swagger
 * /api/delegates/{address}/delegator/{delegatorAddress}/history:
 *   get:
 *     tags:
 *       - delegates
 *     summary: Returns delegation history between a specific delegator and delegate
 *     description: Returns the complete delegation history events between a delegator and delegate, sorted by timestamp descending
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: The delegate contract address
 *       - in: path
 *         name: delegatorAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The delegator address
 *       - in: query
 *         name: network
 *         schema:
 *           type: string
 *           enum: [mainnet, arbitrum, tenderly, sepolia]
 *         description: The network to query
 *     responses:
 *       '200':
 *         description: Delegation history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 delegationHistory:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       amount:
 *                         type: string
 *                       accumulatedAmount:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                       txnHash:
 *                         type: string
 *                       blockNumber:
 *                         type: string
 *                       isStakingEngine:
 *                         type: boolean
 *                 delegateAddress:
 *                   type: string
 *                 delegatorAddress:
 *                   type: string
 *       '400':
 *         description: Invalid parameters
 *       '404':
 *         description: Delegation history not found
 *       '500':
 *         description: Internal server error
 */

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
    const network = validateQueryParam(
      req.query.network,
      'string',
      {
        defaultValue: DEFAULT_NETWORK.network,
        validValues: Object.values(SupportedNetworks)
      }
    ) as SupportedNetworks;

    const { address, delegatorAddress } = req.query;

    // Validate addresses
    if (!address || typeof address !== 'string') {
      throw new ApiError('Delegate address is required', 400, 'Invalid delegate address');
    }

    if (!delegatorAddress || typeof delegatorAddress !== 'string') {
      throw new ApiError('Delegator address is required', 400, 'Invalid delegator address');
    }

    if (!isAddress(address)) {
      throw new ApiError('Invalid delegate address format', 400, 'Invalid delegate address');
    }

    if (!isAddress(delegatorAddress)) {
      throw new ApiError('Invalid delegator address format', 400, 'Invalid delegator address');
    }

    try {
      const chainId = networkNameToChainId(network);
      const delegationHistories = await fetchAllPages<any>(async cursor => {
        const result = await gqlRequest<any>({
          chainId,
          query: delegatorDelegateHistory(chainId, delegatorAddress.toLowerCase(), address.toLowerCase(), cursor)
        });
        return result.delegationHistories || [];
      });

      return res.status(200).json({
        delegationHistory: delegationHistories
          .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
          .map(entry => ({
            ...entry,
            delegate: entry.delegate ? { ...entry.delegate, id: entry.delegate.address } : entry.delegate
          })),
        delegateAddress: address.toLowerCase(),
        delegatorAddress: delegatorAddress.toLowerCase()
      });
    } catch (error) {
      throw new ApiError(
        `Failed to fetch delegation history: ${error.message}`,
        500,
        'Error fetching delegation history'
      );
    }
});