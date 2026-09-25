/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { ContractFunctionParameters } from 'viem';
import { mainnetPublicClient, tenderly, tenderlyPublicClient } from 'modules/wagmi/config/config.default';
import { chiefAbi } from 'modules/contracts/generated';
import { CHIEF_MAX_YAYS } from 'modules/contracts/contracts.constants';

// Reads the slate's length and every index it can hold in a single multicall. Reads past the end of the
// slate revert on their own without failing the batch, while an RPC error fails the whole call, so a
// slate is never returned partially.
export async function getSlateAddresses(
  chainId: number,
  address: `0x${string}`,
  slateHash: `0x${string}`
): Promise<string[]> {
  const publicClient = chainId === tenderly.id ? tenderlyPublicClient : mainnetPublicClient;

  // viem can't infer a tuple mixing one length() read with a spread of slates() reads, so results are cast
  const contracts: ContractFunctionParameters[] = [
    { address, abi: chiefAbi, functionName: 'length', args: [slateHash] },
    ...Array.from({ length: CHIEF_MAX_YAYS }, (_, i) => ({
      address,
      abi: chiefAbi,
      functionName: 'slates',
      args: [slateHash, BigInt(i)]
    }))
  ];

  const [length, ...yays] = await publicClient.multicall({ contracts });

  if (length.status === 'failure') throw length.error;
  // Only reachable on a Chief with a higher maxYays: fail rather than return the first CHIEF_MAX_YAYS spells
  if ((length.result as bigint) > BigInt(CHIEF_MAX_YAYS)) {
    throw new Error(
      `Slate ${slateHash} has ${length.result} spells, more than CHIEF_MAX_YAYS (${CHIEF_MAX_YAYS})`
    );
  }

  return yays.slice(0, Number(length.result as bigint)).map(yay => {
    if (yay.status === 'failure') throw yay.error;
    return yay.result as string;
  });
}
