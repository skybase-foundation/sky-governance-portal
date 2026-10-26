/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, expect, it } from 'vitest';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { getTypedBallotData } from '../signTypedBallotData';
import { verifyTypedSignature } from '../verifyTypedSignature';
import { generateTestBallot, getTestBallotTypedData } from '../../../../scripts/generateTestBallot.mjs';

const networks = [SupportedNetworks.MAINNET, SupportedNetworks.TENDERLY];

describe('generateTestBallot script', () => {
  it.each(networks)('builds the same typed data as getTypedBallotData on %s', network => {
    const message = {
      voter: '0x0000000000000000000000000000000000000001',
      pollIds: ['1'],
      optionIds: ['0'],
      nonce: 0,
      expiry: 1
    };

    expect(getTestBallotTypedData(message, network)).toEqual(getTypedBallotData(message, network));
  });

  it.each(networks)('signs a ballot that verifies against getTypedBallotData on %s', async network => {
    const { signature, voter, nonce, expiry, pollIds, optionIds, ...rest } = await generateTestBallot(network);
    const { domain, types, message, primaryType } = getTypedBallotData(
      { voter: voter.toLowerCase(), pollIds, optionIds, nonce, expiry },
      network
    );

    expect(rest).toEqual({ network });
    expect(await verifyTypedSignature(voter, domain, types, message, primaryType, signature)).toBe(true);
  });
});
