// Sign a throwaway gasless poll ballot with a random wallet and print it as JSON, ready to POST to
// /api/polling/vote. Used by the gasless vote synthetic check (.github/workflows/gasless-synthetic.yml).
//
// Usage:
//   node scripts/generateTestBallot.mjs            # mainnet
//   node scripts/generateTestBallot.mjs tenderly
//
// The typed data must match getTypedBallotData (modules/web3/helpers/signTypedBallotData.ts);
// modules/web3/helpers/__tests__/generateTestBallot.spec.ts checks that it does.

import { pathToFileURL } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const EIGHT_HOURS_IN_S = 8 * 60 * 60;

// Chain ID and Arbitrum polling contract per network, as in SupportedChainId and ArbitrumPollingAddressMap
const NETWORKS = {
  mainnet: { chainId: 1, verifyingContract: '0x4f4e551b4920a5417F8d4e7f8f099660dAdadcEC' },
  tenderly: { chainId: 314310, verifyingContract: '0xE63329692fA90B3efd5eB675c601abeDB2DF715a' }
};

export function getTestBallotTypedData(message, network) {
  const domainValues = NETWORKS[network];
  if (!domainValues) throw new Error(`Unsupported network ${network}`);

  return {
    types: {
      Vote: [
        { name: 'voter', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'pollIds', type: 'uint256[]' },
        { name: 'optionIds', type: 'uint256[]' }
      ]
    },
    primaryType: 'Vote',
    domain: { name: 'MakerDAO Polling', version: 'Arbitrum.1', ...domainValues },
    message
  };
}

export async function generateTestBallot(network) {
  const account = privateKeyToAccount(generatePrivateKey());
  const voter = account.address;

  const pollIds = ['1'];
  const optionIds = ['0'];
  const nonce = 0;
  const expiry = Math.trunc(Date.now() / 1000) + EIGHT_HOURS_IN_S;
  const message = { voter: voter.toLowerCase(), pollIds, optionIds, nonce, expiry };

  const signature = await account.signTypedData(getTestBallotTypedData(message, network));
  return { signature, voter, nonce, expiry, pollIds, optionIds, network };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ballot = await generateTestBallot(process.argv[2] || 'mainnet');
  console.log(JSON.stringify(ballot));
}
