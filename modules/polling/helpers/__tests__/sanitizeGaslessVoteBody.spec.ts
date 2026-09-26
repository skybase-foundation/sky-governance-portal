/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { sanitizeGaslessVoteBody } from '../sanitizeGaslessVoteBody';

describe('sanitizeGaslessVoteBody', () => {
  const body = {
    voter: '0xabc',
    network: 'mainnet',
    nonce: 3,
    expiry: 1700000000,
    pollIds: [1, 2],
    optionIds: [1, 0],
    signature: '0xdeadbeef',
    secret: 'hunter2',
    skipDiscord: false
  };

  it('keeps only the non-sensitive fields', () => {
    expect(sanitizeGaslessVoteBody(body)).toEqual({
      voter: '0xabc',
      network: 'mainnet',
      nonce: 3,
      expiry: 1700000000,
      pollCount: 2,
      optionCount: 2,
      usedSecret: true
    });
  });

  it('never carries the signature or the secret through', () => {
    const json = JSON.stringify(sanitizeGaslessVoteBody(body));
    expect(json).not.toContain('0xdeadbeef');
    expect(json).not.toContain('hunter2');
  });

  it('tolerates malformed bodies', () => {
    expect(sanitizeGaslessVoteBody(null)).toEqual({});
    expect(sanitizeGaslessVoteBody('nope')).toEqual({});
    expect(sanitizeGaslessVoteBody({ pollIds: 'not-an-array' })).toMatchObject({
      pollCount: undefined,
      usedSecret: false
    });
  });
});
