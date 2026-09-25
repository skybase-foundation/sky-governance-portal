/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseEther } from 'viem';
import ExecutiveOverviewCard from '../ExecutiveOverviewCard';
import { Proposal } from 'modules/executive/types';

vi.mock('../VoteModal', () => ({ default: () => null }));

const proposal = {
  title: 'Sep 24 executive',
  proposalBlurb: 'Blurb',
  key: 'sep-24',
  address: '0xF01b594aF26fC8A8ae1e24DCaF904ECB6Fd1BaDC',
  date: '2026-09-24T00:00:00.000Z',
  active: true,
  spellData: {
    hasBeenCast: false,
    hasBeenScheduled: false,
    expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    // The listing gets skySupport in SKY, as /api/executive returns it
    skySupport: '719873992.828063415720552885'
  }
} as unknown as Proposal;

describe('ExecutiveOverviewCard', () => {
  it('shows the SKY supporting and the SKY needed to pass from SKY values', () => {
    render(
      <ExecutiveOverviewCard
        proposal={proposal}
        isHat={false}
        votedProposals={[]}
        skyOnHat={parseEther('6946943699')}
      />
    );

    expect(screen.getByText('719,873,993')).toBeInTheDocument();
    expect(screen.getByText(/6,227,069,706 additional SKY support needed to pass/)).toBeInTheDocument();
  });
});
