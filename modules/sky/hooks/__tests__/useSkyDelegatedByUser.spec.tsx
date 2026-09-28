/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import React from 'react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { fetchDelegationEventsByUser } from 'modules/delegates/api/fetchDelegationEventsByUser';
import { getPublicClient } from 'modules/web3/helpers/getPublicClient';
import { useSkyDelegatedByUser } from '../useSkyDelegatedByUser';

vi.mock('wagmi', () => ({ useChainId: () => 1 }));
vi.mock('lib/config', () => ({ config: { USE_MOCK_WALLET: false } }));
vi.mock('modules/delegates/api/fetchDelegationEventsByUser', () => ({
  fetchDelegationEventsByUser: vi.fn()
}));
vi.mock('modules/web3/helpers/getPublicClient', () => ({ getPublicClient: vi.fn() }));

const USER = '0x00000000000000000000000000000000000000aa';
const DELEGATE = '0x00000000000000000000000000000000000000bb';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe('useSkyDelegatedByUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPublicClient as Mock).mockReturnValue({ readContract: vi.fn().mockResolvedValue(5n * 10n ** 18n) });
  });

  it('falls back to the on-chain stake when the indexer fetch fails', async () => {
    (fetchDelegationEventsByUser as Mock).mockRejectedValue(new Error('indexer unavailable'));

    const { result } = renderHook(() => useSkyDelegatedByUser(USER, DELEGATE), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.directDelegationAmount).toBe(5n * 10n ** 18n);
    expect(result.current.data?.totalDelegationAmount).toBe(5n * 10n ** 18n);
  });

  it('sums the indexer events when the fetch succeeds', async () => {
    (fetchDelegationEventsByUser as Mock).mockResolvedValue([
      { lockAmount: '3', isStakingEngine: false },
      { lockAmount: '2', isStakingEngine: true }
    ]);

    const { result } = renderHook(() => useSkyDelegatedByUser(USER, DELEGATE), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.directDelegationAmount).toBe(3n * 10n ** 18n);
    expect(result.current.data?.stakingEngineDelegationAmount).toBe(2n * 10n ** 18n);
    expect(getPublicClient).not.toHaveBeenCalled();
  });
});
