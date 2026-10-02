/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
import { getStatusText } from '../getStatusText';
import { SpellData } from '../../types/spellData';

const PROPOSAL = '0xF01b594aF26fC8A8ae1e24DCaF904ECB6Fd1BaDC';
const expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function spellData(skySupport: string): SpellData {
  return { hasBeenCast: false, hasBeenScheduled: false, expiration, skySupport } as SpellData;
}

describe('getStatusText', () => {
  it('subtracts the spell support from the SKY on the hat, both in wei', () => {
    const text = getStatusText({
      proposalAddress: PROPOSAL,
      spellData: spellData(parseEther('719873993').toString()),
      skyOnHat: parseEther('6946943699')
    });

    expect(text).toMatch(/^6,227,069,706 additional SKY support needed to pass\./);
  });

  it('shows 0 needed when the spell already has more SKY than the hat', () => {
    const text = getStatusText({
      proposalAddress: PROPOSAL,
      spellData: spellData(parseEther('200').toString()),
      skyOnHat: parseEther('100')
    });

    expect(text).toMatch(/^0 additional SKY support needed to pass\./);
  });
});
